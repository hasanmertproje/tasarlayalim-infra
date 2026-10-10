import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AgentFleetV11 from './AgentFleetV11';
import AgentOpsDock from './AgentOpsDock';
import ApprovalCenterV9 from './ApprovalCenterV9';
import AuthGateV17 from './AuthGateV17';
import CommandCenterV21 from './CommandCenterV21';
import GlobalUiControlsV11 from './GlobalUiControlsV11';
import IntegrationsCenter from './IntegrationsCenter';
import KnowledgeCenter from './KnowledgeCenter';
import MissionControlV8 from './MissionControlV8';
import MobileNavigationHub from './MobileNavigationHub';
import MobileVoiceRouter from './MobileVoiceRouter';
import NotificationsCenterV12 from './NotificationsCenterV12';
import OperationsCenterV10 from './OperationsCenterV10';
import ProjectCenterV9 from './ProjectCenterV9';
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
import './mission-control-v8.css';
import './mission-intelligence-v8.css';
import './operations-v9.css';
import './operations-center-v10.css';
import './agent-fleet-v11.css';
import './agent-artifacts-v14.css';
import './command-center-foundation-v11.css';
import './notifications-center-v12.css';
import './settings-command-center-v12.css';
import './context-integrations-v13.css';
/* Premium Reset V16 intentionally loads last and owns global design/layout contracts. */
import './premium-reset-v16.css';
import './auth-v17.css';
/* Command Center V21 is the final owner of the dashboard surface. */
import './command-center-v21.css';
/* Voice Experience V22 is the final owner of cinematic live voice presentation. */
import './voice-experience-v22.css';
/* V23 unifies detailed Projects / Missions / Agents / Approvals surfaces. */
import './operations-surfaces-v23.css';

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
    };

    window.addEventListener('taso:open-mission', handleMissionOpen);
    return () => window.removeEventListener('taso:open-mission', handleMissionOpen);
  }, [navigate]);

  const hasDedicatedSurface = activeScreen === 'Command Center'
    || activeScreen === 'Projects'
    || activeScreen === 'Tasks'
    || activeScreen === 'Approvals'
    || activeScreen === 'Deployments'
    || activeScreen === 'Monitoring'
    || activeScreen === 'AI Agents'
    || activeScreen === 'Notifications'
    || activeScreen === 'Knowledge'
    || activeScreen === 'Integrations';

  return (
    <>
      {activeScreen === 'Command Center' && <CommandCenterV21 />}
      {activeScreen === 'Projects' && <ProjectCenterV9 />}
      {activeScreen === 'Tasks' && <MissionControlV8 />}
      {activeScreen === 'Approvals' && <ApprovalCenterV9 />}
      {activeScreen === 'Deployments' && <OperationsCenterV10 mode="deployments" />}
      {activeScreen === 'Monitoring' && <OperationsCenterV10 mode="monitoring" />}
      {activeScreen === 'AI Agents' && <AgentFleetV11 />}
      {activeScreen === 'Notifications' && <NotificationsCenterV12 />}
      {activeScreen === 'Integrations' && <IntegrationsCenter />}
      {activeScreen === 'Knowledge' && <KnowledgeCenter />}
      {!hasDedicatedSurface && <AgentOpsDock mode="dock" />}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthGateV17>
      <App />
      <OperationsSurfaceBridge />
      <TruthSurfaces />
      <VoiceIdentitySettings />
      <MobileNavigationHub />
      <VoiceModeOverlay />
      <MobileVoiceRouter />
      <SelfImprovementLane />
      <GlobalUiControlsV11 />
    </AuthGateV17>
  </React.StrictMode>,
);
