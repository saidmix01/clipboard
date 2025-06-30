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

  toggleFavorite: (value) => ipcRenderer.send('toggle-favorite', value),
  //Pegar imagen
  pasteImage: () => ipcRenderer.invoke('pasteImage'),
  //updates
  forceUpdate: () => ipcRenderer.send('force-update'),
  onUpdateStatus: callback => ipcRenderer.on('update-status', (_, message) => callback(message)),
  // Version app
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
})
