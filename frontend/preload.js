const { contextBridge, ipcRenderer  } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onClipboardUpdate: callback =>
    ipcRenderer.on('clipboard-update', (_, data) => callback(data)),
  
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  onFocusSearch: cb => ipcRenderer.on('focus-search', cb),

  searchHistory: payload => ipcRenderer.invoke('search-history', payload),
  listRecent: payload => ipcRenderer.invoke('list-recent', payload),
  onApplySearch: cb => ipcRenderer.on('apply-search', (_, payload) => cb(payload)),

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

  // Files API
  selectFile: () => ipcRenderer.invoke('select-file'),
  listFiles: (params) => ipcRenderer.invoke('list-files', params),
  uploadFile: (filePath) => ipcRenderer.invoke('upload-file', filePath),
  deleteFile: (fileId) => ipcRenderer.invoke('delete-file', fileId),
  downloadFile: (fileId, fileName) => ipcRenderer.invoke('download-file', fileId, fileName),
  openFile: (fileId) => ipcRenderer.invoke('open-file', fileId),
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
  onDownloadProgress: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },

  // Devices
  getCurrentDevice: () => ipcRenderer.invoke('get-current-device'),
  getAllDevices: () => ipcRenderer.invoke('get-all-devices'),
  registerNewDevice: (name) => ipcRenderer.invoke('register-new-device', name),
  setActiveDevice: (id) => ipcRenderer.invoke('set-active-device', id),
  getHostname: () => ipcRenderer.invoke('get-hostname'),

  onNotificationLoadImage: (cb) => {
    const listener = (_, img) => cb(img)
    ipcRenderer.on('notification-load-image', listener)
    return () => ipcRenderer.removeListener('notification-load-image', listener)
  },
  onNotificationLoadFile: (cb) => {
    const listener = (_, fileInfo) => cb(fileInfo)
    ipcRenderer.on('notification-load-file', listener)
    return () => ipcRenderer.removeListener('notification-load-file', listener)
  },
  onNotificationError: (cb) => {
    const listener = (_, err) => cb(err)
    ipcRenderer.on('notification-error', listener)
    return () => ipcRenderer.removeListener('notification-error', listener)
  },
  signalNotificationReady: () => ipcRenderer.send('notification-window-ready'),
  sendNotificationAction: (action) => ipcRenderer.send('notification-action', action),
})
