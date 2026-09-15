import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

async function start() {
  if (import.meta.env.VITE_CLC_BROWSER_TEST === '1') {
    const { installBrowserTestApi } = await import('./lib/browser-test-api');
    installBrowserTestApi();
  }

  createRoot(document.getElementById('root')!, {
    // Keeps caught errors off reportError(), which would raise the dev overlay.
    onCaughtError: (error, errorInfo) => {
      console.error(error, errorInfo.componentStack);
    },
  }).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

void start();
