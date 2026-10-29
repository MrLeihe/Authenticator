import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@/ui/styles/globals.css';
import { applyTheme } from '@/ui/theme';

applyTheme();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
