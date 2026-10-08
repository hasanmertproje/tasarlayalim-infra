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
  error?: string;
};

type SpeakOptions = {
  profile: BrowserVoiceProfile;
  voices: SpeechSynthesisVoice[];
  onState?: (state: BrowserVoiceRuntimeState) => void;
  startTimeoutMs?: number;
};

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export class BrowserVoiceRuntime {
  private context?: AudioContext;
  private speaking = false;
  private generation = 0;

  supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  async unlock() {
    if (!this.supported()) return false;
    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return true;
      this.context ??= new AudioContextCtor();
      if (this.context.state === 'suspended') await this.context.resume();

      // Prime the media/audio path inside the user's gesture without producing audible output.
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      gain.gain.value = 0.00001;
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start();
      oscillator.stop(this.context.currentTime + 0.015);
      return true;
    } catch {
      // Web Speech may still work even when WebAudio unlock is unavailable.
      return true;
    }
  }

  cancel() {
    this.generation += 1;
    this.speaking = false;
    if (this.supported()) window.speechSynthesis.cancel();
  }

  isSpeaking() {
    return this.speaking;
  }

  private chooseVoice(profile: BrowserVoiceProfile, voices: SpeechSynthesisVoice[], fallback: boolean) {
    const turkish = voices.filter((voice) => /^tr(?:-|_)/i.test(voice.lang));
    if (!fallback && profile.voiceName) {
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
        resolve({ started: false, completed: false, retried: fallback, error: 'cancelled' });
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
      utterance.onend = () => finish({ started, completed: started, voiceName: selectedVoice?.name, retried: fallback });
      utterance.onerror = (event) => finish({ started, completed: false, voiceName: selectedVoice?.name, retried: fallback, error: event.error || 'speech-error' });

      watchdog = window.setTimeout(() => {
        if (!started) {
          window.speechSynthesis.cancel();
          finish({ started: false, completed: false, voiceName: selectedVoice?.name, retried: fallback, error: 'speech-start-timeout' });
        }
      }, startTimeoutMs);

      onState?.('starting');
      try {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        finish({ started: false, completed: false, voiceName: selectedVoice?.name, retried: fallback, error: (error as Error).message });
      }
    });
  }

  async speak(text: string, options: SpeakOptions): Promise<BrowserVoiceResult> {
    if (!this.supported()) {
      options.onState?.('error');
      return { started: false, completed: false, retried: false, error: 'speech-synthesis-unsupported' };
    }
    const normalized = text.trim();
    if (!normalized) return { started: false, completed: true, retried: false };

    this.cancel();
    const generation = ++this.generation;
    await this.unlock();
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
