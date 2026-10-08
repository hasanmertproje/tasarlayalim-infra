import { useEffect, useState } from 'react';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

function detectState(bridge: Element | null): VoiceState {
  if (!bridge) return 'idle';
  if (bridge.classList.contains('voice-listening')) return 'listening';
  if (bridge.classList.contains('voice-thinking')) return 'thinking';
  if (bridge.classList.contains('voice-speaking')) return 'speaking';
  if (bridge.classList.contains('voice-error')) return 'error';
  return 'idle';
}

function stateLabel(state: VoiceState) {
  if (state === 'listening') return 'Seni dinliyorum';
  if (state === 'thinking') return 'Düşünüyorum';
  if (state === 'speaking') return 'Yanıtlıyorum';
  if (state === 'error') return 'Ses bağlantısında sorun var';
  return 'Hazırım';
}

function commandCenterButton() {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Command Center' && !button.closest('.mobile-screen-sheet'));
}

export default function VoiceModeOverlay() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');

  useEffect(() => {
    let lastOpen = false;
    const sync = () => {
      const bridge = document.querySelector('.conversation-bridge');
      const nextOpen = Boolean(bridge?.classList.contains('live-session'));
      setOpen(nextOpen);
      setState(detectState(bridge));

      const input = bridge?.querySelector<HTMLInputElement>('.conversation-composer input');
      const userLine = bridge?.querySelector('.conversation-user-line')?.textContent?.replace(/^Sen:\s*/i, '').trim() ?? '';
      const response = bridge?.querySelector('.conversation-response p')?.textContent?.trim() ?? '';
      setHeard(input?.value?.trim() || userLine);
      setReply(response === 'Yanıt hazırlanıyor…' ? '' : response);

      if (lastOpen !== nextOpen) document.body.classList.toggle('taso-voice-mode-open', nextOpen);
      lastOpen = nextOpen;
    };

    sync();
    const root = document.getElementById('root');
    const observer = root ? new MutationObserver(sync) : undefined;
    observer?.observe(root!, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    const timer = window.setInterval(sync, 120);
    return () => {
      observer?.disconnect();
      window.clearInterval(timer);
      document.body.classList.remove('taso-voice-mode-open');
    };
  }, []);

  useEffect(() => {
    const interceptGlobalMobileMic = (event: Event) => {
      const origin = event.target as Element | null;
      const mobileMic = origin?.closest?.('.mobile-nav .mobile-taso');
      if (!mobileMic) return;

      // Command Center'da ConversationBridge bu tıklamayı kendisi yönetir.
      if (document.querySelector('.conversation-bridge')) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      commandCenterButton()?.click();

      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const mic = document.querySelector<HTMLButtonElement>('.conversation-bridge .conversation-mic');
        if (mic) {
          window.clearInterval(timer);
          mic.click();
          return;
        }
        if (attempts >= 30) window.clearInterval(timer);
      }, 50);
    };

    document.addEventListener('click', interceptGlobalMobileMic, true);
    return () => document.removeEventListener('click', interceptGlobalMobileMic, true);
  }, []);

  function conversationMic() {
    return document.querySelector<HTMLButtonElement>('.conversation-bridge .conversation-mic');
  }

  function endSession() {
    if (document.querySelector('.conversation-bridge.live-session')) conversationMic()?.click();
  }

  function interrupt() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const mic = conversationMic();
    if (!mic) return;
    if (document.querySelector('.conversation-bridge.live-session')) {
      mic.click();
      window.setTimeout(() => mic.click(), 110);
    } else {
      mic.click();
    }
  }

  function openVoiceSettings() {
    endSession();
    window.setTimeout(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.conversation-meta button')]
        .find((item) => item.textContent?.includes('Ses ayarları'));
      button?.click();
    }, 140);
  }

  if (!open) return null;

  return (
    <section className={`taso-voice-mode state-${state}`} aria-label="Taso canlı konuşma modu">
      <div className="taso-voice-mode-ambient ambient-a" />
      <div className="taso-voice-mode-ambient ambient-b" />
      <header className="taso-voice-mode-header">
        <div><span>TASO LIVE</span><strong>Canlı konuşma</strong></div>
        <button type="button" onClick={openVoiceSettings}>Ses ayarları</button>
      </header>

      <main className="taso-voice-mode-main">
        <div className="taso-voice-mode-orb" aria-hidden="true">
          <i /><i /><i />
          <div className="taso-voice-mode-core">T</div>
        </div>
        <div className="taso-voice-mode-state">
          <span>{stateLabel(state)}</span>
          <div className="taso-voice-wave"><i/><i/><i/><i/><i/><i/><i/></div>
        </div>

        <div className="taso-voice-mode-transcript" aria-live="polite">
          {heard && <div className="heard"><span>SEN</span><p>{heard}</p></div>}
          {reply && <div className="reply"><span>TASO</span><p>{reply}</p></div>}
          {!heard && !reply && <p className="voice-mode-hint">Konuşmaya başlayabilirsin. Taso seni dinliyor.</p>}
        </div>
      </main>

      <footer className="taso-voice-mode-controls">
        <button type="button" className="voice-interrupt" onClick={interrupt} disabled={state === 'thinking'}>
          <span>{state === 'speaking' ? 'Sözünü kes' : 'Konuş'}</span>
        </button>
        <button type="button" className="voice-end" onClick={endSession} aria-label="Canlı konuşmayı bitir">■</button>
        <div className="voice-mode-footnote">Chat ≠ Mission · Görevler yalnız açık onayla başlar</div>
      </footer>
    </section>
  );
}
