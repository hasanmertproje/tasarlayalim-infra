import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ConversationDock from './ConversationDock';
import './styles.css';
import './final.css';
import './executor.css';
import './design-system-v2.css';
import './conversation-v2.css';
import './voice-v2.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ConversationDock />
  </React.StrictMode>,
);