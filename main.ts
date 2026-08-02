const {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  nativeImage,
  Tray,
  Menu,
  shell,
  Notification,
  protocol,
  dialog
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const FormData = require('form-data')

import { BackendDaemon } from './backend/BackendDaemon';
import { SyncEngine } from './backend/SyncEngine';
import { normalizeForIPC } from './backend/ipc-utils';
const { autoUpdater } = require('electron-updater');

const db = require('./db')
const { configureAutoLaunch } = require('./autolaunch')

const log = {
  info: (...args: any[]) => console.log('[MAIN]', ...args),
  error: (...args: any[]) => console.error('[MAIN]', ...args),
  warn: (...args: any[]) => console.warn('[MAIN]', ...args),
  debug: () => {}
}

let mainWindow: any
let ocrWindow: any = null
let codeWindow: any = null
let settingsWindow: any = null
let pendingCodeContent: any = null
let tray: any
let isQuitting = false
let rebuildTrayMenu: (() => void) | null = null

// Set app name and ensure userData exists to avoid Lock file error (Error code: 3)
app.setName('CopyFy++');
if (process.platform === 'win32') {
  app.setAppUserModelId('CopyFy++')
}
const userDataPath = app.getPath('userData');
if (!fs.existsSync(userDataPath)) {
    try {
        fs.mkdirSync(userDataPath, { recursive: true });
    } catch (e) {
        log.error('Failed to create userData directory:', e);
    }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event: any, commandLine: any, workingDirectory: any) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      positionWindowAtCursor()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

// Detect if launched at startup (minimized to tray)
const startHidden = process.argv.includes('--hidden')

// normalizeForIPC importado desde ./backend/ipc-utils

// Helper: Broadcast update to main window with correct filtering
function broadcastUpdate() {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        const settings = db.getSettings()
        log.info(`[Main] broadcastUpdate settings.selectedDeviceId: ${settings.selectedDeviceId}`)
        
        const filter: any = {}
        if (settings.selectedDeviceId) {
            filter.deviceId = settings.selectedDeviceId
        }
        
        const items = db.getItems(20, 0, filter)
        log.info(`[Main] broadcastUpdate sending ${items.length} items (Device: ${filter.deviceId || 'ALL'})`)
        
        try {
            mainWindow.webContents.send('clipboard-update', normalizeForIPC(items))
        } catch (e) {
            log.error('[Main] Failed to send clipboard-update:', e)
        }
    }
}


// Position window near mouse cursor, clamped within the display bounds
function positionWindowAtCursor() {
  if (!mainWindow) return
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x: wX, y: wY, width: wW, height: wH } = display.workArea
  const [winWidth, winHeight] = mainWindow.getSize()

  // Center the window on the cursor, then clamp to stay within the display
  let x = cursorPoint.x - Math.round(winWidth / 2)
  let y = cursorPoint.y - Math.round(winHeight / 2)

  // Clamp to work area bounds
  if (x < wX) x = wX
  if (y < wY) y = wY
  if (x + winWidth > wX + wW) x = wX + wW - winWidth
  if (y + winHeight > wY + wH) y = wY + wH - winHeight

  mainWindow.setPosition(x, y)
}

// Window Creation
function createWindow() {
  const display = screen.getPrimaryDisplay()
  const screenWidth = display.workArea.width
  const screenHeight = display.workArea.height
  const windowWidth = 360
  const windowHeight = 600
  const finalX = Math.round((screenWidth - windowWidth) / 2)
  const finalY = Math.round((screenHeight - windowHeight) / 2)

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: finalX,
    y: finalY,
    frame: false,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    alwaysOnTop: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  const indexPath = app.isPackaged
    ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
    : 'http://127.0.0.1:5173'
  
  if (app.isPackaged) {
    mainWindow.loadFile(indexPath)
  } else {
    mainWindow.loadURL(indexPath)
  }

  mainWindow.once('ready-to-show', () => {
    // Clipboard manager: siempre inicia oculto en la bandeja.
    // El usuario lo muestra con el shortcut global (Alt+X) o clic en tray.
    broadcastUpdate()
  })
}

