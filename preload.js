const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Clipboard
  onClipboardUpdate: callback =>
    ipcRenderer.on('clipboard-update', (_, data) => callback(data)),
  getClipboardHistory: (opts) => ipcRenderer.invoke('get-clipboard-history', opts),
  copyText: text => ipcRenderer.send('copy-to-clipboard', text),
  copyImage: dataUrl => ipcRenderer.send('copy-image', dataUrl),
  pasteText: () => ipcRenderer.send('paste-text'),
  
  // History Management
  deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  toggleFavorite: (item) => ipcRenderer.send('toggle-favorite', item),
  searchHistory: (payload) => ipcRenderer.invoke('search-history', payload),

  // Window & App
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getHostname: () => ipcRenderer.invoke('get-hostname'),
  
  // Config (Local)
  getConfig: (key) => ipcRenderer.invoke('get-config', key),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  removeConfig: (key) => ipcRenderer.invoke('remove-config', key),
  
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreferences: (prefs) => ipcRenderer.invoke('set-preferences', prefs),

  // Device Management
  getCurrentDevice: () => ipcRenderer.invoke('get-current-device'),
  registerNewDevice: (name) => ipcRenderer.invoke('register-new-device', name),

  // Stubs for removed features (to prevent frontend crash if called)
  syncNow: () => {},
  listDevices: () => Promise.resolve([]),
  registerDevice: () => Promise.resolve(),
  authLogin: () => Promise.resolve({ token: 'local-token' }),
  setAuthToken: () => {},
  readSession: () => Promise.resolve(null),
  openImageViewer: (url) => ipcRenderer.send('open-image-viewer', url),
  
  // OCR Window
  openOCRWindow: (path) => ipcRenderer.send('open-ocr-window', path),
  onOCRLoadImage: (callback) => {
      ipcRenderer.on('ocr-load-image', (_, path) => callback(path))
  },

  // Code Editor
  openCodeEditor: (content) => ipcRenderer.send('open-code-editor', content),
  signalCodeReady: () => ipcRenderer.send('code-window-ready'),
  onCodeLoadContent: (callback) => {
      const listener = (_, content) => callback(content)
      ipcRenderer.on('code-load-content', listener)
      return () => ipcRenderer.removeListener('code-load-content', listener)
  },

  // Notification Window
  signalNotificationReady: () => ipcRenderer.send('notification-window-ready'),
  onNotificationLoadImage: (callback) => {
      const listener = (_, img) => callback(img)
      ipcRenderer.on('notification-load-image', listener)
      return () => ipcRenderer.removeListener('notification-load-image', listener)
  },
  sendNotificationAction: (action) => ipcRenderer.send('notification-action', action)
})

contextBridge.exposeInMainWorld('copyfy', {
  getSystemLocale: () => ipcRenderer.invoke('get-system-locale')
})
