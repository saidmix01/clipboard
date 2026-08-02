const { app } = require('electron');
const isDev = !app.isPackaged;

module.exports = {
  BACKEND_URL: isDev
    ? 'http://localhost:3000'
    : 'https://backend-copyfy.onrender.com',

  // Supabase Realtime (for instant cross-device sync notifications)
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
}
