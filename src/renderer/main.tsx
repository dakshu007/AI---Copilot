import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { CopilotProvider } from './app/CopilotProvider';
import { OverlayApp } from './app/OverlayApp';
import './styles/index.css';

// The same renderer bundle serves the dashboard and the compact answer window (#overlay).
const isOverlay = window.location.hash.replace(/^#/, '') === 'overlay';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CopilotProvider>{isOverlay ? <OverlayApp /> : <App />}</CopilotProvider>
  </StrictMode>,
);
