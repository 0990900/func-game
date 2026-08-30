import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App.tsx';
import { applyCssVariables } from './theme/tokens.ts';
import { trackAppHeight } from './ui/appHeight.ts';
import './styles/app.css';

applyCssVariables();
trackAppHeight();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
