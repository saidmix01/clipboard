"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Define types for better safety if needed, but for now we keep it compatible
// with the existing frontend which expects 'electronAPI' global.
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // --- Clipboard & Core ---
    onClipboardUpdate: (callback) => electron_1.ipcRenderer.on('clipboard-update', (_, data) => callback(data)),
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
    getCurrentDevice: () => electron_1.ipcRenderer.invoke('devices:get-active'), // Updated to use new logic
    getAllDevices: () => electron_1.ipcRenderer.invoke('get-all-devices'),
    registerNewDevice: (name) => electron_1.ipcRenderer.invoke('register-new-device', name),
    setActiveDevice: (id) => electron_1.ipcRenderer.invoke('devices:set-active', id), // Updated
    // New Active Device Logic
    getActiveDevice: () => electron_1.ipcRenderer.invoke('devices:get-active'),
    onDeviceChanged: (callback) => {
        const listener = (_, device) => callback(device);
        electron_1.ipcRenderer.on('device:changed', listener);
        return () => electron_1.ipcRenderer.removeListener('device:changed', listener);
    },
    onDeviceSyncCompleted: (callback) => {
        const listener = (_, device) => callback(device);
        electron_1.ipcRenderer.on('device:sync-completed', listener);
        return () => electron_1.ipcRenderer.removeListener('device:sync-completed', listener);
    },
    getClipboardItems: () => electron_1.ipcRenderer.invoke('clipboard:get-items'),
    // Sync
    notifyLoginSuccess: () => electron_1.ipcRenderer.send('auth:login-success'),
    onDevicesSyncStart: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('devices:sync-start', listener);
        return () => electron_1.ipcRenderer.removeListener('devices:sync-start', listener);
    },
    onDevicesSyncComplete: (callback) => {
        const listener = (_, devices) => callback(devices);
        electron_1.ipcRenderer.on('devices:sync-complete', listener);
        return () => electron_1.ipcRenderer.removeListener('devices:sync-complete', listener);
    },
    // Sync Engine APIs
    syncNow: () => electron_1.ipcRenderer.invoke('sync:now'),
    getSyncStats: () => electron_1.ipcRenderer.invoke('sync:get-stats'),
    onSyncStats: (callback) => {
        const listener = (_, stats) => callback(stats);
        electron_1.ipcRenderer.on('sync:stats', listener);
        return () => electron_1.ipcRenderer.removeListener('sync:stats', listener);
    },
    onNetworkStatus: (callback) => {
        const listener = (_, status) => callback(status);
        electron_1.ipcRenderer.on('sync:network-status', listener);
        return () => electron_1.ipcRenderer.removeListener('sync:network-status', listener);
    },
    // --- Backend Daemon API (New) ---
    backend: {
        // General request method (preferred over direct fetch in renderer)
        request: (config) => electron_1.ipcRenderer.invoke('backend-request', config),
        // Auth helpers
        getValidToken: () => electron_1.ipcRenderer.invoke('auth-get-valid-token'),
        refreshToken: () => electron_1.ipcRenderer.invoke('auth-force-refresh'),
    },
    // --- Legacy / UI Features ---
    openImageViewer: (url) => electron_1.ipcRenderer.send('open-image-viewer', url),
    openOCRWindow: (path) => electron_1.ipcRenderer.send('open-ocr-window', path),
    onOCRLoadImage: (callback) => {
        electron_1.ipcRenderer.on('ocr-load-image', (_, path) => callback(path));
    },
    openCodeEditor: (content) => electron_1.ipcRenderer.send('open-code-editor', content),
    signalCodeReady: () => electron_1.ipcRenderer.send('code-window-ready'),
    onCodeLoadContent: (callback) => {
        const listener = (_, content) => callback(content);
        electron_1.ipcRenderer.on('code-load-content', listener);
        return () => electron_1.ipcRenderer.removeListener('code-load-content', listener);
    },
    // Files API
    selectFile: () => electron_1.ipcRenderer.invoke('select-file'),
    listFiles: (params) => electron_1.ipcRenderer.invoke('list-files', params),
    uploadFile: (filePath) => electron_1.ipcRenderer.invoke('upload-file', filePath),
    deleteFile: (fileId) => electron_1.ipcRenderer.invoke('delete-file', fileId),
    downloadFile: (fileId, fileName) => electron_1.ipcRenderer.invoke('download-file', fileId, fileName),
    openFile: (fileId) => electron_1.ipcRenderer.invoke('open-file', fileId),
    onFileUploaded: (cb) => {
        const listener = (_, data) => cb(data);
        electron_1.ipcRenderer.on('file-uploaded', listener);
        return () => electron_1.ipcRenderer.removeListener('file-uploaded', listener);
    },
    onFileUploadError: (cb) => {
        const listener = (_, err) => cb(err);
        electron_1.ipcRenderer.on('file-upload-error', listener);
        return () => electron_1.ipcRenderer.removeListener('file-upload-error', listener);
    },
    onFileUploadStatus: (cb) => {
        const listener = (_, status) => cb(status);
        electron_1.ipcRenderer.on('file-upload-status', listener);
        return () => electron_1.ipcRenderer.removeListener('file-upload-status', listener);
    },
    onDownloadProgress: (cb) => {
        const listener = (_, progress) => cb(progress);
        electron_1.ipcRenderer.on('download-progress', listener);
        return () => electron_1.ipcRenderer.removeListener('download-progress', listener);
    },
    // Notification Window specific
    onNotificationLoadImage: (cb) => {
        const listener = (_, img) => cb(img);
        electron_1.ipcRenderer.on('notification-load-image', listener);
        return () => electron_1.ipcRenderer.removeListener('notification-load-image', listener);
    },
    onNotificationLoadFile: (cb) => {
        const listener = (_, fileInfo) => cb(fileInfo);
        electron_1.ipcRenderer.on('notification-load-file', listener);
        return () => electron_1.ipcRenderer.removeListener('notification-load-file', listener);
    },
    onNotificationError: (cb) => {
        const listener = (_, err) => cb(err);
        electron_1.ipcRenderer.on('notification-error', listener);
        return () => electron_1.ipcRenderer.removeListener('notification-error', listener);
    },
    signalNotificationReady: () => electron_1.ipcRenderer.send('notification-window-ready'),
    sendNotificationAction: (action) => electron_1.ipcRenderer.send('notification-action', action),
    // App Lifecycle
    signalAppReady: () => electron_1.ipcRenderer.send('app-ready'),
    // Deprecated / Stubs - REMOVED
    // syncNow, listDevices, registerDevice, authLogin, setAuthToken, readSession
    // Use new APIs above instead
});
electron_1.contextBridge.exposeInMainWorld('copyfy', {
    getSystemLocale: () => electron_1.ipcRenderer.invoke('get-system-locale')
});
