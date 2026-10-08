export type BrowserVoiceRuntimeState = 'idle' | 'starting' | 'speaking' | 'error';

export type BrowserVoiceProfile = {
  voiceName?: string;
  rate: number;
  pitch: number;
  volume: number;
  lang?: string;
};

export type BrowserVoiceResult = {
  started: boolean;
  completed: boolean;
  voiceName?: string;
  retried: boolean;
  engine?: 'local-neural' | 'browser-tts';
  error?: string;
};

type SpeakOptions = {
  profile: BrowserVoiceProfile;
  voices: SpeechSynthesisVoice[];
  onState?: (state: BrowserVoiceRuntimeState) => void;
  startTimeoutMs?: number;
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export class BrowserVoiceRuntime {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private speaking = false;
  private generation = 0;

  supported() {
    return typeof window !== 'undefined';
  }

  private browserTtsSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  async unlock() {
    if (!this.supported()) return false;
    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return this.browserTtsSupported();
      this.context ??= new AudioContextCtor();
      if (this.context.state === 'suspended') await this.context.resume();

      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      gain.gain.value = 0.00001;
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start();
      oscillator.stop(this.context.currentTime + 0.015);
      return true;
    } catch {
      return this.browserTtsSupported();
    }
  }

  cancel() {
    this.generation += 1;
    this.speaking = false;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = undefined;
    if (this.browserTtsSupported()) window.speechSynthesis.cancel();
  }

  isSpeaking() {
    return this.speaking;
  }

  private async speakLocal(text: string, options: SpeakOptions, generation: number): Promise<BrowserVoiceResult | undefined> {
    const { profile, onState } = options;
    const voiceId = localStorage.getItem('taso-neural-voice-id') || undefined;
    try {
      onState?.('starting');
      const response = await fetch(`${API_URL}/v1/voice/local/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voiceId, speed: profile.rate }),
      });
      if (!response.ok) return undefined;
      if (generation !== this.generation) return { started: false, completed: false, retried: false, engine: 'local-neural', error: 'cancelled' };

      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return undefined;
      this.context ??= new AudioContextCtor();
      if (this.context.state === 'suspended') await this.context.resume();
      const audio = await response.arrayBuffer();
      const decoded = await this.context.decodeAudioData(audio.slice(0));
      if (generation !== this.generation) return { started: false, completed: false, retried: false, engine: 'local-neural', error: 'cancelled' };

      return await new Promise<BrowserVoiceResult>((resolve) => {
        const source = this.context!.createBufferSource();
        const gain = this.context!.createGain();
        gain.gain.value = Math.min(1, Math.max(0, profile.volume));
        source.buffer = decoded;
        source.connect(gain);
        gain.connect(this.context!.destination);
        this.source = source;
        this.speaking = true;
        onState?.('speaking');
        source.onended = () => {
          if (this.source === source) this.source = undefined;
          this.speaking = false;
          resolve({ started: true, completed: true, voiceName: voiceId, retried: false, engine: 'local-neural' });
        };
        source.start();
      });
    } catch {
      return undefined;
    }
  }

  private chooseVoice(profile: BrowserVoiceProfile, voices: SpeechSynthesisVoice[], fallback: boolean) {
    if (fallback) return undefined;
    const turkish = voices.filter((voice) => /^tr(?:-|_)/i.test(voice.lang));
    if (profile.voiceName) {
      const preferred = turkish.find((voice) => voice.name === profile.voiceName);
      if (preferred) return preferred;
    }
    return turkish.find((voice) => /^tr-TR$/i.test(voice.lang)) ?? turkish[0];
  }

  private async speakAttempt(text: string, options: SpeakOptions, fallback: boolean, generation: number): Promise<BrowserVoiceResult> {
    const { profile, voices, onState } = options;
    const selectedVoice = this.chooseVoice(profile, voices, fallback);
    const startTimeoutMs = options.startTimeoutMs ?? (isAndroid() ? 2200 : 1600);

    return new Promise<BrowserVoiceResult>((resolve) => {
      if (generation !== this.generation) {
        resolve({ started: false, completed: false, retried: fallback, engine: 'browser-tts', error: 'cancelled' });
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.lang = selectedVoice?.lang || profile.lang || 'tr-TR';
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitch;
      utterance.volume = profile.volume;

      let started = false;
      let settled = false;
      let watchdog = 0;

      const finish = (result: BrowserVoiceResult) => {
        if (settled) return;
        settled = true;
        if (watchdog) window.clearTimeout(watchdog);
        this.speaking = false;
        resolve(result);
      };

      utterance.onstart = () => {
        if (generation !== this.generation) return;
        started = true;
        this.speaking = true;
        onState?.('speaking');
      };
      utterance.onend = () => finish({ started, completed: started, voiceName: selectedVoice?.name, retried: fallback, engine: 'browser-tts' });
      utterance.onerror = (event) => finish({ started, completed: false, voiceName: selectedVoice?.name, retried: fallback, engine: 'browser-tts', error: event.error || 'speech-error' });

      watchdog = window.setTimeout(() => {
        if (!started) {
          window.speechSynthesis.cancel();
          finish({ started: false, completed: false, voiceName: selectedVoice?.name, retried: fallback, engine: 'browser-tts', error: 'speech-start-timeout' });
        }
      }, startTimeoutMs);

      onState?.('starting');
      try {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        finish({ started: false, completed: false, voiceName: selectedVoice?.name, retried: fallback, engine: 'browser-tts', error: (error as Error).message });
      }
    });
  }

  async speak(text: string, options: SpeakOptions): Promise<BrowserVoiceResult> {
    const normalized = text.trim();
    if (!normalized) return { started: false, completed: true, retried: false };

    this.cancel();
    const generation = ++this.generation;
    await this.unlock();

    const local = await this.speakLocal(normalized, options, generation);
    if (local?.started) {
      if (local.completed) options.onState?.('idle');
      return local;
    }

    if (!this.browserTtsSupported()) {
      options.onState?.('error');
      return { started: false, completed: false, retried: false, error: 'no-local-neural-or-browser-tts' };
    }

    await wait(isAndroid() ? 160 : 70);
    let result = await this.speakAttempt(normalized, options, false, generation);
    if (!result.started && generation === this.generation) {
      window.speechSynthesis.cancel();
      await wait(isAndroid() ? 280 : 120);
      result = await this.speakAttempt(normalized, options, true, generation);
    }

    if (!result.started) options.onState?.('error');
    else if (result.completed) options.onState?.('idle');
    return result;
  }
}

export const browserVoiceRuntime = new BrowserVoiceRuntime();
