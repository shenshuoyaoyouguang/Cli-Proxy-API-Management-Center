import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import { secureStorage } from '@/services/storage/secureStorage';
import { registerChartJSComponents } from '@/atoms/chart/register';
import App from './App.tsx';

registerChartJSComponents();

document.title = 'CLI Proxy API Management Center';
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = INLINE_LOGO_JPEG;
  faviconEl.type = 'image/jpeg';
} else {
  const newFavicon = document.createElement('link');
  newFavicon.rel = 'icon';
  newFavicon.type = 'image/jpeg';
  newFavicon.href = INLINE_LOGO_JPEG;
  document.head.appendChild(newFavicon);
}

async function bootstrap() {
  await secureStorage.migrateEncryptedKeys(['managementKey']);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
