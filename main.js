"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, screen, nativeImage, Tray, Menu, shell, Notification, powerMonitor, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
// --- Integration Start ---
// Assuming TypeScript compilation or ts-node
// If using plain JS, this would be: const { BackendDaemon } = require('./backend/BackendDaemon')
const BackendDaemon_1 = require("./backend/BackendDaemon");
// --- Integration End ---
const db = require('./db');
const { configureAutoLaunch } = require('./autolaunch');
const electronLog = require('electron-log');
const { exec, execFile, spawnSync } = require('child_process');
const log = {
    info: () => { },
    error: (...args) => console.error('[MAIN]', ...args),
    warn: () => { },
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
        : 'http://localhost:5173';
    if (app.isPackaged) {
        mainWindow.loadFile(indexPath);
    }
    else {
        mainWindow.loadURL(indexPath);
    }
    mainWindow.once('ready-to-show', () => {
        const settings = db.getSettings();
        mainWindow.show();
        // mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems())); // Let frontend fetch initial
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
        : 'http://localhost:5173';
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
        : 'http://localhost:5173';
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
    const height = 300;
    const x = display.workArea.width - width - 20;
    const y = display.workArea.height - height - 20;
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
        : 'http://localhost:5173';
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
ipcMain.on('notification-window-ready', () => {
    if (notificationWindow && pendingNotificationImage) {
        const dataUrl = pendingNotificationImage.image.toDataURL();
        notificationWindow.webContents.send('notification-load-image', dataUrl);
    }
});
ipcMain.on('notification-action', (_, action) => {
    if (action === 'save' && pendingNotificationImage) {
        try {
            const { image, hash } = pendingNotificationImage;
            const imagesDir = path.join(app.getPath('userData'), 'images');
            if (!fs.existsSync(imagesDir))
                fs.mkdirSync(imagesDir, { recursive: true });
            const filename = `${Date.now()}-${hash.substring(0, 8)}.png`;
            const filePath = path.join(imagesDir, filename);
            fs.writeFileSync(filePath, image.toPNG());
            // db.insertItem(`[LOCAL_IMAGE]:${filePath}`, 'image');
            BackendDaemon_1.BackendDaemon.getInstance().saveClipboardItem(`[LOCAL_IMAGE]:${filePath}`, 'image');
            // if (mainWindow && !mainWindow.isDestroyed()) {
            //    mainWindow.webContents.send('clipboard-update');
            // }
        }
        catch (e) {
            log.error('Error saving image:', e);
        }
    }
    pendingNotificationImage = null;
    if (notificationWindow) {
        notificationWindow.close();
    }
});
// Clipboard Watcher
let lastText = '';
let lastImageHash = '';

function readClipboardFiles() {
    const files = [];
    if (process.platform === 'win32') {
        try {
            // Windows: 'FileNameW' provides the path of the first file (UCS-2/UTF-16LE encoded)
            const raw = clipboard.readBuffer('FileNameW');
            if (raw.length > 0) {
                let filePath = raw.toString('ucs2');
                filePath = filePath.replace(new RegExp('\0', 'g'), '');
                if (filePath && fs.existsSync(filePath)) {
                    files.push(filePath);
                }
            }
        } catch (e) {
            log.error('Error reading clipboard files (Windows):', e);
        }
    } else if (process.platform === 'darwin') {
        try {
            const plist = clipboard.read('NSFilenamesPboardType');
            if (plist) {
                const matches = plist.match(/<string>(.*?)<\/string>/g);
                if (matches) {
                    matches.forEach(match => {
                        const path = match.replace(/<\/?string>/g, '');
                        if (fs.existsSync(path)) files.push(path);
                    });
                }
            }
        } catch (e) {
            log.error('Error reading clipboard files (Mac):', e);
        }
    }
    return files;
}

function startClipboardWatcher() {
    setInterval(() => {
        try {
            const text = clipboard.readText();
            if (text && text.trim() !== '' && text !== lastText) {
                lastText = text;
                // db.insertItem(text, 'text'); <-- OLD
                // Use BackendDaemon to save with active device
                BackendDaemon_1.BackendDaemon.getInstance().saveClipboardItem(text, 'text');
                // BackendDaemon broadcasts 'clipboard-update', so we don't need to send it here manually
                // if mainWindow && ...
            }
            const image = clipboard.readImage();
            if (!image.isEmpty()) {
                const dataUrl = image.toDataURL();
                const hash = crypto.createHash('md5').update(dataUrl).digest('hex');
                if (hash !== lastImageHash) {
                    lastImageHash = hash;
                    pendingNotificationImage = { image, hash };
                    createNotificationWindow();
                }
            } else {
                // Try to read files (e.g. copied from Explorer)
                const files = readClipboardFiles();
                if (files.length > 0) {
                    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
                    for (const file of files) {
                        const ext = path.extname(file).toLowerCase();
                        if (imageExtensions.includes(ext)) {
                            try {
                                const fileImage = nativeImage.createFromPath(file);
                                if (!fileImage.isEmpty()) {
                                    const dataUrl = fileImage.toDataURL();
                                    const hash = crypto.createHash('md5').update(dataUrl).digest('hex');
                                    if (hash !== lastImageHash) {
                                        lastImageHash = hash;
                                        pendingNotificationImage = { image: fileImage, hash };
                                        createNotificationWindow();
                                    }
                                }
                            } catch (err) {
                                log.error('Error processing image file from clipboard:', err);
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            log.error('Clipboard watcher error:', e);
        }
    }, 1000);
}
// IPC Handlers
ipcMain.handle('get-clipboard-history', (_, { limit = 20, offset = 0, filter = {} } = {}) => {
    // Redirect to BackendDaemon active device logic
    const items = BackendDaemon_1.BackendDaemon.getInstance().getItemsByActiveDevice(limit, offset, filter);
    return normalizeForIPC(items);
});
ipcMain.handle('delete-history-item', (_, id) => {
    db.deleteItem(id);
    if (mainWindow)
        mainWindow.webContents.send('clipboard-update');
    return [];
});
ipcMain.handle('search-history', (_, payload) => {
    const filter = {};
    if (payload && payload.query)
        filter.search = payload.query;
    if (payload && payload.type)
        filter.type = payload.type;
    return normalizeForIPC(db.getItems(100, 0, filter));
});
ipcMain.handle('clear-history', () => {
    db.clearAll();
    return [];
});
ipcMain.on('toggle-favorite', (_, { id, isFavorite }) => {
    db.setFavorite(id, isFavorite);
    if (mainWindow)
        mainWindow.webContents.send('clipboard-update');
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
        db.updateAllItemsDevice(resId);
        return { id: resId, name };
    }
    return null;
});
ipcMain.handle('set-active-device', (_, id) => {
    log.info('IPC set-active-device called with:', id);
    return db.setActiveDevice(id);
});
// App Lifecycle
app.whenReady().then(async () => {
    await db.init(app);
    configureAutoLaunch();
    // --- Integration Start ---
    // Initialize the BackendDaemon which sets up the request handling and IPC
    BackendDaemon_1.BackendDaemon.getInstance();
    log.info('Backend Daemon Initialized');
    // --- Integration End ---
    const deviceId = db.ensureLocalDevice();
    const device = db.getDevice(); // This will now return the local device thanks to ensureLocalDevice()

    if (deviceId) {
        db.registerDevice({
            Id: deviceId,
            OsName: process.platform,
            Name: device ? device.Name : os.hostname(), // Use existing name or fallback to hostname
            VersionApp: app.getVersion()
        });
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
    const iconPath = path.join(__dirname, 'frontend', 'media', '64x64.png');
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
                // console.log('Registration failed for shortcut:', accelerator);
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
});
ipcMain.on('open-image-viewer', (_, dataUrl) => {
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '');
        createOCRWindow(`local-image://${p}`);
    }
    else if (dataUrl.startsWith('data:image')) {
        createOCRWindow(dataUrl);
    }
    else if (dataUrl.startsWith('local-image://')) {
        createOCRWindow(dataUrl);
    }
    else {
        createOCRWindow(`local-image://${dataUrl}`);
    }
});
ipcMain.on('open-ocr-window', (_, imagePath) => {
    createOCRWindow(imagePath);
});
ipcMain.on('open-code-editor', (_, content) => {
    createCodeWindow(content);
});
