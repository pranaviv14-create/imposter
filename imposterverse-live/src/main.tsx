import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: once the app has loaded, a service worker keeps a copy of
// everything it fetched so pass-the-phone mode works with no connection.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const urls = [location.pathname, ...performance.getEntriesByType('resource').map((e) => e.name)].filter((u) => !u.includes('/ws') && !u.includes('/api/'));
      (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'warm', urls });
    } catch (e) {
      console.warn('[sw] registration failed', e);
    }
  });
}