let authWindow: any = null

function createAuthWindow() {
  if (authWindow) {
    authWindow.focus()
    return
  }
  if (mainWindow && mainWindow.isVisible()) mainWindow.hide()

  const display = screen.getPrimaryDisplay()
  const width = 320
  const height = 380
  const x = Math.round((display.workArea.width - width) / 2)
  const y = Math.round((display.workArea.height - height) / 2)

  authWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  const indexPath = app.isPackaged
    ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
    : 'http://127.0.0.1:5173'

  if (app.isPackaged) {
    authWindow.loadFile(indexPath, { search: 'mode=auth' })
  } else {
    authWindow.loadURL(`${indexPath}?mode=auth`)
  }

  authWindow.on('closed', () => { authWindow = null })
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }
  if (mainWindow && mainWindow.isVisible()) mainWindow.hide()

  const display = screen.getPrimaryDisplay()
  const width = 520
  const height = 640
  const x = Math.round((display.workArea.width - width) / 2)
  const y = Math.round((display.workArea.height - height) / 2)

  settingsWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    title: 'CopyFy++ - Settings',
    frame: false,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    },
    autoHideMenuBar: true
  })

  const indexPath = app.isPackaged
    ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
    : 'http://127.0.0.1:5173'

  if (app.isPackaged) {
    settingsWindow.loadFile(indexPath, { search: 'mode=settings' })
  } else {
    settingsWindow.loadURL(`${indexPath}?mode=settings`)
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function createOCRWindow(imagePath: string) {
    if (ocrWindow) {
        ocrWindow.focus()
        ocrWindow.webContents.send('ocr-load-image', imagePath)
        return
    }

    const display = screen.getPrimaryDisplay()
    const screenWidth = display.workArea.width
    const screenHeight = display.workArea.height
    const mainWidth = 400
    
    const width = screenWidth - mainWidth
    const height = screenHeight
    const x = 0
    const y = 0

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
    })

    const indexPath = app.isPackaged
      ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
      : 'http://127.0.0.1:5173'
    
    const url = `${indexPath}?mode=ocr&img=${encodeURIComponent(imagePath)}`

    if (app.isPackaged) {
       ocrWindow.loadFile(indexPath, { search: `mode=ocr&img=${encodeURIComponent(imagePath)}` }).then(() => {
           ocrWindow.webContents.send('ocr-load-image', imagePath)
       })
    } else {
       ocrWindow.loadURL(url)
    }

    ocrWindow.on('closed', () => {
        ocrWindow = null
    })
}

function createCodeWindow(codeContent: string) {
    pendingCodeContent = codeContent 

    if (codeWindow) {
        codeWindow.focus()
        codeWindow.webContents.send('code-load-content', codeContent)
        return
    }

    const display = screen.getPrimaryDisplay()
    const screenWidth = display.workArea.width
    const screenHeight = display.workArea.height
    const mainWidth = 400
    
    const width = screenWidth - mainWidth
    const height = screenHeight
    const x = 0
    const y = 0

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
    })

    const indexPath = app.isPackaged
      ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
      : 'http://127.0.0.1:5173'
    
    const url = `${indexPath}?mode=code`

    if (app.isPackaged) {
       codeWindow.loadFile(indexPath, { search: 'mode=code' }).then(() => {
       })
    } else {
       codeWindow.loadURL(url)
    }
    
    codeWindow.once('ready-to-show', () => {
        codeWindow.show()
    })

    codeWindow.on('closed', () => {
        codeWindow = null
        pendingCodeContent = null
    })
}

// Handshake listener
ipcMain.on('code-window-ready', (event: any) => {
    if (codeWindow && pendingCodeContent) {
        codeWindow.webContents.send('code-load-content', pendingCodeContent)
    }
})

