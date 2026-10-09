import type {
  RealtimeVoiceCallbacks,
  RealtimeVoiceConnectOptions,
  RealtimeVoiceState,
  VoiceMissionSuggestion,
} from './RealtimeVoiceClient';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

type GeminiTokenPayload = {
  session: {
    token: string;
    model: string;
    voice: string;
    instructions: string;
    expireTime: string;
    newSessionExpireTime: string;
  };
};

type RuntimeSummary = {
  core: unknown;
  executor: unknown;
  operations: unknown;
  localVoice: unknown;
};

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) detail = payload.error;
    } catch { /* preserve HTTP detail */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function floatToPcm16(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function closeDetail(event: CloseEvent) {
  const reason = event.reason?.trim();
  return `Gemini Live bağlantısı kapandı (code ${event.code}${reason ? ` · ${reason}` : ''}).`;
}

export class GeminiLiveVoiceClient {
  private socket?: WebSocket;
  private media?: MediaStream;
  private inputContext?: AudioContext;
  private inputSource?: MediaStreamAudioSourceNode;
  private inputProcessor?: ScriptProcessorNode;
  private inputMute?: GainNode;
  private outputContext?: AudioContext;
  private outputGain?: GainNode;
  private outputSources = new Set<AudioBufferSourceNode>();
  private nextPlayAt = 0;
  private projectId = '';
  private userTranscript = '';
  private assistantTranscript = '';
  private userTurnClassified = false;
  private stopped = true;
  private setupComplete = false;
  private connectResolve?: () => void;
  private connectReject?: (error: Error) => void;
  private connectTimer?: number;

  constructor(private readonly callbacks: RealtimeVoiceCallbacks = {}) {}

  private state(state: RealtimeVoiceState) {
    this.callbacks.onState?.(state);
  }

  private error(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.state('error');
    this.callbacks.onError?.(message);
  }

  private async classifyTurn(text: string) {
    if (!text.trim() || !this.projectId || this.userTurnClassified) return;
    this.userTurnClassified = true;
    try {
      const payload = await jsonRequest<{ suggestedMission?: VoiceMissionSuggestion }>('/v1/voice/classify', {
        method: 'POST',
        body: JSON.stringify({ projectId: this.projectId, text }),
      });
      this.callbacks.onMissionSuggestion?.(payload.suggestedMission);
    } catch (error) {
      this.callbacks.onError?.(`Sesli talep sınıflandırılamadı: ${(error as Error).message}`);
    }
  }

  private async runtimeSummary(): Promise<RuntimeSummary> {
    const [core, executor, operations, localVoice] = await Promise.all([
      jsonRequest<unknown>('/health').catch((error) => ({ error: (error as Error).message })),
      jsonRequest<unknown>('/v1/executor').catch((error) => ({ error: (error as Error).message })),
      jsonRequest<unknown>('/v1/operations?limit=8').catch((error) => ({ error: (error as Error).message })),
      jsonRequest<unknown>('/v1/voice/local').catch((error) => ({ error: (error as Error).message })),
    ]);
    return { core, executor, operations, localVoice };
  }

  private send(payload: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  private clearPlayback() {
    for (const source of this.outputSources) {
      try { source.stop(); } catch { /* already ended */ }
    }
    this.outputSources.clear();
    this.nextPlayAt = this.outputContext?.currentTime ?? 0;
  }

  private ensureOutput() {
    if (!this.outputContext) {
      this.outputContext = new AudioContext({ sampleRate: 24_000 });
      this.outputGain = this.outputContext.createGain();
      this.outputGain.connect(this.outputContext.destination);
    }
    return this.outputContext;
  }

  private playPcm(base64: string) {
    const bytes = base64ToBytes(base64);
    if (bytes.byteLength < 2) return;
    const count = Math.floor(bytes.byteLength / 2);
    const samples = new Float32Array(count);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(i * 2, true) / 0x8000;

    const context = this.ensureOutput();
    const buffer = context.createBuffer(1, count, 24_000);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputGain!);
    const startAt = Math.max(context.currentTime + 0.015, this.nextPlayAt);
    this.nextPlayAt = startAt + buffer.duration;
    this.outputSources.add(source);
    source.addEventListener('ended', () => {
      this.outputSources.delete(source);
      if (!this.outputSources.size && this.setupComplete && !this.stopped) this.state('listening');
    }, { once: true });
    source.start(startAt);
    this.state('speaking');
  }

  private async handleToolCall(message: any) {
    const calls = message?.toolCall?.functionCalls;
    if (!Array.isArray(calls) || !calls.length) return;
    const functionResponses = [];
    for (const call of calls) {
      if (call.name === 'get_taso_runtime_status') {
        const result = await this.runtimeSummary();
        functionResponses.push({ id: call.id, name: call.name, response: { result } });
      } else {
        functionResponses.push({ id: call.id, name: call.name, response: { error: 'Tool not allowed in Taso Live.' } });
      }
    }
    this.send({ toolResponse: { functionResponses } });
  }

  private handleMessage(message: any) {
    if (this.stopped) return;

    if (message?.setupComplete) {
      this.setupComplete = true;
      if (this.connectTimer) window.clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
      this.connectResolve?.();
      this.connectResolve = undefined;
      this.connectReject = undefined;
      this.state('listening');
      this.callbacks.onConnected?.();
      return;
    }

    if (message?.toolCall) void this.handleToolCall(message);

    const server = message?.serverContent;
    if (server?.interrupted) {
      this.clearPlayback();
      this.state('listening');
    }

    const inputText = String(server?.inputTranscription?.text ?? '');
    if (inputText) {
      this.userTranscript += inputText;
      this.userTurnClassified = false;
      this.callbacks.onUserTranscript?.(this.userTranscript.trim(), false);
      this.state('listening');
    }

    const outputText = String(server?.outputTranscription?.text ?? '');
    if (outputText) {
      if (!this.userTurnClassified) void this.classifyTurn(this.userTranscript.trim());
      this.assistantTranscript += outputText;
      this.callbacks.onAssistantTranscript?.(this.assistantTranscript.trim(), false);
    }

    const parts = server?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const data = part?.inlineData?.data;
        if (typeof data === 'string' && data) this.playPcm(data);
      }
    }

    if (server?.turnComplete) {
      const user = this.userTranscript.trim();
      const assistant = this.assistantTranscript.trim();
      if (user) {
        this.callbacks.onUserTranscript?.(user, true);
        if (!this.userTurnClassified) void this.classifyTurn(user);
      }
      if (assistant) this.callbacks.onAssistantTranscript?.(assistant, true);
      this.userTranscript = '';
      this.assistantTranscript = '';
      this.userTurnClassified = false;
      if (!this.outputSources.size) this.state('listening');
    }
  }

  private async decodeSocketMessage(data: unknown) {
    if (typeof data === 'string') return JSON.parse(data);
    if (data instanceof Blob) {
      const text = await data.text();
      if (!text.trim()) return undefined;
      return JSON.parse(text);
    }
    if (data instanceof ArrayBuffer) {
      const text = new TextDecoder().decode(new Uint8Array(data));
      if (!text.trim()) return undefined;
      return JSON.parse(text);
    }
    if (ArrayBuffer.isView(data)) {
      const text = new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (!text.trim()) return undefined;
      return JSON.parse(text);
    }
    throw new Error(`Desteklenmeyen Gemini Live frame tipi: ${Object.prototype.toString.call(data)}`);
  }

  private async handleSocketMessage(data: unknown) {
    try {
      const message = await this.decodeSocketMessage(data);
      if (message !== undefined) this.handleMessage(message);
    } catch (error) {
      this.error(`Gemini Live mesajı çözümlenemedi: ${(error as Error).message}`);
    }
  }

  private async startMicrophone() {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.media = media;
    const context = new AudioContext();
    this.inputContext = context;
    await context.resume();
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.inputSource = source;
    this.inputProcessor = processor;
    this.inputMute = mute;

    processor.onaudioprocess = (event) => {
      if (this.stopped || !this.setupComplete) return;
      const pcm = floatToPcm16(event.inputBuffer.getChannelData(0));
      this.send({
        realtimeInput: {
          audio: {
            data: bytesToBase64(pcm),
            mimeType: `audio/pcm;rate=${context.sampleRate}`,
          },
        },
      });
    };
  }

  async connect(options: RealtimeVoiceConnectOptions) {
    this.stop();
    this.stopped = false;
    this.projectId = options.projectId;
    this.userTranscript = '';
    this.assistantTranscript = '';
    this.userTurnClassified = false;
    this.setupComplete = false;
    this.state('connecting');

    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu tarayıcı mikrofon erişimini desteklemiyor.');

    try {
      const tokenPayload = await jsonRequest<GeminiTokenPayload>('/v1/voice/gemini/token', {
        method: 'POST',
        body: JSON.stringify({ projectId: options.projectId, workspaceName: options.workspaceName }),
      });
      const token = tokenPayload.session;

      this.ensureOutput();
      await this.outputContext?.resume();

      const ws = new WebSocket(`${GEMINI_WS}?access_token=${encodeURIComponent(token.token)}`);
      this.socket = ws;

      const setupReady = new Promise<void>((resolve, reject) => {
        this.connectResolve = resolve;
        this.connectReject = reject;
        this.connectTimer = window.setTimeout(() => {
          reject(new Error('Gemini Live setup 12 saniye içinde tamamlanmadı.'));
        }, 12_000);
      });

      ws.addEventListener('open', () => {
        this.send({
          setup: {
            model: `models/${token.model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: token.voice } },
              },
            },
            systemInstruction: { parts: [{ text: token.instructions }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                prefixPaddingMs: 120,
                silenceDurationMs: 260,
              },
            },
            tools: [{
              functionDeclarations: [{
                name: 'get_taso_runtime_status',
                description: 'Taso Core, executor, recent operations ve local voice runtime durumunu salt-okunur getirir.',
              }],
            }],
          },
        });
      });

      ws.addEventListener('message', (event) => {
        void this.handleSocketMessage(event.data);
      });

      ws.addEventListener('error', () => {
        const error = new Error('Gemini Live WebSocket bağlantı hatası.');
        this.connectReject?.(error);
        this.error(error);
      });

      ws.addEventListener('close', (event) => {
        if (this.connectTimer) window.clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
        const detail = closeDetail(event);
        if (!this.setupComplete) this.connectReject?.(new Error(detail));
        this.connectResolve = undefined;
        this.connectReject = undefined;
        if (!this.stopped) {
          this.error(detail);
          this.callbacks.onDisconnected?.();
        }
      });

      await setupReady;
      await this.startMicrophone();
      this.state('listening');
    } catch (error) {
      this.error(error);
      throw error;
    }
  }

  interrupt() {
    this.clearPlayback();
    this.state('listening');
  }

  setVolume(volume: number) {
    if (this.outputGain) this.outputGain.gain.value = Math.min(1, Math.max(0, volume));
  }

  stop() {
    const wasActive = !this.stopped;
    this.stopped = true;
    this.setupComplete = false;
    if (this.connectTimer) window.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    this.connectResolve = undefined;
    this.connectReject = undefined;
    try { this.socket?.close(1000, 'client-stop'); } catch { /* noop */ }
    this.socket = undefined;
    if (this.inputProcessor) this.inputProcessor.onaudioprocess = null;
    try { this.inputProcessor?.disconnect(); } catch { /* noop */ }
    try { this.inputSource?.disconnect(); } catch { /* noop */ }
    try { this.inputMute?.disconnect(); } catch { /* noop */ }
    for (const track of this.media?.getTracks() ?? []) track.stop();
    this.media = undefined;
    this.inputProcessor = undefined;
    this.inputSource = undefined;
    this.inputMute = undefined;
    void this.inputContext?.close().catch(() => undefined);
    this.inputContext = undefined;
    this.clearPlayback();
    void this.outputContext?.close().catch(() => undefined);
    this.outputContext = undefined;
    this.outputGain = undefined;
    this.projectId = '';
    if (wasActive) this.callbacks.onDisconnected?.();
    this.state('idle');
  }
}
