// src/main.tsx o src/index.tsx
import 'bootstrap/dist/css/bootstrap.min.css'; // 👈 AÑADE ESTO
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
