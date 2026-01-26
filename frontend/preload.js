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
})
