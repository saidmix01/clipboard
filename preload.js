const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onClipboardUpdate: callback =>
    ipcRenderer.on('clipboard-update', (_, data) => callback(data)),

  hideWindow: () => ipcRenderer.invoke('hide-window'),

  copyText: text => {
    ipcRenderer.send('copy-to-clipboard', text) // ✅ lo enviamos al main
  },
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  //Copiar Imagen
  copyImage: dataUrl => {
    ipcRenderer.send('copy-image', dataUrl)
  },

  translateToEnglish: text => ipcRenderer.invoke('translate-to-english', text),
  // 👇 ESTA ES LA QUE FALTA
  pasteText: () => ipcRenderer.send('paste-text'),

  toggleFavorite: (payload) => ipcRenderer.send('toggle-favorite', payload),
  //Pegar imagen
  pasteImage: () => ipcRenderer.invoke('pasteImage'),
  //updates
  forceUpdate: () => ipcRenderer.send('force-update'),
  onUpdateStatus: callback => ipcRenderer.on('update-status', (_, message) => callback(message)),
  onPasteStatus: callback => ipcRenderer.on('paste-status', (_, data) => callback(data)),
  // Version app
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setAuthToken: (token) => ipcRenderer.send('set-auth-token', token),
  getClipboardHistory: () => ipcRenderer.invoke('get-clipboard-history')
  ,openImageViewer: (dataUrl) => ipcRenderer.send('open-image-viewer', dataUrl)
  ,openCodeEditor: (code) => ipcRenderer.send('open-code-editor', code)
  ,registerDevice: (clientId) => ipcRenderer.invoke('register-device', clientId)
  ,authLogin: (body) => ipcRenderer.invoke('auth-login', body)
  ,clearUserData: () => ipcRenderer.invoke('clear-user-data')
  ,listDevices: () => ipcRenderer.invoke('list-devices')
  ,loadDeviceHistory: (deviceName) => ipcRenderer.invoke('load-device-history', deviceName)
  ,switchActiveDevice: (deviceName) => ipcRenderer.invoke('switch-active-device', deviceName)
  ,getActiveDevice: () => ipcRenderer.invoke('get-active-device')
  ,onSyncProgress: (callback) => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('sync-progress', listener)
    return () => ipcRenderer.removeListener('sync-progress', listener)
  }
  ,getPreferences: () => ipcRenderer.invoke('get-preferences')
  ,setPreferences: (patch) => ipcRenderer.invoke('set-preferences', patch)
  ,searchHistory: (payload) => ipcRenderer.invoke('search-history', payload)
  ,listRecent: (payload) => ipcRenderer.invoke('list-recent', payload)
  ,installLinuxPasteSupport: () => ipcRenderer.invoke('install-linux-paste-support')
  ,deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id)
})
