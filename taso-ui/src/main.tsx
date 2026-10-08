import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AgentOpsDock from './AgentOpsDock';
import ConversationBridge from './ConversationBridge';
import IntegrationsCenter from './IntegrationsCenter';
import KnowledgeCenter from './KnowledgeCenter';
import MobileNavigationHub from './MobileNavigationHub';
import SelfImprovementLane from './SelfImprovementLane';
import VoiceModeOverlay from './VoiceModeOverlay';
import { installAndroidTtsCompat } from './android-tts-compat';
import { isTasoScreen, navigateTaso, useTasoNavigation } from './navigation';
import './styles.css';
import './final.css';
import './premium.css';
import './agent-ops.css';
import './milestones.css';
import './self-improvement.css';
import './agent-ops-page.css';
import './agent-ops-interactions.css';
import './integrations-center.css';
import './knowledge-center.css';
import './conversation-bridge.css';
import './taso-voice-signature.css';
import './mobile-command-center-v3.css';
import './mobile-light-contrast-v3.css';
import './mobile-floating-controls-v3.css';
import './mobile-navigation-hub.css';
import './voice-mode-overlay.css';
import './mobile-shell-v4.css';

installAndroidTtsCompat();

const rootElement = document.getElementById('root')!;
const requestedScreen = new URLSearchParams(window.location.search).get('screen');
if (isTasoScreen(requestedScreen)) {
  navigateTaso(requestedScreen);
  window.history.replaceState({}, '', window.location.pathname);
}

function OperationsSurfaceBridge() {
  const [activeScreen, navigate] = useTasoNavigation();

  useEffect(() => {
    const handleMissionOpen = (event: Event) => {
      const missionId = (event as CustomEvent<{ missionId?: string }>).detail?.missionId;
      if (!missionId) return;

      navigate('Tasks');
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const row = [...rootElement.querySelectorAll<HTMLButtonElement>('.data-row')]
          .find((item) => item.textContent?.includes(missionId));
        if (row) {
          row.click();
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          window.clearInterval(timer);
          return;
        }
        if (attempts >= 20) window.clearInterval(timer);
      }, 50);
    };

    window.addEventListener('taso:open-mission', handleMissionOpen);
    return () => window.removeEventListener('taso:open-mission', handleMissionOpen);
  }, [navigate]);

  return (
    <>
      {activeScreen === 'Command Center' && <ConversationBridge />}
      <AgentOpsDock mode={activeScreen === 'AI Agents' ? 'page' : 'dock'} />
      {activeScreen === 'Integrations' && <IntegrationsCenter />}
      {activeScreen === 'Knowledge' && <KnowledgeCenter />}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <OperationsSurfaceBridge />
    <MobileNavigationHub />
    <VoiceModeOverlay />
    <SelfImprovementLane />
  </React.StrictMode>,
);