ipcMain.on('app-ready', () => {
    log.info('[Main] Received app-ready signal from renderer')
    broadcastUpdate()
    
    // Sync devices on app startup if authenticated
    const settings = db.getSettings()
    if (settings && settings.accessToken) {
        log.info('[Main] User authenticated, triggering device sync on startup')
        BackendDaemon.getInstance().syncDevicesOnLogin(true).catch((e: any) => {
            log.error('[Main] Failed to sync devices on startup:', e)
        })
    }
})

// Clipboard Watcher
let lastText = ''
let lastImageHash = ''
let clipboardWatcherInterval: NodeJS.Timeout | null = null

// --- Helper: Guardar imagen directamente y mostrar notificación nativa ---
function saveImageDirectly(image: any, hash: string) {
  try {
    const imagesDir = path.join(app.getPath('userData'), 'images')
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
    const filename = `${Date.now()}-${hash.substring(0,8)}.png`
    const filePath = path.join(imagesDir, filename)
    fs.writeFileSync(filePath, image.toPNG())

    const backendDaemon = BackendDaemon.getInstance()
    const result = backendDaemon.saveClipboardItem(`[LOCAL_IMAGE]:${filePath}`, 'image')

    if (result) {
      broadcastUpdate()
      const syncEngine = SyncEngine.getInstance()
      syncEngine.enqueueItem(result.id, 'CREATE').catch(err => {
        log.error('Failed to enqueue image for sync:', err)
      })
    }

    // Notificación de imagen removida — demasiado frecuente para el usuario
  } catch (e) {
    log.error('Error saving image:', e)
  }
}

function startClipboardWatcher() {
  // Prevenir múltiples watchers
  if (clipboardWatcherInterval) {
    return
  }

  clipboardWatcherInterval = setInterval(() => {
    try {
      const text = clipboard.readText()
      // ... existing text logic ...
      if (text && text.trim() !== '' && text !== lastText) {
          lastText = text
          
          // Usar BackendDaemon para guardar (incluye deviceId automáticamente)
          const backendDaemon = BackendDaemon.getInstance()
          const result = backendDaemon.saveClipboardItem(text, 'text')
          
          if (result) {
            broadcastUpdate()
            
            // Encolar para sincronización
            const syncEngine = SyncEngine.getInstance()
            syncEngine.enqueueItem(result.id, 'CREATE').catch(err => {
              log.error('Failed to enqueue item for sync:', err)
            })
          }
      }

      // 1. Detect Images
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const buffer = image.getBitmap()
        const hash = crypto.createHash('md5').update(buffer).digest('hex')
        if (hash !== lastImageHash) {
            lastImageHash = hash
            saveImageDirectly(image, hash)
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
           } catch (e) {
               // ignore buffer read errors
           }
       } else if (process.platform === 'darwin') {
           // macOS: Try 'public.file-url'
           // The clipboard often contains the file URL string e.g. file:///Users/name/file.png
           const fileUrl = clipboard.read('public.file-url');
           if (fileUrl && fileUrl.startsWith('file://')) {
               detectedFilePath = decodeURIComponent(fileUrl.replace('file://', ''));
           }
       } else if (process.platform === 'linux') {
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
                            saveImageDirectly(image, fileHash)
                       }
                       // Non-image files are ignored by the watcher — user uploads manually
                   }
               }
           } catch(e) {
               // ignore access errors
           }
       }
    } catch (e) {
      log.error('Clipboard watcher error:', e)
    }
  }, 1000)
}

function stopClipboardWatcher() {
  if (clipboardWatcherInterval) {
    clearInterval(clipboardWatcherInterval)
    clipboardWatcherInterval = null
    log.info('[Main] Clipboard watcher stopped')
  }
}

// IPC Handlers
// File Management IPC
ipcMain.handle('list-files', async (_: any, params: any) => {
    const backend = BackendDaemon.getInstance();
    
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
    if (queryParams.clientId) delete queryParams.clientId;

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
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
});

