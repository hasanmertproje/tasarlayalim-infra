import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AgentOpsDock from './AgentOpsDock';
import './styles.css';
import './final.css';
import './premium.css';
import './agent-ops.css';
import './agent-ops-page.css';

const rootElement = document.getElementById('root')!;

function findButtonByText(text: string) {
  return [...rootElement.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

function AgentOpsBridge() {
  const [mode, setMode] = useState<'dock' | 'page'>('dock');

  useEffect(() => {
    const syncMode = () => {
      const heading = rootElement.querySelector('.topbar h1')?.textContent?.trim();
      setMode(heading === 'AI Agents' ? 'page' : 'dock');
    };

    syncMode();
    const observer = new MutationObserver(syncMode);
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

  return <AgentOpsDock mode={mode} />;
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <AgentOpsBridge />
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
