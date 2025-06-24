const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClipboardUpdate: (callback) => ipcRenderer.on('clipboard:update', (_, data) => callback(data))
});
