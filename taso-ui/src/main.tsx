import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AgentOpsDock from './AgentOpsDock';
import CommandCenterV8 from './CommandCenterV8';
import IntegrationsCenter from './IntegrationsCenter';
import KnowledgeCenter from './KnowledgeCenter';
import MissionExecutionLive from './MissionExecutionLive';
import MobileNavigationHub from './MobileNavigationHub';
import MobileVoiceRouter from './MobileVoiceRouter';
import SelfImprovementLane from './SelfImprovementLane';
import TruthSurfaces from './TruthSurfaces';
import VoiceIdentitySettings from './VoiceIdentitySettings';
import VoiceModeOverlay from './VoiceModeOverlay';
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
import './command-center-v10.css';
import './truth-surfaces.css';
import './voice-identity-v2.css';
import './mission-execution-live.css';
import './command-center-v8.css';

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

  const showExecution = activeScreen === 'Tasks' || activeScreen === 'AI Agents';

  return (
    <>
      {activeScreen === 'Command Center' && <CommandCenterV8 />}
      {activeScreen !== 'Command Center' && <AgentOpsDock mode={activeScreen === 'AI Agents' ? 'page' : 'dock'} />}
      {showExecution && <MissionExecutionLive expanded={activeScreen === 'AI Agents'} />}
      {activeScreen === 'Integrations' && <IntegrationsCenter />}
      {activeScreen === 'Knowledge' && <KnowledgeCenter />}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <OperationsSurfaceBridge />
    <TruthSurfaces />
    <VoiceIdentitySettings />
    <MobileNavigationHub />
    <VoiceModeOverlay />
    <MobileVoiceRouter />
    <SelfImprovementLane />
  </React.StrictMode>,
);