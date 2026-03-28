"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, screen, nativeImage, Tray, Menu, shell, Notification, powerMonitor, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const FormData = require('form-data');
// --- Integration Start ---
// Assuming TypeScript compilation or ts-node
// If using plain JS, this would be: const { BackendDaemon } = require('./backend/BackendDaemon')
const BackendDaemon_1 = require("./backend/BackendDaemon");
const SyncEngine_1 = require("./backend/SyncEngine");
// --- Integration End ---
const db = require('./db');
const { configureAutoLaunch } = require('./autolaunch');
const electronLog = require('electron-log');
const { exec, execFile, spawnSync } = require('child_process');
const log = {
    info: (...args) => console.log('[MAIN]', ...args),
    error: (...args) => console.error('[MAIN]', ...args),
    warn: (...args) => console.warn('[MAIN]', ...args),
    debug: () => { }
};
let mainWindow;
let ocrWindow = null;
let codeWindow = null;
let notificationWindow = null;
let pendingNotificationImage = null;
let pendingCodeContent = null;
let tray;
let isQuitting = false;
// Set app name and ensure userData exists to avoid Lock file error (Error code: 3)
app.setName('CopyFy');
// app.setAppUserModelId('SAIDMIX.CopyFy'); // Optional if needed for notifications
const userDataPath = app.getPath('userData');
if (!fs.existsSync(userDataPath)) {
    try {
        fs.mkdirSync(userDataPath, { recursive: true });
    }
    catch (e) {
        log.error('Failed to create userData directory:', e);
    }
}
// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}
else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            if (!mainWindow.isVisible())
                mainWindow.show();
            mainWindow.focus();
        }
    });
}
// Helper: Normalize item for IPC
function normalizeForIPC(items) {
    return items.map(i => ({
        id: i.id,
        value: i.value,
        type: i.type,
        favorite: i.favorite,
        createdAt: i.createdAt,
        imagePath: i.type === 'image' && i.value.startsWith('[LOCAL_IMAGE]:') ? i.value.replace('[LOCAL_IMAGE]:', '') : null
    }));
}
// Helper: Broadcast update to main window with correct filtering
function broadcastUpdate() {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        const settings = db.getSettings();
        log.info(`[Main] broadcastUpdate settings.selectedDeviceId: ${settings.selectedDeviceId}`);
        const filter = {};
        if (settings.selectedDeviceId) {
            filter.deviceId = settings.selectedDeviceId;
        }
        const items = db.getItems(20, 0, filter);
        log.info(`[Main] broadcastUpdate sending ${items.length} items (Device: ${filter.deviceId || 'ALL'})`);
        try {
            mainWindow.webContents.send('clipboard-update', normalizeForIPC(items));
        }
        catch (e) {
            log.error('[Main] Failed to send clipboard-update:', e);
        }
    }
}
let cachedSelectedDeviceId = null;
// Window Creation
function createWindow() {
    const display = screen.getPrimaryDisplay();
    const screenWidth = display.workArea.width;
    const screenHeight = display.workArea.height;
    const windowWidth = 400;
    const finalX = screenWidth - windowWidth;
    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: screenHeight,
        x: finalX,
        y: 0,
        frame: false,
        transparent: true,
        vibrancy: process.platform === 'darwin' ? 'hud' : undefined,
        backgroundColor: '#00FFFFFF',
        alwaysOnTop: true,
        resizable: false,
        show: false,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Point to compiled JS
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        }
    });
    const indexPath = app.isPackaged
        ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
        : 'http://127.0.0.1:5173';
    if (app.isPackaged) {
        mainWindow.loadFile(indexPath);
    }
    else {
        mainWindow.loadURL(indexPath);
    }
    mainWindow.once('ready-to-show', () => {
        const settings = db.getSettings();
        mainWindow.show();
        broadcastUpdate();
    });
    mainWindow.on('blur', () => {
        // Optional: hide on blur
    });
}
function createOCRWindow(imagePath) {
    if (ocrWindow) {
        ocrWindow.focus();
        ocrWindow.webContents.send('ocr-load-image', imagePath);
        return;
    }
    const display = screen.getPrimaryDisplay();
    const screenWidth = display.workArea.width;
    const screenHeight = display.workArea.height;
    const mainWidth = 400;
    const width = screenWidth - mainWidth;
    const height = screenHeight;
    const x = 0;
    const y = 0;
    ocrWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        title: 'OCR - Text Extraction',
        frame: false,
        transparent: true,
        backgroundColor: '#00FFFFFF',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        },
        autoHideMenuBar: true
    });
    const indexPath = app.isPackaged
        ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
        : 'http://127.0.0.1:5173';
    const url = `${indexPath}?mode=ocr&img=${encodeURIComponent(imagePath)}`;
    if (app.isPackaged) {
        ocrWindow.loadFile(indexPath, { search: `mode=ocr&img=${encodeURIComponent(imagePath)}` }).then(() => {
            ocrWindow.webContents.send('ocr-load-image', imagePath);
        });
    }
    else {
        ocrWindow.loadURL(url);
    }
    ocrWindow.on('closed', () => {
        ocrWindow = null;
    });
}
function createCodeWindow(codeContent) {
    pendingCodeContent = codeContent;
    if (codeWindow) {
        codeWindow.focus();
        codeWindow.webContents.send('code-load-content', codeContent);
        return;
    }
    const display = screen.getPrimaryDisplay();
    const screenWidth = display.workArea.width;
    const screenHeight = display.workArea.height;
    const mainWidth = 400;
    const width = screenWidth - mainWidth;
    const height = screenHeight;
    const x = 0;
    const y = 0;
    codeWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        title: 'Code Editor',
        frame: false,
        transparent: true,
        backgroundColor: '#00FFFFFF',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        },
        autoHideMenuBar: true,
        show: false
    });
    const indexPath = app.isPackaged
        ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
        : 'http://127.0.0.1:5173';
    const url = `${indexPath}?mode=code`;
    if (app.isPackaged) {
        codeWindow.loadFile(indexPath, { search: 'mode=code' }).then(() => {
        });
    }
    else {
        codeWindow.loadURL(url);
    }
    codeWindow.once('ready-to-show', () => {
        codeWindow.show();
    });
    codeWindow.on('closed', () => {
        codeWindow = null;
        pendingCodeContent = null;
    });
}
function createNotificationWindow() {
    if (notificationWindow) {
        notificationWindow.focus();
        return;
    }
    const display = screen.getPrimaryDisplay();
    const width = 350;
    const height = 100;
    const x = display.workArea.width - width - 20;
    let y = display.workArea.height - height - 20;
    if (process.platform === 'darwin') {
        y = 40; // macOS: Arriba a la derecha
    }
    notificationWindow = new BrowserWindow({
        width, height, x, y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        }
    });
    const indexPath = app.isPackaged
        ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
        : 'http://127.0.0.1:5173';
    const url = `${indexPath}?mode=notification`;
    if (app.isPackaged) {
        notificationWindow.loadFile(indexPath, { search: 'mode=notification' }).then(() => {
        });
    }
    else {
        notificationWindow.loadURL(url);
    }
    notificationWindow.on('closed', () => {
        notificationWindow = null;
    });
}
// Handshake listener
ipcMain.on('code-window-ready', (event) => {
    if (codeWindow && pendingCodeContent) {
        codeWindow.webContents.send('code-load-content', pendingCodeContent);
    }
});
ipcMain.on('app-ready', () => {
    log.info('[Main] Received app-ready signal from renderer');
    broadcastUpdate();
    // Sync devices on app startup if authenticated
    const settings = db.getSettings();
    if (settings && settings.accessToken) {
        log.info('[Main] User authenticated, triggering device sync on startup');
        BackendDaemon_1.BackendDaemon.getInstance().syncDevicesOnLogin(true).catch((e) => {
            log.error('[Main] Failed to sync devices on startup:', e);
        });
    }
});
ipcMain.on('notification-window-ready', () => {
    if (notificationWindow && pendingNotificationImage) {
        if (pendingNotificationImage.type === 'image') {
            const dataUrl = pendingNotificationImage.image.toDataURL();
            notificationWindow.webContents.send('notification-load-image', dataUrl);
        }
        else if (pendingNotificationImage.type === 'file') {
            // Send file info instead of image
            notificationWindow.webContents.send('notification-load-file', {
                name: pendingNotificationImage.fileName,
                path: pendingNotificationImage.filePath
            });
        }
    }
});
ipcMain.on('notification-action', async (_, action) => {
    if (action === 'save' && pendingNotificationImage) {
        if (pendingNotificationImage.type === 'image') {
            try {
                const { image, hash } = pendingNotificationImage;
                const imagesDir = path.join(app.getPath('userData'), 'images');
                if (!fs.existsSync(imagesDir))
                    fs.mkdirSync(imagesDir, { recursive: true });
                const filename = `${Date.now()}-${hash.substring(0, 8)}.png`;
                const filePath = path.join(imagesDir, filename);
                fs.writeFileSync(filePath, image.toPNG());
                // Usar BackendDaemon para guardar con deviceId
                const backendDaemon = BackendDaemon_1.BackendDaemon.getInstance();
                const result = backendDaemon.saveClipboardItem(`[LOCAL_IMAGE]:${filePath}`, 'image');
                if (result) {
                    broadcastUpdate();
                    // Encolar para sincronización
                    const syncEngine = SyncEngine_1.SyncEngine.getInstance();
                    syncEngine.enqueueItem(result.id, 'CREATE').catch(err => {
                        log.error('Failed to enqueue image for sync:', err);
                    });
                }
            }
            catch (e) {
                log.error('Error saving image:', e);
            }
        }
        else if (pendingNotificationImage.type === 'file') {
            try {
                const { filePath } = pendingNotificationImage;
                if (fs.existsSync(filePath)) {
                    const backend = BackendDaemon_1.BackendDaemon.getInstance();
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath));
                    // Get selected device ID
                    const deviceId = db.getSettings().selectedDeviceId;
                    // Upload immediately using the correct endpoint
                    const res = await backend.request({
                        url: '/api/files/upload',
                        method: 'POST',
                        data: form,
                        headers: {
                            ...form.getHeaders(),
                            'x-device-id': deviceId
                        }
                    });
                    if (res.success) {
                        if (notificationWindow && !notificationWindow.isDestroyed()) {
                            notificationWindow.close();
                        }
                        // Broadcast update so the list refreshes
                        broadcastUpdate();
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('file-uploaded', res.data);
                        }
                    }
                    else {
                        // Upload failed (e.g. offline)
                        log.error('Upload failed:', res.error);
                        if (notificationWindow && !notificationWindow.isDestroyed()) {
                            // Send error to notification window to display
                            notificationWindow.webContents.send('notification-error', 'Error al subir: ' + (res.error || 'Sin conexión'));
                        }
                    }
                }
            }
            catch (e) {
                log.error('Error saving file:', e);
                if (notificationWindow && !notificationWindow.isDestroyed()) {
                    notificationWindow.webContents.send('notification-error', 'Error local: ' + e.message);
                }
            }
            return; // Don't close window here, handled inside
        }
    }
    // Close for cancel or non-file saves (images close immediately as they save locally)
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.close();
    }
    pendingNotificationImage = null;
});
// Clipboard Watcher
let lastText = '';
let lastImageHash = '';
let clipboardWatcherInterval = null;
function startClipboardWatcher() {
    // Prevenir múltiples watchers
    if (clipboardWatcherInterval) {
        return;
    }
    clipboardWatcherInterval = setInterval(() => {
        try {
            const text = clipboard.readText();
            // ... existing text logic ...
            if (text && text.trim() !== '' && text !== lastText) {
                lastText = text;
                // Usar BackendDaemon para guardar (incluye deviceId automáticamente)
                const backendDaemon = BackendDaemon_1.BackendDaemon.getInstance();
                const result = backendDaemon.saveClipboardItem(text, 'text');
                if (result) {
                    broadcastUpdate();
                    // Encolar para sincronización
                    const syncEngine = SyncEngine_1.SyncEngine.getInstance();
                    syncEngine.enqueueItem(result.id, 'CREATE').catch(err => {
                        log.error('Failed to enqueue item for sync:', err);
                    });
                }
            }
            // 1. Detect Images
            const image = clipboard.readImage();
            if (!image.isEmpty()) {
                const buffer = image.getBitmap();
                const hash = crypto.createHash('md5').update(buffer).digest('hex');
                if (hash !== lastImageHash) {
                    lastImageHash = hash;
                    pendingNotificationImage = { image, hash, type: 'image' };
                    createNotificationWindow();
                }
            }
            // 2. Detect Files
            let detectedFilePath = null;
            if (process.platform === 'win32') {
                // Windows: Try 'FileNameW'
                // The buffer is UCS-2 (UTF-16LE) and might contain multiple paths separated by NULL
                // We take the first valid path.
                try {
                    const buffer = clipboard.readBuffer('FileNameW');
                    if (buffer.length > 0) {
                        // Split by NULL character (0x0000 in UCS-2 is 2 bytes of zeros)
                        // But since we decode to string first, we split by '\0'
                        const allPaths = buffer.toString('ucs2').split('\0');
                        // Find the first valid file path
                        for (const p of allPaths) {
                            const cleanPath = p.trim();
                            if (cleanPath.length > 0 && cleanPath.match(/^[a-zA-Z]:\\/) && fs.existsSync(cleanPath)) {
                                detectedFilePath = cleanPath;
                                break;
                            }
                        }
                    }
                }
                catch (e) {
                    // ignore buffer read errors
                }
            }
            else if (process.platform === 'darwin') {
                // macOS: Try 'public.file-url'
                // The clipboard often contains the file URL string e.g. file:///Users/name/file.png
                const fileUrl = clipboard.read('public.file-url');
                if (fileUrl && fileUrl.startsWith('file://')) {
                    detectedFilePath = decodeURIComponent(fileUrl.replace('file://', ''));
                }
            }
            else if (process.platform === 'linux') {
                // Linux: Try 'text/uri-list' (Nautilus, etc) or 'text/plain' fallback
                // usually contains file:///home/user/file.png\r\n...
                // We take the first one for simplicity
                const uriList = clipboard.read('text/uri-list');
                if (uriList) {
                    const lines = uriList.split(/[\r\n]+/);
                    for (const line of lines) {
                        if (line.startsWith('file://')) {
                            detectedFilePath = decodeURIComponent(line.replace('file://', ''));
                            break;
                        }
                    }
                }
            }
            if (detectedFilePath && fs.existsSync(detectedFilePath)) {
                try {
                    const stat = fs.statSync(detectedFilePath);
                    if (stat.isFile()) {
                        // Unique hash for file based on path + modification time
                        // Add type to hash to avoid collisions with text/images
                        const fileHash = crypto.createHash('md5').update(`file:${detectedFilePath}:${stat.mtimeMs}`).digest('hex');
                        if (fileHash !== lastImageHash) {
                            lastImageHash = fileHash;
                            const ext = path.extname(detectedFilePath).toLowerCase();
                            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext);
                            if (isImage) {
                                // If it's an image file, treat it as an IMAGE type so it shows preview and saves to Image tab
                                const image = nativeImage.createFromPath(detectedFilePath);
                                pendingNotificationImage = {
                                    image,
                                    hash: fileHash,
                                    type: 'image'
                                };
                            }
                            else {
                                // Otherwise treat as generic document/file
                                pendingNotificationImage = {
                                    filePath: detectedFilePath,
                                    fileName: path.basename(detectedFilePath),
                                    hash: fileHash,
                                    type: 'file'
                                };
                            }
                            createNotificationWindow();
                        }
                    }
                }
                catch (e) {
                    // ignore access errors
                }
            }
        }
        catch (e) {
            log.error('Clipboard watcher error:', e);
        }
    }, 1000);
}
function stopClipboardWatcher() {
    if (clipboardWatcherInterval) {
        clearInterval(clipboardWatcherInterval);
        clipboardWatcherInterval = null;
        log.info('[Main] Clipboard watcher stopped');
    }
}
// IPC Handlers
// File Management IPC
ipcMain.handle('list-files', async (_, params) => {
    const backend = BackendDaemon_1.BackendDaemon.getInstance();
    // Ensure we send deviceId instead of just forwarding raw params
    // If params has clientId, replace/add deviceId
    const queryParams = { ...params };
    // Get current device ID if not provided
    if (!queryParams.deviceId) {
        const settings = db.getSettings();
        if (settings.selectedDeviceId) {
            queryParams.deviceId = settings.selectedDeviceId;
        }
    }
    // Remove clientId if present to avoid confusion based on new requirement
    if (queryParams.clientId)
        delete queryParams.clientId;
    const res = await backend.request({
        url: '/api/files',
        method: 'GET',
        params: queryParams
    });
    // Return the whole response object so frontend can check success/data
    return res;
});
ipcMain.handle('select-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile']
    });
    if (canceled || filePaths.length === 0)
        return null;
    return filePaths[0];
});
ipcMain.handle('upload-file', async (_, filePath) => {
    try {
        if (!fs.existsSync(filePath))
            throw new Error('File not found');
        const backend = BackendDaemon_1.BackendDaemon.getInstance();
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        // Get selected device ID
        const deviceId = db.getSettings().selectedDeviceId;
        const res = await backend.request({
            url: '/api/files/upload',
            method: 'POST',
            data: form,
            headers: {
                ...form.getHeaders(),
                'x-device-id': deviceId
            }
        });
        return res;
    }
    catch (e) {
        return { success: false, error: e.message };
    }
});
ipcMain.handle('delete-file', async (_, fileId) => {
    const backend = BackendDaemon_1.BackendDaemon.getInstance();
    return await backend.request({
        url: `/api/files/${fileId}`,
        method: 'DELETE'
    });
});
ipcMain.handle('download-file', async (_, fileId, fileName) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: fileName,
        title: 'Guardar archivo'
    });
    if (canceled || !filePath)
        return { canceled: true };
    const backend = BackendDaemon_1.BackendDaemon.getInstance();
    const res = await backend.request({
        url: `/api/files/${fileId}/download`,
        method: 'GET',
        responseType: 'arraybuffer'
    });
    if (res.success) {
        try {
            fs.writeFileSync(filePath, Buffer.from(res.data));
            return { success: true, filePath };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    }
    return res;
});
ipcMain.handle('get-clipboard-history', (_, { limit = 20, offset = 0, filter = {} } = {}) => {
    // Automatically apply selected device filter if not explicitly requesting something else?
    // User wants strict filtering by selected device.
    const settings = db.getSettings();
    // log.info(`[IPC] get-clipboard-history settings:`, JSON.stringify(settings))
    // Ensure filter is not overwritten if passed by frontend (e.g. searching)
    // But we want to enforce device scope.
    if (settings.selectedDeviceId) {
        // log.info(`[IPC] get-clipboard-history filtering by device: ${settings.selectedDeviceId}`)
        filter.deviceId = settings.selectedDeviceId;
        cachedSelectedDeviceId = settings.selectedDeviceId; // Update cache
    }
    else if (cachedSelectedDeviceId) {
        log.warn(`[IPC] using CACHED device id: ${cachedSelectedDeviceId}`);
        filter.deviceId = cachedSelectedDeviceId;
    }
    else {
        log.warn(`[IPC] get-clipboard-history settings.selectedDeviceId IS MISSING/NULL!`);
    }
    const items = db.getItems(limit, offset, filter);
    // log.info(`[IPC] get-clipboard-history returning ${items.length} items`)
    return normalizeForIPC(items);
});
ipcMain.handle('delete-history-item', (_, id) => {
    db.deleteItem(id);
    broadcastUpdate();
    return []; // Return empty or updated list? Frontend seems to expect list but usually re-fetches or uses broadcast
});
ipcMain.handle('search-history', (_, payload) => {
    const filter = {};
    if (payload && payload.query)
        filter.search = payload.query;
    if (payload && payload.type)
        filter.type = payload.type;
    // Apply selected device filter
    const settings = db.getSettings();
    if (settings.selectedDeviceId) {
        filter.deviceId = settings.selectedDeviceId;
    }
    return normalizeForIPC(db.getItems(100, 0, filter));
});
ipcMain.handle('clear-history', () => {
    db.clearAll();
    return [];
});
ipcMain.on('toggle-favorite', (_, { id, isFavorite }) => {
    db.setFavorite(id, isFavorite);
    broadcastUpdate();
});
ipcMain.on('copy-to-clipboard', (_, text) => {
    lastText = text;
    clipboard.writeText(text);
});
ipcMain.on('paste-text', () => {
    if (process.platform === 'win32') {
        const pasteExe = path.join(__dirname, 'helpers', 'paste.exe');
        if (fs.existsSync(pasteExe)) {
            require('child_process').execFile(pasteExe, (err) => {
                if (err)
                    log.error('Paste error:', err);
            });
        }
    }
    else if (process.platform === 'linux') {
        const settings = db.getSettings();
        const lang = settings.language || 'en';
        let title = 'CopyFy';
        let body = '';
        if (lang.toLowerCase().startsWith('es')) {
            title = 'Pegado automático no disponible';
            body = 'Usa Ctrl+V o clic derecho -> Pegar para pegar el contenido copiado.';
        }
        else {
            title = 'Auto-paste not available';
            body = 'Use Ctrl+V or right click -> Paste to paste the copied content.';
        }
        new Notification({
            title,
            body
        }).show();
    }
});
ipcMain.on('copy-image', (_, dataUrl) => {
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '');
        if (fs.existsSync(p)) {
            const img = nativeImage.createFromPath(p);
            clipboard.writeImage(img);
            const hash = crypto.createHash('md5').update(img.toDataURL()).digest('hex');
            lastImageHash = hash;
        }
    }
});
ipcMain.handle('get-config', (_, key) => {
    const s = db.getSettings();
    if (key === 'session') {
        return s.accessToken ? JSON.stringify({
            token: s.accessToken,
            refreshToken: s.refreshToken
        }) : null;
    }
    if (key === 'darkMode')
        return s.isDarkMode ? 'true' : 'false';
    if (key === 'selectedDeviceId')
        return s.selectedDeviceId || null;
    return null;
});
ipcMain.handle('set-config', (_, key, value) => {
    if (key === 'session') {
        try {
            const v = JSON.parse(value);
            db.updateSettings({ AccessToken: v.token, RefreshToken: v.refreshToken });
        }
        catch (e) { }
    }
    if (key === 'darkMode') {
        db.updateSettings({ IsDarkMode: value === 'true' });
    }
});
ipcMain.handle('remove-config', (_, key) => {
    if (key === 'session') {
        db.updateSettings({ AccessToken: null, RefreshToken: null });
    }
});
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-system-locale', () => app.getLocale());
ipcMain.handle('get-hostname', () => os.hostname());
ipcMain.handle('hide-window', () => mainWindow && mainWindow.hide());
ipcMain.handle('close-window', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win && win !== mainWindow)
        win.close();
    else if (win === mainWindow)
        win.hide();
});
ipcMain.handle('get-preferences', () => {
    return db.getSettings();
});
ipcMain.handle('set-preferences', (_, prefs) => {
    const dbUpdate = {};
    if (prefs.isDarkMode !== undefined)
        dbUpdate.IsDarkMode = prefs.isDarkMode;
    if (prefs.language)
        dbUpdate.Language = prefs.language;
    if (prefs.globalShortcut)
        dbUpdate.GlobalShortcut = prefs.globalShortcut;
    if (prefs.colorPrimary || prefs.colorSecondary || prefs.colorBg || prefs.colorSurface || prefs.colorText || prefs.fontSize) {
        const currentTheme = JSON.parse(db.getSettings().theme || '{}');
        if (prefs.colorPrimary)
            currentTheme.primary = prefs.colorPrimary;
        if (prefs.colorSecondary)
            currentTheme.secondary = prefs.colorSecondary;
        if (prefs.colorBg)
            currentTheme.bg = prefs.colorBg;
        if (prefs.colorSurface)
            currentTheme.surface = prefs.colorSurface;
        if (prefs.colorText)
            currentTheme.text = prefs.colorText;
        if (prefs.fontSize)
            currentTheme.fontSize = prefs.fontSize;
        dbUpdate.Theme = JSON.stringify(currentTheme);
    }
    const newSettings = db.updateSettings(dbUpdate);
    if (dbUpdate.GlobalShortcut) {
        ipcMain.emit('update-global-shortcut', null, dbUpdate.GlobalShortcut);
    }
    return newSettings;
});
ipcMain.handle('get-current-device', () => {
    // Return explicitly selected device, or fallback to the local one logic?
    // User wants: "que cuando se cierre la app y se inicie este sea el seleccionado"
    // So we check AppSettings.SelectedDeviceId first.
    const settings = db.getSettings();
    if (settings.selectedDeviceId) {
        // Find this device info
        const devices = db.getDevices();
        const found = devices.find((d) => d.Id === settings.selectedDeviceId);
        if (found)
            return found;
    }
    // Fallback to default behavior (e.g. current machine or last updated)
    return db.getDevice();
});
ipcMain.handle('get-all-devices', () => {
    return db.getDevices();
});
ipcMain.handle('register-new-device', (_, name) => {
    // Note: db.registerDevice now handles duplicate checks and merging automatically
    // so we can just pass the new info. If ID is not provided, db generates one or reuses existing by name.
    // However, for explicit creation from UI, we might want to generate an ID if it's "new"
    // but db.registerDevice handles that too.
    const resId = db.registerDevice({
        Id: null, // Let DB decide (reuse or create)
        OsName: process.platform,
        Name: name,
        VersionApp: app.getVersion()
    });
    if (resId) {
        // Update items to belong to this new device if they were orphans
        db.updateAllItemsDevice(resId);
        return { id: resId, name };
    }
    return null;
});
ipcMain.handle('set-active-device', (_, id) => {
    log.info('IPC set-active-device called with:', id);
    const result = db.setActiveDevice(id);
    // Verify persistence
    const settings = db.getSettings();
    // log.info(`[IPC] db.getSettings() result:`, JSON.stringify(settings))
    // log.info(`[IPC] Device set to: ${settings.selectedDeviceId} (Requested: ${id})`)
    // Update cache
    cachedSelectedDeviceId = id;
    // Force a fresh filter application on broadcast
    if (mainWindow && !mainWindow.isDestroyed()) {
        const filter = {};
        // Use the ID we just set, because DB might be slow to return it in getSettings() immediately
        // or there is a race condition.
        // We TRUST the ID passed to this function.
        filter.deviceId = id;
        // log.info(`[IPC] Forcing update with device filter: ${filter.deviceId}`)
        const items = db.getItems(20, 0, filter);
        // log.info(`[IPC] Found ${items.length} items for device`)
        mainWindow.webContents.send('clipboard-update', normalizeForIPC(items));
    }
    // broadcastUpdate() // Replaced by explicit block above for debugging
    return result;
});
// App Lifecycle
app.whenReady().then(async () => {
    await db.init(app);
    configureAutoLaunch();
    if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
    }
    // --- Integration Start ---
    // Initialize the BackendDaemon which sets up the request handling and IPC
    BackendDaemon_1.BackendDaemon.getInstance();
    log.info('Backend Daemon Initialized');
    // Initialize SyncEngine and start hourly scheduler
    const syncEngine = SyncEngine_1.SyncEngine.getInstance();
    syncEngine.startScheduler();
    log.info('Sync Engine Initialized - Hourly sync enabled');
    // --- Integration End ---
    const device = db.getDevice();
    let deviceId = device ? device.Id : null;
    if (deviceId) {
        db.registerDevice({
            Id: deviceId,
            OsName: process.platform,
            Name: device.Name,
            VersionApp: app.getVersion()
        });
        // Claim orphan items (legacy items with NULL deviceId) for this local device
        db.claimOrphanItems(deviceId);
        // Ensure we have a selected device in settings (default to local)
        if (!db.getSettings().selectedDeviceId) {
            db.setActiveDevice(deviceId);
        }
    }
    protocol.registerFileProtocol('local-image', (request, callback) => {
        const url = request.url.replace('local-image://', '');
        try {
            const decodedUrl = decodeURIComponent(url);
            return callback(decodedUrl);
        }
        catch (error) {
            console.error('Failed to register protocol', error);
        }
    });
    createWindow();
    let iconName = '64x64.png';
    if (process.platform === 'darwin')
        iconName = 'iconTemplate.png';
    else if (process.platform === 'linux')
        iconName = '32x32.png';
    let iconPath = path.join(__dirname, 'frontend', 'media', iconName);
    if (!fs.existsSync(iconPath)) {
        iconPath = path.join(__dirname, 'frontend', 'media', '64x64.png'); // fallback
    }
    if (fs.existsSync(iconPath)) {
        tray = new Tray(nativeImage.createFromPath(iconPath));
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Show', click: () => mainWindow.show() },
            { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
        ]);
        tray.setToolTip('Copyfy Local');
        tray.setContextMenu(contextMenu);
        tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
    }
    startClipboardWatcher();
    const settings = db.getSettings();
    const shortcut = settings.globalShortcut || 'Alt+X';
    const registerShortcut = (accelerator) => {
        globalShortcut.unregisterAll();
        try {
            const ret = globalShortcut.register(accelerator, () => {
                if (mainWindow.isVisible())
                    mainWindow.hide();
                else {
                    mainWindow.show();
                    mainWindow.focus();
                }
            });
            if (!ret) {
                console.log('Registration failed for shortcut:', accelerator);
            }
        }
        catch (e) {
            console.error('Error registering shortcut', e);
        }
    };
    registerShortcut(shortcut);
    ipcMain.on('update-global-shortcut', (_, newShortcut) => {
        db.updateSettings({ GlobalShortcut: newShortcut });
        registerShortcut(newShortcut);
    });
});
app.on('window-all-closed', () => {
});
app.on('before-quit', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    // Cleanup: Detener clipboard watcher
    stopClipboardWatcher();
    // Cleanup: Detener SyncEngine
    const syncEngine = SyncEngine_1.SyncEngine.getInstance();
    syncEngine.destroy();
    log.info('[Main] App cleanup completed');
});
ipcMain.on('open-image-viewer', (_, dataUrl) => {
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '');
        createOCRWindow(`local-image://${p}`);
        return;
    }
    if (dataUrl.startsWith('local-image://')) {
        createOCRWindow(dataUrl);
        return;
    }
    if (dataUrl.startsWith('data:image')) {
        try {
            const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/);
            const ext = match && match[1] ? (match[1].includes('svg') ? 'svg' : match[1].split('+')[0].split('.').pop()) : 'png';
            const b64 = match && match[2] ? match[2] : dataUrl.split(',')[1];
            if (b64) {
                const buf = Buffer.from(b64, 'base64');
                const imagesDir = path.join(app.getPath('userData'), 'images', 'tmp');
                if (!fs.existsSync(imagesDir))
                    fs.mkdirSync(imagesDir, { recursive: true });
                const filename = `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'png'}`;
                const filePath = path.join(imagesDir, filename);
                fs.writeFileSync(filePath, buf);
                createOCRWindow(`local-image://${filePath}`);
                return;
            }
        }
        catch (e) {
            console.error('Failed to persist data URL image:', e);
        }
    }
    createOCRWindow(`local-image://${dataUrl}`);
});
ipcMain.on('open-ocr-window', (_, imagePath) => {
    if (imagePath.startsWith('[LOCAL_IMAGE]:')) {
        const p = imagePath.replace('[LOCAL_IMAGE]:', '');
        createOCRWindow(`local-image://${p}`);
        return;
    }
    if (imagePath.startsWith('local-image://')) {
        createOCRWindow(imagePath);
        return;
    }
    if (imagePath.startsWith('data:image')) {
        try {
            const match = imagePath.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/);
            const ext = match && match[1] ? (match[1].includes('svg') ? 'svg' : match[1].split('+')[0].split('.').pop()) : 'png';
            const b64 = match && match[2] ? match[2] : imagePath.split(',')[1];
            if (b64) {
                const buf = Buffer.from(b64, 'base64');
                const imagesDir = path.join(app.getPath('userData'), 'images', 'tmp');
                if (!fs.existsSync(imagesDir))
                    fs.mkdirSync(imagesDir, { recursive: true });
                const filename = `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'png'}`;
                const filePath = path.join(imagesDir, filename);
                fs.writeFileSync(filePath, buf);
                createOCRWindow(`local-image://${filePath}`);
                return;
            }
        }
        catch (e) {
            console.error('Failed to persist data URL image (OCR):', e);
        }
    }
    if ((/^[a-zA-Z]:\\/.test(imagePath) || imagePath.startsWith('/')) && fs.existsSync(imagePath)) {
        createOCRWindow(`local-image://${imagePath}`);
        return;
    }
    createOCRWindow(imagePath);
});
ipcMain.on('open-code-editor', (_, content) => {
    createCodeWindow(content);
});
