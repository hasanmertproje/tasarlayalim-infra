import { useEffect } from 'react';
import { navigateTaso } from './navigation';

function clickConversationMic() {
  return document.querySelector<HTMLButtonElement>('.conversation-bridge .conversation-mic')?.click();
}

export default function MobileVoiceRouter() {
  useEffect(() => {
    const routeMobileVoice = (event: Event) => {
      const origin = event.target as Element | null;
      const mobileMic = origin?.closest?.('.mobile-nav .mobile-taso');
      if (!mobileMic) return;

      // If Realtime Voice already intercepted the event it stops immediate propagation before we run.
      // Otherwise never allow the legacy App.startVoice handler to own the mobile Taso button.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      navigateTaso('Command Center');
      if (document.querySelector('.conversation-bridge')) {
        clickConversationMic();
        return;
      }

      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (document.querySelector('.conversation-bridge')) {
          window.clearInterval(timer);
          clickConversationMic();
          return;
        }
        if (attempts >= 40) window.clearInterval(timer);
      }, 50);
    };

    window.addEventListener('click', routeMobileVoice, true);
    return () => window.removeEventListener('click', routeMobileVoice, true);
  }, []);

  return null;
}
