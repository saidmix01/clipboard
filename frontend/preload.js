const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClipboardUpdate: (callback) =>
    ipcRenderer.on('clipboard-update', (_, data) => callback(data)),

  hideWindow: () => ipcRenderer.invoke('hide-window'),

  copyText: (text) => {
    console.log('📨 Enviando a main para copiar:', text);
    ipcRenderer.send('copy-to-clipboard', text); // ✅ lo enviamos al main
  }
});
