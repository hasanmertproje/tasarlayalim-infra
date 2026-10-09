import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import TasoOperationsApp from './TasoOperationsApp';
import ConversationBridgeV2 from './ConversationBridgeV2';
import IntegrationsCenter from './IntegrationsCenter';
import IntegrationVoicePlane from './IntegrationVoicePlane';
import KnowledgeCenter from './KnowledgeCenter';
import RuntimeCompatibilityBridge from './RuntimeCompatibilityBridge';
import TruthSurfaces from './TruthSurfaces';
import VoiceIdentitySettings from './VoiceIdentitySettings';
import VoiceModeOverlay from './VoiceModeOverlay';
import { isTasoScreen, navigateTaso, useTasoNavigation } from './navigation';
import './styles.css';
import './conversation-bridge.css';
import './integrations-center.css';
import './knowledge-center.css';
import './truth-surfaces.css';
import './voice-mode-overlay.css';
import './voice-identity-v2.css';
import './nova-ops.css';
import './nova-ops-patch.css';

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

  return (
    <>
      {activeScreen === 'Command Center' && <ConversationBridgeV2 />}
      {activeScreen === 'Integrations' && <><IntegrationsCenter /><IntegrationVoicePlane /></>}
      {activeScreen === 'Knowledge' && <KnowledgeCenter />}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TasoOperationsApp />
    <RuntimeCompatibilityBridge />
    <OperationsSurfaceBridge />
    <TruthSurfaces />
    <VoiceIdentitySettings />
    <VoiceModeOverlay />
  </React.StrictMode>,
);