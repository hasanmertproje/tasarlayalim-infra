import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AgentOpsDock from './AgentOpsDock';
import ConversationBridge from './ConversationBridge';
import IntegrationsCenter from './IntegrationsCenter';
import KnowledgeCenter from './KnowledgeCenter';
import SelfImprovementLane from './SelfImprovementLane';
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

const rootElement = document.getElementById('root')!;

function findButtonByText(text: string) {
  return [...rootElement.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

function OperationsSurfaceBridge() {
  const [activeHeading, setActiveHeading] = useState('Command Center');

  useEffect(() => {
    const syncSurface = () => {
      const heading = rootElement.querySelector('.topbar h1')?.textContent?.trim();
      if (heading) setActiveHeading(heading);
    };

    syncSurface();
    const observer = new MutationObserver(syncSurface);
    observer.observe(rootElement, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMissionOpen = (event: Event) => {
      const missionId = (event as CustomEvent<{ missionId?: string }>).detail?.missionId;
      if (!missionId) return;

      findButtonByText('Tasks')?.click();
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const row = [...rootElement.querySelectorAll<HTMLButtonElement>('.data-row')]
          .find((item) => item.textContent?.includes(missionId));
        if (row) {
          row.click();
          window.clearInterval(timer);
          return;
        }
        if (attempts >= 20) window.clearInterval(timer);
      }, 50);
    };

    window.addEventListener('taso:open-mission', handleMissionOpen);
    return () => window.removeEventListener('taso:open-mission', handleMissionOpen);
  }, []);

  return (
    <>
      {activeHeading === 'Command Center' && <ConversationBridge />}
      <AgentOpsDock mode={activeHeading === 'AI Agents' ? 'page' : 'dock'} />
      {activeHeading === 'Integrations' && <IntegrationsCenter />}
      {activeHeading === 'Knowledge' && <KnowledgeCenter />}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <OperationsSurfaceBridge />
    <SelfImprovementLane />
  </React.StrictMode>,
);

const requestedScreen = new URLSearchParams(window.location.search).get('screen');
if (requestedScreen) {
  const openRequestedScreen = () => {
    const button = findButtonByText(requestedScreen);
    if (!button) return false;
    button.click();
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  };
  if (!openRequestedScreen()) {
    const observer = new MutationObserver(() => {
      if (openRequestedScreen()) observer.disconnect();
    });
    observer.observe(rootElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);
  }
}
