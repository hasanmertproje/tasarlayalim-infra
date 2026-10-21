import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import DashboardShellV2 from './DashboardShellV2';
import NextWorkspace from './NextWorkspace';
import TasoStudioV1 from './TasoStudioV1';
import AgentFleetV11 from './AgentFleetV11';
import AgentOpsDock from './AgentOpsDock';
import ApprovalCenterV9 from './ApprovalCenterV9';
import AuthGateV17 from './AuthGateV17';
import BrandingRuntimeV29 from './BrandingRuntimeV29';
import CommandCenterV30 from './CommandCenterV30';
import ControlPlaneExtrasV29 from './ControlPlaneExtrasV29';
import ControlPlaneV29 from './ControlPlaneV29';
import IntegrationsCenterV29 from './IntegrationsCenterV29';
import KnowledgeCenter from './KnowledgeCenter';
import MissionControlV8 from './MissionControlV8';
import NotificationsCenterV12 from './NotificationsCenterV12';
import OperationsCenterV10 from './OperationsCenterV10';
import PersonalizationPanelV31 from './PersonalizationPanelV31';
import ProjectCenterV9 from './ProjectCenterV9';
import TruthSurfaces from './TruthSurfaces';
import WorkspaceCapabilityPage from './WorkspaceCapabilityPage';
import WorkspaceChatRoute from './WorkspaceChatRoute';
import VoiceModeOverlay from './VoiceModeOverlay';
import { isTasoScreen, initializeTasoScreen, navigateTaso, useTasoNavigation } from './navigation';
import './styles.css';import './final.css';import './premium.css';import './agent-ops.css';import './milestones.css';import './self-improvement.css';import './agent-ops-page.css';import './agent-ops-interactions.css';import './integrations-center.css';import './knowledge-center.css';import './conversation-bridge.css';import './taso-voice-signature.css';import './mobile-command-center-v3.css';import './mobile-light-contrast-v3.css';import './mobile-floating-controls-v3.css';import './mobile-navigation-hub.css';import './voice-mode-overlay.css';import './mobile-shell-v4.css';import './command-center-v10.css';import './truth-surfaces.css';import './voice-identity-v2.css';import './mission-execution-live.css';import './command-center-v8.css';import './mission-control-v8.css';import './mission-intelligence-v8.css';import './operations-v9.css';import './operations-center-v10.css';import './agent-fleet-v11.css';import './agent-artifacts-v14.css';import './command-center-foundation-v11.css';import './notifications-center-v12.css';import './settings-command-center-v12.css';import './context-integrations-v13.css';import './premium-reset-v16.css';import './auth-v17.css';import './command-center-v21.css';import './voice-experience-v22.css';import './operations-surfaces-v23.css';import './control-plane-v24.css';import './command-center-v29.css';import './dashboard-chat-core-voice.css';import './control-plane-v29.css';import './control-plane-extras-v29.css';import './integrations-v29.css';import './acceptance-hotfix-v29.css';import './personalization-v31.css';import './final-completion-v31.css';import './glass-dashboard.css';import './voice-glass-hotfix.css';import './dashboard-shell-v2.css';import './command-center-v30.css';import './taso-next-foundation.css';import './taso-studio-v1.css';
const rootElement=document.getElementById('root')!;const requestedScreen=new URLSearchParams(window.location.search).get('screen');if(isTasoScreen(requestedScreen)){initializeTasoScreen(requestedScreen)}
function OperationsSurfaceBridge(){
 const[activeScreen,navigate]=useTasoNavigation();
 useEffect(()=>{const handle=(event:Event)=>{const missionId=(event as CustomEvent<{missionId?:string}>).detail?.missionId;if(missionId)navigate('Tasks')};window.addEventListener('taso:open-mission',handle);return()=>window.removeEventListener('taso:open-mission',handle)},[navigate]);
 const dedicated=['Command Center','Projects','Tasks','Approvals','Deployments','Monitoring','AI Agents','Notifications','Knowledge','Integrations','Settings','Workspace','Studio','Infrastructure','My Projects','Assign TASO','Work Together','Workspace Studio','Live Site Editor','Code & Files','Content','My Agents','Conversations','Task History','Publications','Team','Workspace Notifications','Personalization','Account Settings'].includes(activeScreen);
 const capability=['Infrastructure','Live Site Editor','Code & Files','Team','Personalization','Account Settings'].includes(activeScreen);
 return <>
  {(activeScreen==='Command Center'||activeScreen==='Assign TASO')&&<CommandCenterV30/>}
  {activeScreen==='Workspace'&&<NextWorkspace/>}
  {(activeScreen==='Studio'||activeScreen==='Workspace Studio')&&<TasoStudioV1/>}
  {(activeScreen==='Work Together'||activeScreen==='Conversations')&&<WorkspaceChatRoute screen={activeScreen}/>} 
  {(activeScreen==='Projects'||activeScreen==='My Projects')&&<ProjectCenterV9/>}
  {(activeScreen==='Tasks'||activeScreen==='Task History')&&<MissionControlV8/>}
  {activeScreen==='Approvals'&&<ApprovalCenterV9/>}
  {(activeScreen==='Deployments'||activeScreen==='Publications')&&<OperationsCenterV10 mode="deployments"/>}
  {activeScreen==='Monitoring'&&<OperationsCenterV10 mode="monitoring"/>}
  {(activeScreen==='AI Agents'||activeScreen==='My Agents')&&<AgentFleetV11/>}
  {(activeScreen==='Notifications'||activeScreen==='Workspace Notifications')&&<NotificationsCenterV12/>}
  {(activeScreen==='Integrations')&&<IntegrationsCenterV29/>}
  {(activeScreen==='Knowledge'||activeScreen==='Content')&&<KnowledgeCenter/>}
  {activeScreen==='Settings'&&<ControlPlaneV29/>}
  {capability&&<WorkspaceCapabilityPage screen={activeScreen}/>}
  {!dedicated&&<AgentOpsDock mode="dock"/>}
 </>;
}
ReactDOM.createRoot(rootElement).render(<React.StrictMode><AuthGateV17><BrandingRuntimeV29/><DashboardShellV2><OperationsSurfaceBridge/></DashboardShellV2><TruthSurfaces/><VoiceModeOverlay/><ControlPlaneExtrasV29/><PersonalizationPanelV31/></AuthGateV17></React.StrictMode>);
