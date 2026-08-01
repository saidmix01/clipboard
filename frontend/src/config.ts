/**
 * API_BASE — Solo se usa para resolver URLs de assets estáticos (avatares, uploads).
 * NO usar para requests HTTP. Todos los requests van por IPC → BackendDaemon → Axios.
 * La URL real del backend se configura en clipboard/config.js (BACKEND_URL).
 */
const isDev = import.meta.env.DEV;

export const API_BASE = isDev
  ? 'http://localhost:3000'
  : 'https://backend-copyfy.onrender.com'