ipcMain.handle('upload-file', async (_: any, filePath: string) => {
    try {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        const backend = BackendDaemon.getInstance();
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
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('upload-avatar', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Select avatar image',
            filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
            properties: ['openFile']
        });
        if (canceled || !filePaths.length) return { success: false, canceled: true };

        const filePath = filePaths[0];
        const backend = BackendDaemon.getInstance();
        const form = new FormData();
        form.append('avatar', fs.createReadStream(filePath));

        const res = await backend.request({
            url: '/users/me/avatar',
            method: 'POST',
            data: form,
            headers: form.getHeaders()
        });
        return res;
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-file', async (_: any, fileId: string) => {
    const backend = BackendDaemon.getInstance();
    return await backend.request({
        url: `/api/files/${fileId}`,
        method: 'DELETE'
    });
});

ipcMain.handle('download-file', async (_: any, fileId: string, fileName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: fileName,
        title: 'Guardar archivo'
    });
    
    if (canceled || !filePath) return { canceled: true };

    const backend = BackendDaemon.getInstance();
    const res = await backend.request({
        url: `/api/files/${fileId}/download`,
        method: 'GET',
        responseType: 'arraybuffer'
    });

    if (res.success) {
        try {
            fs.writeFileSync(filePath, Buffer.from(res.data));
            return { success: true, filePath };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
    return res;
});

ipcMain.handle('get-clipboard-history', (_: any, { limit = 20, offset = 0, filter = {} }: any = {}) => {
  const settings = db.getSettings()
  
  if (settings.selectedDeviceId) {
      filter.deviceId = settings.selectedDeviceId
  }
  const items = db.getItems(limit, offset, filter)
  return normalizeForIPC(items)
})

ipcMain.handle('delete-history-item', (_: any, id: string) => {
  db.deleteItem(id)
  broadcastUpdate()
  return [] // Return empty or updated list? Frontend seems to expect list but usually re-fetches or uses broadcast
})

ipcMain.handle('search-history', (_: any, payload: any) => {
    const filter: any = {}
    if (payload && payload.query) filter.search = payload.query
    if (payload && payload.type) filter.type = payload.type
    
    // Apply selected device filter
    const settings = db.getSettings()
    if (settings.selectedDeviceId) {
        filter.deviceId = settings.selectedDeviceId
    }
    
    return normalizeForIPC(db.getItems(100, 0, filter))
})

ipcMain.handle('clear-history', () => {
  db.clearAll()
  return []
})

ipcMain.on('toggle-favorite', (_: any, { id, isFavorite }: any) => {
    db.setFavorite(id, isFavorite)
    broadcastUpdate()
})

ipcMain.on('copy-to-clipboard', (_: any, text: string) => {
  lastText = text 
  clipboard.writeText(text)
})

// Muestra una notificación indicando que el pegado automático no está disponible (fallback Linux)
function notifyLinuxPasteUnavailable() {
    const settings = db.getSettings()
    const lang = settings.language || 'en'

    let title = 'CopyFy'
    let body = ''

    if (lang.toLowerCase().startsWith('es')) {
        title = 'Pegado automático no disponible'
        body = 'Usa Ctrl+V o clic derecho -> Pegar para pegar el contenido copiado.'
    } else {
        title = 'Auto-paste not available'
        body = 'Use Ctrl+V or right click -> Paste to paste the copied content.'
    }

    if (Notification.isSupported()) {
        new Notification({ title, body }).show()
    }
}

