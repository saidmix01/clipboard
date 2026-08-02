"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * Helper para crear listeners con cleanup automático.
 * Evita el memory leak de ipcRenderer.on sin removeListener.
 */
function onChannel(channel, callback) {
    const listener = (_, data) => callback(data);
    electron_1.ipcRenderer.on(channel, listener);
    return () => electron_1.ipcRenderer.removeListener(channel, listener);
}
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // --- Clipboard & Core ---
    onClipboardUpdate: (callback) => onChannel('clipboard-update', callback),
    getClipboardHistory: (opts) => electron_1.ipcRenderer.invoke('get-clipboard-history', opts),
    copyText: (text) => electron_1.ipcRenderer.send('copy-to-clipboard', text),
    copyImage: (dataUrl) => electron_1.ipcRenderer.send('copy-image', dataUrl),
    pasteText: () => electron_1.ipcRenderer.send('paste-text'),
    // --- History ---
    deleteHistoryItem: (id) => electron_1.ipcRenderer.invoke('delete-history-item', id),
    clearHistory: () => electron_1.ipcRenderer.invoke('clear-history'),
    toggleFavorite: (item) => electron_1.ipcRenderer.send('toggle-favorite', item),
    searchHistory: (payload) => electron_1.ipcRenderer.invoke('search-history', payload),
    // --- Window ---
    hideWindow: () => electron_1.ipcRenderer.invoke('hide-window'),
    closeWindow: () => electron_1.ipcRenderer.invoke('close-window'),
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    getHostname: () => electron_1.ipcRenderer.invoke('get-hostname'),
    // --- Config ---
    getConfig: (key) => electron_1.ipcRenderer.invoke('get-config', key),
    setConfig: (key, value) => electron_1.ipcRenderer.invoke('set-config', key, value),
    removeConfig: (key) => electron_1.ipcRenderer.invoke('remove-config', key),
    getPreferences: () => electron_1.ipcRenderer.invoke('get-preferences'),
    setPreferences: (prefs) => electron_1.ipcRenderer.invoke('set-preferences', prefs),
    // --- Devices ---
    // getActiveDevice es la fuente de verdad — usa BackendDaemon IPC 'devices:get-active'
    getActiveDevice: () => electron_1.ipcRenderer.invoke('devices:get-active'),
    getAllDevices: () => electron_1.ipcRenderer.invoke('get-all-devices'),
    registerNewDevice: (name) => electron_1.ipcRenderer.invoke('register-new-device', name),
    setActiveDevice: (id) => electron_1.ipcRenderer.invoke('devices:set-active', id),
    onDeviceChanged: (callback) => onChannel('device:changed', callback),
    onDeviceSyncCompleted: (callback) => onChannel('device:sync-completed', callback),
    getClipboardItems: () => electron_1.ipcRenderer.invoke('clipboard:get-items'),
    // Sync de dispositivos
    notifyLoginSuccess: () => electron_1.ipcRenderer.send('auth:login-success'),
    onDevicesSyncStart: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('devices:sync-start', listener);
        return () => electron_1.ipcRenderer.removeListener('devices:sync-start', listener);
    },
    onDevicesSyncComplete: (callback) => onChannel('devices:sync-complete', callback),
    // Sync Engine
    syncNow: () => electron_1.ipcRenderer.invoke('sync:now'),
    getSyncStats: () => electron_1.ipcRenderer.invoke('sync:get-stats'),
    onSyncStats: (callback) => onChannel('sync:stats', callback),
    onNetworkStatus: (callback) => onChannel('sync:network-status', callback),
    // --- Backend Daemon API ---
    backend: {
        request: (config) => electron_1.ipcRenderer.invoke('backend-request', config),
        getValidToken: () => electron_1.ipcRenderer.invoke('auth-get-valid-token'),
        refreshToken: () => electron_1.ipcRenderer.invoke('auth-force-refresh'),
    },
    // --- UI Features ---
    openImageViewer: (url) => electron_1.ipcRenderer.send('open-image-viewer', url),
    openOCRWindow: (path) => electron_1.ipcRenderer.send('open-ocr-window', path),
    onOCRLoadImage: (callback) => {
        const listener = (_, path) => callback(path);
        electron_1.ipcRenderer.on('ocr-load-image', listener);
        return () => electron_1.ipcRenderer.removeListener('ocr-load-image', listener);
    },
    openCodeEditor: (content) => electron_1.ipcRenderer.send('open-code-editor', content),
    signalCodeReady: () => electron_1.ipcRenderer.send('code-window-ready'),
    onCodeLoadContent: (callback) => {
        const listener = (_, content) => callback(content);
        electron_1.ipcRenderer.on('code-load-content', listener);
        return () => electron_1.ipcRenderer.removeListener('code-load-content', listener);
    },
    // --- Files API ---
    selectFile: () => electron_1.ipcRenderer.invoke('select-file'),
    listFiles: (params) => electron_1.ipcRenderer.invoke('list-files', params),
    uploadFile: (filePath) => electron_1.ipcRenderer.invoke('upload-file', filePath),
    uploadAvatar: () => electron_1.ipcRenderer.invoke('upload-avatar'),
    deleteFile: (fileId) => electron_1.ipcRenderer.invoke('delete-file', fileId),
    downloadFile: (fileId, fileName) => electron_1.ipcRenderer.invoke('download-file', fileId, fileName),
    onFileUploaded: (cb) => onChannel('file-uploaded', cb),
    onFileUploadError: (cb) => onChannel('file-upload-error', cb),
    onFileUploadStatus: (cb) => onChannel('file-upload-status', cb),
    onDownloadProgress: (cb) => onChannel('download-progress', cb),
    onUpdateDownloaded: (cb) => onChannel('update-downloaded', cb),
    // --- Native System Notifications ---
    showNotification: (opts) => electron_1.ipcRenderer.invoke('show-notification', opts),
    // --- App Lifecycle ---
    signalAppReady: () => electron_1.ipcRenderer.send('app-ready'),
    // --- UI Reset (show/hide window) ---
    onUiReset: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('ui:reset', listener);
        return () => electron_1.ipcRenderer.removeListener('ui:reset', listener);
    },
    // --- Theme & Session (from tray) ---
    onThemeChanged: (callback) => onChannel('theme-changed', callback),
    onSessionChanged: (callback) => onChannel('session-changed', callback),
    onPreferencesChanged: (callback) => onChannel('preferences-changed', callback),
});
electron_1.contextBridge.exposeInMainWorld('copyfy', {
    getSystemLocale: () => electron_1.ipcRenderer.invoke('get-system-locale'),
});
