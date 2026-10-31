import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Root from './Root';
import ErrorBoundary from './components/ErrorBoundary';
import { initErrorReporting } from './errorReporting';
import './index.css';

initErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
