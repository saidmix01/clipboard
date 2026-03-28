// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import OCRWindow from './components/OCRWindow';
import CodeWindow from './components/CodeWindow';
import NotificationWindow from './components/NotificationWindow';
import './index.css';
import { initI18n } from './i18n';

initI18n().then(() => {
  // Check modes
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')

  let Component = App
  if (mode === 'ocr') Component = OCRWindow
  if (mode === 'code') Component = CodeWindow
  if (mode === 'notification') Component = NotificationWindow

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Component />
    </StrictMode>
  );
});
