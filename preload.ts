import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Define types for better safety if needed, but for now we keep it compatible
// with the existing frontend which expects 'electronAPI' global.

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Clipboard & Core ---
  onClipboardUpdate: (callback: (data: any) => void) =>
    ipcRenderer.on('clipboard-update', (_, data) => callback(data)),
  getClipboardHistory: (opts: any) => ipcRenderer.invoke('get-clipboard-history', opts),
  copyText: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
  copyImage: (dataUrl: string) => ipcRenderer.send('copy-image', dataUrl),
  pasteText: () => ipcRenderer.send('paste-text'),
  
  // --- History ---
  deleteHistoryItem: (id: string) => ipcRenderer.invoke('delete-history-item', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  toggleFavorite: (item: any) => ipcRenderer.send('toggle-favorite', item),
  searchHistory: (payload: any) => ipcRenderer.invoke('search-history', payload),

  // --- Window ---
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getHostname: () => ipcRenderer.invoke('get-hostname'),
  
  // --- Config ---
  getConfig: (key: string) => ipcRenderer.invoke('get-config', key),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('set-config', key, value),
  removeConfig: (key: string) => ipcRenderer.invoke('remove-config', key),
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreferences: (prefs: any) => ipcRenderer.invoke('set-preferences', prefs),

  // --- Devices ---
  getCurrentDevice: () => ipcRenderer.invoke('get-current-device'),
  getAllDevices: () => ipcRenderer.invoke('get-all-devices'),
  registerNewDevice: (name: string) => ipcRenderer.invoke('register-new-device', name),
  setActiveDevice: (id: string) => ipcRenderer.invoke('set-active-device', id),
  
  // Sync
  notifyLoginSuccess: () => ipcRenderer.send('auth:login-success'),
  onDevicesSyncStart: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('devices:sync-start', listener);
      return () => ipcRenderer.removeListener('devices:sync-start', listener);
  },
  onDevicesSyncComplete: (callback: (devices: any[]) => void) => {
      const listener = (_: any, devices: any[]) => callback(devices);
      ipcRenderer.on('devices:sync-complete', listener);
      return () => ipcRenderer.removeListener('devices:sync-complete', listener);
  },

  // --- Backend Daemon API (New) ---
  backend: {
    // General request method (preferred over direct fetch in renderer)
    request: (config: any) => ipcRenderer.invoke('backend-request', config),
    
    // Auth helpers
    getValidToken: () => ipcRenderer.invoke('auth-get-valid-token'),
    refreshToken: () => ipcRenderer.invoke('auth-force-refresh'),
  },

  // --- Legacy / UI Features ---
  openImageViewer: (url: string) => ipcRenderer.send('open-image-viewer', url),
  openOCRWindow: (path: string) => ipcRenderer.send('open-ocr-window', path),
  onOCRLoadImage: (callback: (path: string) => void) => {
      ipcRenderer.on('ocr-load-image', (_, path) => callback(path))
  },
  openCodeEditor: (content: string) => ipcRenderer.send('open-code-editor', content),
  signalCodeReady: () => ipcRenderer.send('code-window-ready'),
  onCodeLoadContent: (callback: (content: string) => void) => {
      const listener = (_: IpcRendererEvent, content: string) => callback(content)
      ipcRenderer.on('code-load-content', listener)
      return () => ipcRenderer.removeListener('code-load-content', listener)
  },
  signalNotificationReady: () => ipcRenderer.send('notification-window-ready'),
  onNotificationLoadImage: (callback: (img: any) => void) => {
      const listener = (_: IpcRendererEvent, img: any) => callback(img)
      ipcRenderer.on('notification-load-image', listener)
      return () => ipcRenderer.removeListener('notification-load-image', listener)
  },
  sendNotificationAction: (action: string) => ipcRenderer.send('notification-action', action),

  // Deprecated / Stubs
  syncNow: () => {},
  listDevices: () => Promise.resolve([]),
  registerDevice: () => Promise.resolve(),
  authLogin: () => Promise.resolve({ token: 'local-token' }),
  setAuthToken: () => {},
  readSession: () => Promise.resolve(null),
});

contextBridge.exposeInMainWorld('copyfy', {
  getSystemLocale: () => ipcRenderer.invoke('get-system-locale')
});
