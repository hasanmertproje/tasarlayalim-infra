const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

export type RealtimeVoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export type RealtimeVoiceStatus = {
  provider: 'openai-realtime';
  transport: 'webrtc';
  enabled: boolean;
  paidAllowed: boolean;
  configured: boolean;
  ready: boolean;
  model: string;
  voice: string;
  fallback: 'browser-stt-tts';
};

export type VoiceMissionSuggestion = {
  projectId: string;
  objective: string;
  riskLevel: 'READ' | 'WRITE' | 'HIGH_IMPACT';
  dataClass: 'private_code';
};

export interface RealtimeVoiceCallbacks {
  onState?: (state: RealtimeVoiceState) => void;
  onUserTranscript?: (text: string, final: boolean) => void;
  onAssistantTranscript?: (text: string, final: boolean) => void;
  onMissionSuggestion?: (suggestion?: VoiceMissionSuggestion) => void;
  onError?: (message: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export interface RealtimeVoiceConnectOptions {
  projectId: string;
  workspaceName?: string;
  speed?: number;
  volume?: number;
}

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
    } catch {
      // Preserve HTTP status detail.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function getRealtimeVoiceStatus() {
  const payload = await jsonRequest<{ realtime: RealtimeVoiceStatus }>('/v1/voice/realtime');
  return payload.realtime;
}

export class RealtimeVoiceClient {
  private peer?: RTCPeerConnection;
  private media?: MediaStream;
  private channel?: RTCDataChannel;
  private audio?: HTMLAudioElement;
  private projectId = '';
  private userTranscript = '';
  private assistantTranscript = '';
  private stopped = true;

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
    if (!text.trim() || !this.projectId) return;
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

  private handleServerEvent(raw: string) {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        if (!this.stopped) this.state('listening');
        break;
      case 'input_audio_buffer.speech_started':
        this.userTranscript = '';
        this.callbacks.onUserTranscript?.('', false);
        this.state('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.state('thinking');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        this.userTranscript += event.delta ?? '';
        this.callbacks.onUserTranscript?.(this.userTranscript, false);
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = String(event.transcript ?? this.userTranscript).trim();
        this.userTranscript = transcript;
        this.callbacks.onUserTranscript?.(transcript, true);
        void this.classifyTurn(transcript);
        break;
      }
      case 'response.created':
        this.assistantTranscript = '';
        this.callbacks.onAssistantTranscript?.('', false);
        this.state('thinking');
        break;
      case 'response.output_audio_transcript.delta':
        this.assistantTranscript += event.delta ?? '';
        this.callbacks.onAssistantTranscript?.(this.assistantTranscript, false);
        this.state('speaking');
        break;
      case 'response.output_audio_transcript.done': {
        const transcript = String(event.transcript ?? this.assistantTranscript).trim();
        this.assistantTranscript = transcript;
        this.callbacks.onAssistantTranscript?.(transcript, true);
        break;
      }
      case 'response.done':
        if (!this.stopped) this.state('listening');
        break;
      case 'error':
        this.error(event.error?.message ?? 'Realtime voice error.');
        break;
      default:
        break;
    }
  }

  async connect(options: RealtimeVoiceConnectOptions) {
    this.stop();
    this.stopped = false;
    this.projectId = options.projectId;
    this.userTranscript = '';
    this.assistantTranscript = '';
    this.state('connecting');

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Bu tarayıcı WebRTC mikrofon erişimini desteklemiyor.');
    }

    try {
      const peer = new RTCPeerConnection();
      this.peer = peer;

      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.volume = Math.min(1, Math.max(0, Number.isFinite(options.volume) ? Number(options.volume) : 1));
      this.audio = audio;
      peer.addEventListener('track', (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => this.callbacks.onError?.('Taso sesi otomatik başlatılamadı. Ses iznini kontrol et.'));
      });

      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.media = media;
      for (const track of media.getAudioTracks()) peer.addTrack(track, media);

      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.addEventListener('message', (event) => this.handleServerEvent(String(event.data)));
      channel.addEventListener('open', () => {
        if (!this.stopped) {
          this.state('listening');
          this.callbacks.onConnected?.();
        }
      });
      channel.addEventListener('close', () => {
        if (!this.stopped) this.callbacks.onDisconnected?.();
      });

      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          this.error(`Realtime voice bağlantısı ${peer.connectionState}.`);
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error('WebRTC SDP offer üretilemedi.');

      const payload = await jsonRequest<{ session: { sdp: string } }>('/v1/voice/realtime/session', {
        method: 'POST',
        body: JSON.stringify({
          projectId: options.projectId,
          workspaceName: options.workspaceName,
          sdp: offer.sdp,
          speed: options.speed,
        }),
      });

      await peer.setRemoteDescription({ type: 'answer', sdp: payload.session.sdp });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  interrupt() {
    if (this.stopped || this.channel?.readyState !== 'open') return;
    this.channel.send(JSON.stringify({ type: 'response.cancel' }));
    this.channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
    this.state('listening');
  }

  setVolume(volume: number) {
    if (this.audio) this.audio.volume = Math.min(1, Math.max(0, volume));
  }

  stop() {
    const wasActive = !this.stopped;
    this.stopped = true;
    try { this.channel?.close(); } catch { /* noop */ }
    try { this.peer?.close(); } catch { /* noop */ }
    for (const track of this.media?.getTracks() ?? []) track.stop();
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.channel = undefined;
    this.peer = undefined;
    this.media = undefined;
    this.audio = undefined;
    this.projectId = '';
    if (wasActive) this.callbacks.onDisconnected?.();
    this.state('idle');
  }
}