ipcMain.on('paste-text', () => {
    const { execFile } = require('child_process')

    if (process.platform === 'win32') {
        // Windows: helper nativo que envía Ctrl+V a la ventana en primer plano
        const pasteExe = path.join(__dirname, 'helpers', 'paste.exe')
        if (fs.existsSync(pasteExe)) {
            execFile(pasteExe, (err: any) => {
                if (err) log.error('Paste error:', err)
            })
        }
    } else if (process.platform === 'darwin') {
        // macOS: ocultar el popup para devolver el foco a la app anterior y enviar Cmd+V.
        // Requiere permiso de Accesibilidad (System Settings > Privacy & Security > Accessibility).
        if (mainWindow && mainWindow.isVisible()) mainWindow.hide()
        setTimeout(() => {
            execFile(
                'osascript',
                ['-e', 'tell application "System Events" to keystroke "v" using command down'],
                (err: any) => {
                    if (err) log.error('macOS auto-paste error (se requiere permiso de Accesibilidad):', err)
                }
            )
        }, 120)
    } else if (process.platform === 'linux') {
        // Linux: intentar xdotool (X11). En Wayland o sin xdotool, mostrar notificación de fallback.
        if (mainWindow && mainWindow.isVisible()) mainWindow.hide()
        setTimeout(() => {
            execFile('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], (err: any) => {
                if (err) notifyLinuxPasteUnavailable()
            })
        }, 120)
    }
})

ipcMain.on('copy-image', (_: any, dataUrl: string) => {
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
        if (fs.existsSync(p)) {
            const img = nativeImage.createFromPath(p)
            clipboard.writeImage(img)
            const hash = crypto.createHash('md5').update(img.toDataURL()).digest('hex')
            lastImageHash = hash
        }
    }
})

ipcMain.handle('get-config', (_: any, key: string) => {
    const s = db.getSettings()
    if (key === 'session') {
        return s.accessToken ? JSON.stringify({ 
            token: s.accessToken,
            refreshToken: s.refreshToken 
        }) : null
    }
    if (key === 'darkMode') return s.isDarkMode ? 'true' : 'false'
    if (key === 'selectedDeviceId') return s.selectedDeviceId || null
    return null
})

ipcMain.handle('set-config', (_: any, key: string, value: string) => {
    if (key === 'session') {
        try {
            const v = JSON.parse(value)
            db.updateSettings({ AccessToken: v.token, RefreshToken: v.refreshToken })
            if (rebuildTrayMenu) rebuildTrayMenu()
        } catch(e) {}
    }
    if (key === 'darkMode') {
        db.updateSettings({ IsDarkMode: value === 'true' })
        if (rebuildTrayMenu) rebuildTrayMenu()
        // Notify all windows
        BrowserWindow.getAllWindows().forEach((win: any) => {
            if (!win.isDestroyed()) {
                win.webContents.send('theme-changed', value === 'true')
            }
        })
    }
})

ipcMain.handle('remove-config', (_: any, key: string) => {
    if (key === 'session') {
        db.updateSettings({ AccessToken: null, RefreshToken: null })
        if (rebuildTrayMenu) rebuildTrayMenu()
    }
})

ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-system-locale', () => app.getLocale())
ipcMain.handle('get-hostname', () => os.hostname())

// --- Native System Notifications ---
ipcMain.handle('show-notification', (_: any, opts: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({
      title: opts.title || 'CopyFy++',
      body: opts.body || '',
      icon: path.join(__dirname, 'frontend', 'media', '64x64.png')
    })
    notif.show()
  }
})
ipcMain.handle('hide-window', () => mainWindow && mainWindow.hide())
ipcMain.handle('close-window', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && win !== mainWindow) win.close()
    else if (win === mainWindow) win.hide() 
})

ipcMain.handle('get-preferences', () => {
    return db.getSettings()
})

