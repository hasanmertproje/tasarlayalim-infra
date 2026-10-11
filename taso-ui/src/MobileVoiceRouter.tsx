import { useEffect } from 'react';
import { navigateTaso } from './navigation';

function dashboardVoiceMic() {
  return document.querySelector<HTMLButtonElement>('.dashboard-chat .dashboard-chat-mic');
}

export default function MobileVoiceRouter() {
  useEffect(() => {
    const routeMobileVoice = (event: Event) => {
      const origin = event.target as Element | null;
      const mobileMic = origin?.closest?.('.mobile-nav .mobile-taso');
      if (!mobileMic) return;

      // The mobile entry must always enter DashboardChat. DashboardChat submits only
      // final transcripts through the normal Core conversation endpoint, so voice
      // never gains a separate provider/tool/mission boundary.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      navigateTaso('Command Center');
      const immediate = dashboardVoiceMic();
      if (immediate) {
        immediate.click();
        return;
      }

      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const mic = dashboardVoiceMic();
        if (mic) {
          window.clearInterval(timer);
          mic.click();
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
