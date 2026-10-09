const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

export type GeminiTtsPlaybackState = 'idle' | 'starting' | 'speaking' | 'error';

type SpeakOptions = {
  projectId: string;
  volume?: number;
  onState?: (state: GeminiTtsPlaybackState) => void;
};

type TtsResponse = {
  audio: {
    audioBase64: string;
    mimeType: string;
    model: string;
    voice: string;
  };
  tts: {
    ready: boolean;
    model: string;
    voice: string;
  };
};

export type GeminiTtsPlaybackResult = {
  started: boolean;
  completed: boolean;
  engine: 'gemini-tts';
  model?: string;
  voice?: string;
  error?: string;
};

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class GeminiTtsVoiceRuntime {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private speaking = false;
  private generation = 0;

  async unlock() {
    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return false;
      this.context ??= new AudioContextCtor();
      if (this.context.state === 'suspended') await this.context.resume();
      return true;
    } catch {
      return false;
    }
  }

  cancel() {
    this.generation += 1;
    this.speaking = false;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = undefined;
  }

  isSpeaking() {
    return this.speaking;
  }

  async speak(text: string, options: SpeakOptions): Promise<GeminiTtsPlaybackResult> {
    const normalized = text.trim();
    if (!normalized) return { started: false, completed: true, engine: 'gemini-tts' };
    if (!options.projectId.trim()) return { started: false, completed: false, engine: 'gemini-tts', error: 'projectId is required.' };

    this.cancel();
    const generation = ++this.generation;
    options.onState?.('starting');

    try {
      await this.unlock();
      const response = await fetch(`${API_URL}/v1/voice/gemini/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: options.projectId, text: normalized }),
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const payload = await response.json() as { error?: string };
          if (payload?.error) detail = payload.error;
        } catch { /* keep HTTP detail */ }
        options.onState?.('error');
        return { started: false, completed: false, engine: 'gemini-tts', error: detail };
      }

      const payload = await response.json() as TtsResponse;
      if (generation !== this.generation) return { started: false, completed: false, engine: 'gemini-tts', error: 'cancelled' };
      const base64 = payload.audio?.audioBase64;
      if (!base64) {
        options.onState?.('error');
        return { started: false, completed: false, engine: 'gemini-tts', error: 'Gemini TTS audio payload is empty.' };
      }

      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        options.onState?.('error');
        return { started: false, completed: false, engine: 'gemini-tts', error: 'Web Audio is unavailable.' };
      }
      this.context ??= new AudioContextCtor();
      if (this.context.state === 'suspended') await this.context.resume();

      const bytes = base64ToBytes(base64);
      const audioBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      let decoded: AudioBuffer;
      try {
        decoded = await this.context.decodeAudioData(audioBuffer);
      } catch (error) {
        options.onState?.('error');
        return {
          started: false,
          completed: false,
          engine: 'gemini-tts',
          model: payload.audio?.model,
          voice: payload.audio?.voice,
          error: `Gemini TTS audio decode failed: ${(error as Error).message}`,
        };
      }

      if (generation !== this.generation) return { started: false, completed: false, engine: 'gemini-tts', error: 'cancelled' };

      return await new Promise<GeminiTtsPlaybackResult>((resolve) => {
        const source = this.context!.createBufferSource();
        const gain = this.context!.createGain();
        gain.gain.value = Math.min(1, Math.max(0, options.volume ?? 1));
        source.buffer = decoded;
        source.connect(gain);
        gain.connect(this.context!.destination);
        this.source = source;
        this.speaking = true;
        options.onState?.('speaking');
        source.onended = () => {
          if (this.source === source) this.source = undefined;
          this.speaking = false;
          options.onState?.('idle');
          resolve({
            started: true,
            completed: true,
            engine: 'gemini-tts',
            model: payload.audio?.model,
            voice: payload.audio?.voice,
          });
        };
        try {
          source.start();
        } catch (error) {
          this.speaking = false;
          options.onState?.('error');
          resolve({
            started: false,
            completed: false,
            engine: 'gemini-tts',
            model: payload.audio?.model,
            voice: payload.audio?.voice,
            error: `Gemini TTS audio start failed: ${(error as Error).message}`,
          });
        }
      });
    } catch (error) {
      options.onState?.('error');
      return {
        started: false,
        completed: false,
        engine: 'gemini-tts',
        error: (error as Error)?.message || 'Gemini TTS playback failed.',
      };
    }
  }
}

export const geminiTtsVoiceRuntime = new GeminiTtsVoiceRuntime();