ipcMain.handle('set-preferences', (_: any, prefs: any) => {
    const dbUpdate: any = {}
    if (prefs.isDarkMode !== undefined) dbUpdate.IsDarkMode = prefs.isDarkMode
    if (prefs.language) dbUpdate.Language = prefs.language
    if (prefs.globalShortcut) dbUpdate.GlobalShortcut = prefs.globalShortcut
    
    if (prefs.colorPrimary || prefs.colorSecondary || prefs.colorBg || prefs.colorSurface || prefs.colorText || prefs.fontSize) {
        const currentTheme = JSON.parse(db.getSettings().theme || '{}')
        if (prefs.colorPrimary) currentTheme.primary = prefs.colorPrimary
        if (prefs.colorSecondary) currentTheme.secondary = prefs.colorSecondary
        if (prefs.colorBg) currentTheme.bg = prefs.colorBg
        if (prefs.colorSurface) currentTheme.surface = prefs.colorSurface
        if (prefs.colorText) currentTheme.text = prefs.colorText
        if (prefs.fontSize) currentTheme.fontSize = prefs.fontSize
        dbUpdate.Theme = JSON.stringify(currentTheme)
    }
    
    const newSettings = db.updateSettings(dbUpdate)
    
    if (dbUpdate.GlobalShortcut) {
        ipcMain.emit('update-global-shortcut', null, dbUpdate.GlobalShortcut)
    }

    if (rebuildTrayMenu) rebuildTrayMenu()

    // Broadcast preference changes to all windows
    const broadcastData: any = {}
    if (prefs.colorPrimary) broadcastData.colorPrimary = prefs.colorPrimary
    if (prefs.colorSecondary) broadcastData.colorSecondary = prefs.colorSecondary
    if (prefs.colorBg) broadcastData.colorBg = prefs.colorBg
    if (prefs.colorSurface) broadcastData.colorSurface = prefs.colorSurface
    if (prefs.colorText) broadcastData.colorText = prefs.colorText
    if (prefs.fontSize) broadcastData.fontSize = prefs.fontSize
    if (prefs.language) broadcastData.language = prefs.language

    if (Object.keys(broadcastData).length > 0) {
      BrowserWindow.getAllWindows().forEach((win: any) => {
        if (!win.isDestroyed()) {
          win.webContents.send('preferences-changed', broadcastData)
        }
      })
    }
    
    return newSettings
})

ipcMain.handle('get-all-devices', () => {
    return db.getDevices()
})

ipcMain.handle('register-new-device', (_: any, name: string) => {
    const resId = db.registerDevice({
        Id: null,
        OsName: process.platform,
        Name: name,
        VersionApp: app.getVersion()
    })
    
    if (resId) {
        db.updateAllItemsDevice(resId)
        return { id: resId, name }
    }
    return null
})

