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
    getCurrentDevice: () => electron_1.ipcRenderer.invoke('get-current-device'),
    getAllDevices: () => electron_1.ipcRenderer.invoke('get-all-devices'),
    registerNewDevice: (name) => electron_1.ipcRenderer.invoke('register-new-device', name),
    setActiveDevice: (id) => electron_1.ipcRenderer.invoke('set-active-device', id),
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
    signalNotificationReady: () => electron_1.ipcRenderer.send('notification-window-ready'),
    onNotificationLoadImage: (callback) => {
        const listener = (_, img) => callback(img);
        electron_1.ipcRenderer.on('notification-load-image', listener);
        return () => electron_1.ipcRenderer.removeListener('notification-load-image', listener);
    },
    sendNotificationAction: (action) => electron_1.ipcRenderer.send('notification-action', action),
    // Deprecated / Stubs
    syncNow: () => { },
    listDevices: () => Promise.resolve([]),
    registerDevice: () => Promise.resolve(),
    authLogin: () => Promise.resolve({ token: 'local-token' }),
    setAuthToken: () => { },
    readSession: () => Promise.resolve(null),
});
electron_1.contextBridge.exposeInMainWorld('copyfy', {
    getSystemLocale: () => electron_1.ipcRenderer.invoke('get-system-locale')
});
