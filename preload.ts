import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Helper para crear listeners con cleanup automático.
 * Evita el memory leak de ipcRenderer.on sin removeListener.
 */
function onChannel<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Clipboard & Core ---
  onClipboardUpdate: (callback: (data: any) => void) =>
    onChannel('clipboard-update', callback),

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
  // getActiveDevice es la fuente de verdad — usa BackendDaemon IPC 'devices:get-active'
  getActiveDevice: () => ipcRenderer.invoke('devices:get-active'),
  getAllDevices: () => ipcRenderer.invoke('get-all-devices'),
  registerNewDevice: (name: string) => ipcRenderer.invoke('register-new-device', name),
  setActiveDevice: (id: string) => ipcRenderer.invoke('devices:set-active', id),

  // Alias para compatibilidad con código existente — apunta al mismo handler
  getCurrentDevice: () => ipcRenderer.invoke('devices:get-active'),

  onDeviceChanged: (callback: (device: any) => void) =>
    onChannel('device:changed', callback),

  onDeviceSyncCompleted: (callback: (device: any) => void) =>
    onChannel('device:sync-completed', callback),

  getClipboardItems: () => ipcRenderer.invoke('clipboard:get-items'),

  // Sync de dispositivos
  notifyLoginSuccess: () => ipcRenderer.send('auth:login-success'),

  onDevicesSyncStart: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('devices:sync-start', listener);
    return () => ipcRenderer.removeListener('devices:sync-start', listener);
  },

  onDevicesSyncComplete: (callback: (devices: any[]) => void) =>
    onChannel<any[]>('devices:sync-complete', callback),

  // Sync Engine
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getSyncStats: () => ipcRenderer.invoke('sync:get-stats'),

  onSyncStats: (callback: (stats: any) => void) =>
    onChannel('sync:stats', callback),

  onNetworkStatus: (callback: (status: { online: boolean }) => void) =>
    onChannel('sync:network-status', callback),

  // --- Backend Daemon API ---
  backend: {
    request: (config: any) => ipcRenderer.invoke('backend-request', config),
    getValidToken: () => ipcRenderer.invoke('auth-get-valid-token'),
    refreshToken: () => ipcRenderer.invoke('auth-force-refresh'),
  },

  // --- UI Features ---
  openImageViewer: (url: string) => ipcRenderer.send('open-image-viewer', url),
  openOCRWindow: (path: string) => ipcRenderer.send('open-ocr-window', path),

  onOCRLoadImage: (callback: (path: string) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on('ocr-load-image', listener);
    return () => ipcRenderer.removeListener('ocr-load-image', listener);
  },

  openCodeEditor: (content: string) => ipcRenderer.send('open-code-editor', content),
  signalCodeReady: () => ipcRenderer.send('code-window-ready'),

  onCodeLoadContent: (callback: (content: string) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, content: string) => callback(content);
    ipcRenderer.on('code-load-content', listener);
    return () => ipcRenderer.removeListener('code-load-content', listener);
  },

  // --- Files API ---
  selectFile: () => ipcRenderer.invoke('select-file'),
  listFiles: (params: any) => ipcRenderer.invoke('list-files', params),
  uploadFile: (filePath: string) => ipcRenderer.invoke('upload-file', filePath),
  deleteFile: (fileId: string) => ipcRenderer.invoke('delete-file', fileId),
  downloadFile: (fileId: string, fileName: string) => ipcRenderer.invoke('download-file', fileId, fileName),
  openFile: (fileId: string) => ipcRenderer.invoke('open-file', fileId),

  onFileUploaded: (cb: (data: any) => void) =>
    onChannel('file-uploaded', cb),

  onFileUploadError: (cb: (err: any) => void) =>
    onChannel('file-upload-error', cb),

  onFileUploadStatus: (cb: (status: any) => void) =>
    onChannel('file-upload-status', cb),

  onDownloadProgress: (cb: (progress: any) => void) =>
    onChannel('download-progress', cb),

  // --- Native System Notifications ---
  showNotification: (opts: { title: string; body: string }) =>
    ipcRenderer.invoke('show-notification', opts),

  // --- App Lifecycle ---
  signalAppReady: () => ipcRenderer.send('app-ready'),

  // --- UI Reset (show/hide window) ---
  onUiReset: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('ui:reset', listener);
    return () => ipcRenderer.removeListener('ui:reset', listener);
  },

  // --- Theme & Session (from tray) ---
  onThemeChanged: (callback: (isDark: boolean) => void) =>
    onChannel('theme-changed', callback),

  onSessionChanged: (callback: (session: any) => void) =>
    onChannel('session-changed', callback),

  onPreferencesChanged: (callback: (prefs: any) => void) =>
    onChannel('preferences-changed', callback),
});

contextBridge.exposeInMainWorld('copyfy', {
  getSystemLocale: () => ipcRenderer.invoke('get-system-locale'),
});