// App Lifecycle
app.whenReady().then(async () => {
  await db.init(app)
  configureAutoLaunch()

  if (process.platform === 'darwin' && app.dock) {
      app.dock.hide()
  }
  
  BackendDaemon.getInstance();
  log.info('Backend Daemon Initialized');
  
  const syncEngine = SyncEngine.getInstance();
  syncEngine.startScheduler();
  log.info('Sync Engine Initialized');

  const device = db.getDevice()
  let deviceId = device ? device.Id : null
  
  if (deviceId) {
      db.registerDevice({
          Id: deviceId,
          OsName: process.platform,
          Name: device.Name,
          VersionApp: app.getVersion()
      })
      
      // Claim orphan items (legacy items with NULL deviceId) for this local device
      db.claimOrphanItems(deviceId)

      // Ensure we have a selected device in settings (default to local)
      if (!db.getSettings().selectedDeviceId) {
          db.setActiveDevice(deviceId)
      }
  }

  protocol.registerFileProtocol('local-image', (request: any, callback: any) => {
    const url = request.url.replace('local-image://', '')
    try {
      const decodedUrl = decodeURIComponent(url)
      return callback(decodedUrl)
    } catch (error) {
      console.error('Failed to register protocol', error)
    }
  })

  createWindow()
  
  let iconName = '64x64.png'
  if (process.platform === 'darwin') iconName = 'iconTemplate.png'
  else if (process.platform === 'linux') iconName = '32x32.png'
  
  let iconPath = path.join(__dirname, 'frontend', 'media', iconName)
  if (!fs.existsSync(iconPath)) {
      iconPath = path.join(__dirname, 'frontend', 'media', '64x64.png') // fallback
  }

  if (fs.existsSync(iconPath)) {
      let trayImage = nativeImage.createFromPath(iconPath)
      // La barra de menú de macOS y la mayoría de bandejas de Linux esperan iconos pequeños.
      // El icono de origen es de 64px, así que lo reescalamos para que no se vea gigante/borroso.
      if (process.platform === 'darwin') {
          trayImage = trayImage.resize({ width: 18, height: 18 })
      } else if (process.platform === 'linux') {
          trayImage = trayImage.resize({ width: 22, height: 22 })
      }
      tray = new Tray(trayImage)

      const buildTrayMenu = () => {
        const settings = db.getSettings()
        const isDark = settings.isDarkMode
        const hasSession = !!settings.accessToken
        const lang = settings.language || 'en'
        const isEn = lang.startsWith('en')

        const template: any[] = [
          {
            label: isEn ? 'Show CopyFy++' : 'Mostrar CopyFy++',
            click: () => {
              positionWindowAtCursor()
              mainWindow.show()
              mainWindow.focus()
            }
          },
          { type: 'separator' },
          {
            label: isDark ? (isEn ? 'Light mode' : 'Modo claro') : (isEn ? 'Dark mode' : 'Modo oscuro'),
            click: () => {
              const newDark = !isDark
              db.updateSettings({ IsDarkMode: newDark })
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('theme-changed', newDark)
              }
              buildTrayMenu()
            }
          },
          ...(hasSession ? [
            {
              label: isEn ? 'Log out' : 'Cerrar sesión',
              click: async () => {
                db.updateSettings({ AccessToken: null, RefreshToken: null })
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('session-changed', null)
                }
                buildTrayMenu()
              }
            }
          ] : [
            {
              label: isEn ? 'Log in' : 'Iniciar sesión',
              click: () => { mainWindow.hide(); createAuthWindow() }
            }
          ]),
          { type: 'separator' },
          {
            label: isEn ? 'Settings' : 'Configuración',
            click: () => { mainWindow.hide(); createSettingsWindow() }
          },
          {
            label: isEn ? 'Sync' : 'Sincronizar',
            click: () => {
              const se = SyncEngine.getInstance()
              se.syncNow().catch(() => {})
            }
          },
          { type: 'separator' },
          {
            label: isEn ? 'Quit' : 'Salir',
            click: () => { isQuitting = true; app.quit() }
          }
        ]

        const contextMenu = Menu.buildFromTemplate(template)
        tray.setContextMenu(contextMenu)
      }

      buildTrayMenu()
      rebuildTrayMenu = buildTrayMenu
      tray.setToolTip('CopyFy++')

      // Rebuild tray menu when auth state changes
      ipcMain.on('auth:login-success', () => {
        buildTrayMenu()
        // Notify main window to reload session
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('session-changed', 'logged-in')
        }
      })

      tray.on('click', () => {
          if (mainWindow.isVisible()) {
              mainWindow.hide()
          } else {
              positionWindowAtCursor()
              mainWindow.show()
              mainWindow.focus()
          }
      })
  }

  startClipboardWatcher()

  const settings = db.getSettings()
  const shortcut = settings.globalShortcut || 'Alt+X'
  
  const registerShortcut = (accelerator: string) => {
      globalShortcut.unregisterAll()
      try {
          const ret = globalShortcut.register(accelerator, () => {
              if (mainWindow.isVisible()) mainWindow.hide()
              else {
                  positionWindowAtCursor()
                  mainWindow.show()
                  mainWindow.focus()
              }
          })
          if (!ret) {
              console.log('Registration failed for shortcut:', accelerator)
          }
      } catch (e) {
          console.error('Error registering shortcut', e)
      }
  }

  registerShortcut(shortcut)

  ipcMain.on('update-global-shortcut', (_: any, newShortcut: string) => {
      db.updateSettings({ GlobalShortcut: newShortcut })
      registerShortcut(newShortcut)
  })

  // --- Auto-actualización (independiente del login) ---
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info: any) => {
      log.info('[Updater] Update available:', info.version)
    })

    autoUpdater.on('download-progress', (progress: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', progress)
      }
    })

    autoUpdater.on('update-downloaded', (info: any) => {
      log.info('[Updater] Update downloaded:', info.version)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', info.version)
      }
    })

    autoUpdater.on('error', (err: any) => {
      log.error('[Updater] Error:', err?.message || err)
    })

    // Verificar actualizaciones al iniciar y luego cada 4 horas
    autoUpdater.checkForUpdatesAndNotify().catch((err: any) => {
      log.error('[Updater] Check failed:', err?.message || err)
    })

    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err: any) => {
        log.error('[Updater] Periodic check failed:', err?.message || err)
      })
    }, 4 * 60 * 60 * 1000)
  }
})

