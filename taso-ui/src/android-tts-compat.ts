const INSTALL_FLAG = '__tasoAndroidTtsCompatInstalled';

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function cloneUtterance(source: SpeechSynthesisUtterance) {
  const retry = new SpeechSynthesisUtterance(source.text);
  retry.lang = source.lang || 'tr-TR';
  retry.rate = source.rate;
  retry.pitch = source.pitch;
  retry.volume = source.volume;
  return retry;
}

export function installAndroidTtsCompat() {
  if (typeof window === 'undefined' || !isAndroid() || !('speechSynthesis' in window)) return;

  const globalWindow = window as typeof window & { [INSTALL_FLAG]?: boolean };
  if (globalWindow[INSTALL_FLAG]) return;
  globalWindow[INSTALL_FLAG] = true;

  const synth = window.speechSynthesis;
  const nativeSpeak = synth.speak.bind(synth);
  const nativeCancel = synth.cancel.bind(synth);
  const nativeResume = synth.resume.bind(synth);

  const wake = () => {
    try { nativeResume(); } catch { /* Android engines can throw while booting. */ }
  };

  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('touchstart', wake, { passive: true });

  (synth as SpeechSynthesis & { speak: (utterance: SpeechSynthesisUtterance) => void }).speak = (utterance) => {
    const originalStart = utterance.onstart;
    const originalEnd = utterance.onend;
    const originalError = utterance.onerror;
    let started = false;
    let finished = false;
    let retryStarted = false;

    const markStart = (event: SpeechSynthesisEvent) => {
      started = true;
      originalStart?.call(utterance, event);
    };
    const markEnd = (event: SpeechSynthesisEvent) => {
      finished = true;
      originalEnd?.call(utterance, event);
    };
    const markError = (event: SpeechSynthesisErrorEvent) => {
      finished = true;
      originalError?.call(utterance, event);
    };

    utterance.onstart = markStart;
    utterance.onend = markEnd;
    utterance.onerror = markError;

    // Android Chrome can silently drop a speak() issued in the same tick as cancel().
    // Give the TTS service a short settle window and explicitly resume it first.
    window.setTimeout(() => {
      if (finished) return;
      wake();
      nativeSpeak(utterance);
    }, 110);

    // If the selected voice never starts, retry once with the system tr-TR voice.
    window.setTimeout(() => {
      if (started || finished) return;
      retryStarted = true;
      nativeCancel();
      wake();

      const retry = cloneUtterance(utterance);
      retry.voice = null;
      retry.lang = 'tr-TR';
      retry.onstart = (event) => {
        started = true;
        originalStart?.call(utterance, event);
      };
      retry.onend = (event) => {
        finished = true;
        originalEnd?.call(utterance, event);
      };
      retry.onerror = (event) => {
        finished = true;
        originalError?.call(utterance, event);
      };
      nativeSpeak(retry);
    }, 1500);

    // Never leave the UI stuck on "Düşünüyorum" when the device TTS engine is unavailable.
    window.setTimeout(() => {
      if (started || finished || !retryStarted) return;
      finished = true;
      try {
        originalError?.call(utterance, new Event('error') as unknown as SpeechSynthesisErrorEvent);
      } catch {
        // The UI already has the transcript, so failing closed here is preferable to hanging.
      }
    }, 3400);
  };
}
