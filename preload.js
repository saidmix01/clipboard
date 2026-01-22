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
  onUpdateStatus: callback => {
    const listener = (_, message) => callback(message)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },
  onPasteStatus: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('paste-status', listener)
    return () => ipcRenderer.removeListener('paste-status', listener)
  },
  // Version app
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setAuthToken: (token) => ipcRenderer.send('set-auth-token', token),
  getClipboardHistory: () => ipcRenderer.invoke('get-clipboard-history')
  ,openImageViewer: (dataUrl) => ipcRenderer.send('open-image-viewer', dataUrl)
  ,openCodeEditor: (code) => ipcRenderer.send('open-code-editor', code)
  ,registerDevice: (clientId) => ipcRenderer.invoke('register-device', clientId)
  ,authLogin: (body) => ipcRenderer.invoke('auth-login', body)
  ,clearUserData: () => ipcRenderer.invoke('clear-user-data')
  ,saveSession: (sessionData) => ipcRenderer.invoke('save-session', sessionData)
  ,readSession: () => ipcRenderer.invoke('read-session')
  ,clearSessionFile: () => ipcRenderer.invoke('clear-session-file')
  ,getConfig: (key) => ipcRenderer.invoke('get-config', key)
  ,setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value)
  ,removeConfig: (key) => ipcRenderer.invoke('remove-config', key)
  ,getAllConfig: () => ipcRenderer.invoke('get-all-config')
  ,listDevices: () => ipcRenderer.invoke('list-devices')
  ,loadDeviceHistory: (deviceName) => ipcRenderer.invoke('load-device-history', deviceName)
  ,switchActiveDevice: (deviceName) => ipcRenderer.invoke('switch-active-device', deviceName)
  ,getActiveDevice: () => ipcRenderer.invoke('get-active-device')
  ,syncNow: () => ipcRenderer.invoke('sync-now')
  ,onSyncProgress: (callback) => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('sync-progress', listener)
    return () => ipcRenderer.removeListener('sync-progress', listener)
  }
  ,onOpenTutorial: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('open-tutorial', listener)
    return () => ipcRenderer.removeListener('open-tutorial', listener)
  }
  ,getPreferences: () => ipcRenderer.invoke('get-preferences')
  ,setPreferences: (patch) => ipcRenderer.invoke('set-preferences', patch)
  ,searchHistory: (payload) => ipcRenderer.invoke('search-history', payload)
  ,listRecent: (payload) => ipcRenderer.invoke('list-recent', payload)
  ,installLinuxPasteSupport: () => ipcRenderer.invoke('install-linux-paste-support')
  ,deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id)
  ,openExternalUrl: (url) => ipcRenderer.send('open-external-url', url)
  ,onFocusSearch: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('focus-search', listener)
    return () => ipcRenderer.removeListener('focus-search', listener)
  }
  ,onApplySearch: (callback) => {
    const listener = (_, payload) => callback(payload)
    ipcRenderer.on('apply-search', listener)
    return () => ipcRenderer.removeListener('apply-search', listener)
  },

  // Files API
  listFiles: (params) => ipcRenderer.invoke('list-files', params),
  deleteFile: (fileId) => ipcRenderer.invoke('delete-file', fileId),
  downloadFile: (fileId, fileName) => ipcRenderer.invoke('download-file', fileId, fileName),
  onFileUploaded: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('file-uploaded', listener)
    return () => ipcRenderer.removeListener('file-uploaded', listener)
  },
  onFileUploadError: (cb) => {
    const listener = (_, err) => cb(err)
    ipcRenderer.on('file-upload-error', listener)
    return () => ipcRenderer.removeListener('file-upload-error', listener)
  },
  onFileUploadStatus: (cb) => {
    const listener = (_, status) => cb(status)
    ipcRenderer.on('file-upload-status', listener)
    return () => ipcRenderer.removeListener('file-upload-status', listener)
  },
  onTokenRefreshed: (cb) => {
    const listener = (_, token) => cb(token)
    ipcRenderer.on('token-refreshed', listener)
    return () => ipcRenderer.removeListener('token-refreshed', listener)
  },
  onWindowVisibilityChanged: (callback) => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('window-visibility-changed', listener)
    return () => ipcRenderer.removeListener('window-visibility-changed', listener)
  },
  onDevicesUpdated: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('devices-updated', listener)
    return () => ipcRenderer.removeListener('devices-updated', listener)
  }
})

contextBridge.exposeInMainWorld('copyfy', {
  getSystemLocale: () => ipcRenderer.invoke('get-system-locale')
})