app.on('window-all-closed', () => {
})

app.on('before-quit', () => {
  isQuitting = true
  
  globalShortcut.unregisterAll()
  
  // Cleanup: Detener clipboard watcher
  stopClipboardWatcher()
  
  // Cleanup: Detener SyncEngine
  const syncEngine = SyncEngine.getInstance()
  syncEngine.destroy()
  
  log.info('[Main] App cleanup completed')
})

ipcMain.on('open-image-viewer', (_: any, dataUrl: string) => {
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
        createOCRWindow(`local-image://${p}`)
        return
    }
    
    if (dataUrl.startsWith('local-image://')) {
        createOCRWindow(dataUrl)
        return
    }
    
    if (dataUrl.startsWith('data:image')) {
        try {
            const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/)
            const ext = match && match[1] ? (match[1].includes('svg') ? 'svg' : match[1].split('+')[0].split('.').pop()) : 'png'
            const b64 = match && match[2] ? match[2] : dataUrl.split(',')[1]
            if (b64) {
                const buf = Buffer.from(b64, 'base64')
                const imagesDir = path.join(app.getPath('userData'), 'images', 'tmp')
                if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
                const filename = `view-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext || 'png'}`
                const filePath = path.join(imagesDir, filename)
                fs.writeFileSync(filePath, buf)
                createOCRWindow(`local-image://${filePath}`)
                return
            }
        } catch (e) {
            console.error('Failed to persist data URL image:', e)
        }
    }
    
    createOCRWindow(`local-image://${dataUrl}`)
})

ipcMain.on('open-ocr-window', (_: any, imagePath: string) => {
    if (imagePath.startsWith('[LOCAL_IMAGE]:')) {
        const p = imagePath.replace('[LOCAL_IMAGE]:', '')
        createOCRWindow(`local-image://${p}`)
        return
    }
    
    if (imagePath.startsWith('local-image://')) {
        createOCRWindow(imagePath)
        return
    }
    
    if (imagePath.startsWith('data:image')) {
        try {
            const match = imagePath.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/)
            const ext = match && match[1] ? (match[1].includes('svg') ? 'svg' : match[1].split('+')[0].split('.').pop()) : 'png'
            const b64 = match && match[2] ? match[2] : imagePath.split(',')[1]
            if (b64) {
                const buf = Buffer.from(b64, 'base64')
                const imagesDir = path.join(app.getPath('userData'), 'images', 'tmp')
                if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
                const filename = `view-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext || 'png'}`
                const filePath = path.join(imagesDir, filename)
                fs.writeFileSync(filePath, buf)
                createOCRWindow(`local-image://${filePath}`)
                return
            }
        } catch (e) {
            console.error('Failed to persist data URL image (OCR):', e)
        }
    }
    
    if ((/^[a-zA-Z]:\\/.test(imagePath) || imagePath.startsWith('/')) && fs.existsSync(imagePath)) {
        createOCRWindow(`local-image://${imagePath}`)
        return
    }
    
    createOCRWindow(imagePath)
})

ipcMain.on('open-code-editor', (_: any, content: string) => {
    createCodeWindow(content)
})
