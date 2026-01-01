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
  pasteText: () => ipcRenderer.send('paste-text')

})
