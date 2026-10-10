import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AgentFleetV11 from './AgentFleetV11';
import AgentOpsDock from './AgentOpsDock';
import ApprovalCenterV9 from './ApprovalCenterV9';
import AuthGateV17 from './AuthGateV17';
import BrandingRuntimeV29 from './BrandingRuntimeV29';
import CommandCenterV29 from './CommandCenterV29';
import ControlPlaneExtrasV29 from './ControlPlaneExtrasV29';
import ControlPlaneV29 from './ControlPlaneV29';
import GlobalUiControlsV11 from './GlobalUiControlsV11';
import IntegrationsCenterV29 from './IntegrationsCenterV29';
import KnowledgeCenter from './KnowledgeCenter';
import MissionControlV8 from './MissionControlV8';
import MobileNavigationHub from './MobileNavigationHub';
import MobileVoiceRouter from './MobileVoiceRouter';
import NotificationsCenterV12 from './NotificationsCenterV12';
import OperationsCenterV10 from './OperationsCenterV10';
import ProjectCenterV9 from './ProjectCenterV9';
import TruthSurfaces from './TruthSurfaces';
import VoiceModeOverlay from './VoiceModeOverlay';
import { isTasoScreen, navigateTaso, useTasoNavigation } from './navigation';
import './styles.css';import './final.css';import './premium.css';import './agent-ops.css';import './milestones.css';import './self-improvement.css';import './agent-ops-page.css';import './agent-ops-interactions.css';import './integrations-center.css';import './knowledge-center.css';import './conversation-bridge.css';import './taso-voice-signature.css';import './mobile-command-center-v3.css';import './mobile-light-contrast-v3.css';import './mobile-floating-controls-v3.css';import './mobile-navigation-hub.css';import './voice-mode-overlay.css';import './mobile-shell-v4.css';import './command-center-v10.css';import './truth-surfaces.css';import './voice-identity-v2.css';import './mission-execution-live.css';import './command-center-v8.css';import './mission-control-v8.css';import './mission-intelligence-v8.css';import './operations-v9.css';import './operations-center-v10.css';import './agent-fleet-v11.css';import './agent-artifacts-v14.css';import './command-center-foundation-v11.css';import './notifications-center-v12.css';import './settings-command-center-v12.css';import './context-integrations-v13.css';import './premium-reset-v16.css';import './auth-v17.css';import './command-center-v21.css';import './voice-experience-v22.css';import './operations-surfaces-v23.css';import './control-plane-v24.css';import './command-center-v29.css';import './control-plane-v29.css';import './control-plane-extras-v29.css';import './integrations-v29.css';import './acceptance-hotfix-v29.css';
const rootElement=document.getElementById('root')!;const requestedScreen=new URLSearchParams(window.location.search).get('screen');if(isTasoScreen(requestedScreen)){navigateTaso(requestedScreen);window.history.replaceState({},'',window.location.pathname)}
function OperationsSurfaceBridge(){const[activeScreen,navigate]=useTasoNavigation();useEffect(()=>{const handle=(event:Event)=>{const missionId=(event as CustomEvent<{missionId?:string}>).detail?.missionId;if(missionId)navigate('Tasks')};window.addEventListener('taso:open-mission',handle);return()=>window.removeEventListener('taso:open-mission',handle)},[navigate]);const dedicated=['Command Center','Projects','Tasks','Approvals','Deployments','Monitoring','AI Agents','Notifications','Knowledge','Integrations','Settings'].includes(activeScreen);return <>{activeScreen==='Command Center'&&<CommandCenterV29/>}{activeScreen==='Projects'&&<ProjectCenterV9/>}{activeScreen==='Tasks'&&<MissionControlV8/>}{activeScreen==='Approvals'&&<ApprovalCenterV9/>}{activeScreen==='Deployments'&&<OperationsCenterV10 mode="deployments"/>}{activeScreen==='Monitoring'&&<OperationsCenterV10 mode="monitoring"/>}{activeScreen==='AI Agents'&&<AgentFleetV11/>}{activeScreen==='Notifications'&&<NotificationsCenterV12/>}{activeScreen==='Integrations'&&<IntegrationsCenterV29/>}{activeScreen==='Knowledge'&&<KnowledgeCenter/>}{activeScreen==='Settings'&&<ControlPlaneV29/>}{!dedicated&&<AgentOpsDock mode="dock"/>}</>}
ReactDOM.createRoot(rootElement).render(<React.StrictMode><AuthGateV17><BrandingRuntimeV29/><App/><OperationsSurfaceBridge/><TruthSurfaces/><MobileNavigationHub/><VoiceModeOverlay/><MobileVoiceRouter/><ControlPlaneExtrasV29/><GlobalUiControlsV11/></AuthGateV17></React.StrictMode>);
