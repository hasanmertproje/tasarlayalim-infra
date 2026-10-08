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
    const button = [...rootElement.querySelectorAll('button')].find((item) => item.textContent?.trim() === requestedScreen);
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
