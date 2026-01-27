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
  powerMonitor,
  protocol
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

// --- Integration Start ---
// Assuming TypeScript compilation or ts-node
// If using plain JS, this would be: const { BackendDaemon } = require('./backend/BackendDaemon')
import { BackendDaemon } from './backend/BackendDaemon';
// --- Integration End ---

const db = require('./db')
const { configureAutoLaunch } = require('./autolaunch')
const electronLog = require('electron-log')
const { exec, execFile, spawnSync } = require('child_process')

const log = {
  info: (...args: any[]) => console.log('[MAIN]', ...args),
  error: (...args: any[]) => console.error('[MAIN]', ...args),
  warn: (...args: any[]) => console.warn('[MAIN]', ...args),
  debug: () => {}
}

let mainWindow: any
let ocrWindow: any = null
let codeWindow: any = null
let notificationWindow: any = null
let pendingNotificationImage: any = null
let pendingCodeContent: any = null
let tray: any
let isQuitting = false

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

// Helper: Normalize item for IPC
function normalizeForIPC(items: any[]) {
  return items.map(i => ({
    id: i.id,
    value: i.value,
    type: i.type,
    favorite: i.favorite,
    createdAt: i.createdAt,
    imagePath: i.type === 'image' && i.value.startsWith('[LOCAL_IMAGE]:') ? i.value.replace('[LOCAL_IMAGE]:', '') : null
  }))
}

// Window Creation
function createWindow() {
  const display = screen.getPrimaryDisplay()
  const screenWidth = display.workArea.width
  const screenHeight = display.workArea.height
  const windowWidth = 400
  const finalX = screenWidth - windowWidth

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
  })

  const indexPath = app.isPackaged
    ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
    : 'http://localhost:5173'
  
  if (app.isPackaged) {
    mainWindow.loadFile(indexPath)
  } else {
    mainWindow.loadURL(indexPath)
  }

  mainWindow.once('ready-to-show', () => {
    const settings = db.getSettings()
    mainWindow.show()
    mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
  })

  mainWindow.on('blur', () => {
    // Optional: hide on blur
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
      : 'http://localhost:5173'
    
    const url = `${indexPath}?mode=ocr&img=${encodeURIComponent(imagePath)}`

    if (app.isPackaged) {
       ocrWindow.loadFile(indexPath).then(() => {
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
      : 'http://localhost:5173'
    
    const url = `${indexPath}?mode=code`

    if (app.isPackaged) {
       codeWindow.loadFile(indexPath).then(() => {
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

function createNotificationWindow() {
    if (notificationWindow) {
        notificationWindow.focus()
        return
    }

    const display = screen.getPrimaryDisplay()
    const width = 350
    const height = 300
    const x = display.workArea.width - width - 20
    const y = display.workArea.height - height - 20

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
    })

    const indexPath = app.isPackaged
      ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
      : 'http://localhost:5173'
    
    const url = `${indexPath}?mode=notification`

    if (app.isPackaged) {
       notificationWindow.loadFile(indexPath).then(() => {
       })
    } else {
       notificationWindow.loadURL(url)
    }

    notificationWindow.on('closed', () => {
        notificationWindow = null
    })
}

// Handshake listener
ipcMain.on('code-window-ready', (event: any) => {
    if (codeWindow && pendingCodeContent) {
        codeWindow.webContents.send('code-load-content', pendingCodeContent)
    }
})

ipcMain.on('notification-window-ready', () => {
    if (notificationWindow && pendingNotificationImage) {
        const dataUrl = pendingNotificationImage.image.toDataURL()
        notificationWindow.webContents.send('notification-load-image', dataUrl)
    }
})

ipcMain.on('notification-action', (_: any, action: string) => {
    if (action === 'save' && pendingNotificationImage) {
        try {
            const { image, hash } = pendingNotificationImage
            const imagesDir = path.join(app.getPath('userData'), 'images')
            if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
            const filename = `${Date.now()}-${hash.substring(0,8)}.png`
            const filePath = path.join(imagesDir, filename)
            fs.writeFileSync(filePath, image.toPNG())
            
            db.insertItem(`[LOCAL_IMAGE]:${filePath}`, 'image')
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
            }
        } catch(e) {
            log.error('Error saving image:', e)
        }
    }
    
    pendingNotificationImage = null
    if (notificationWindow) {
        notificationWindow.close()
    }
})

// Clipboard Watcher
let lastText = ''
let lastImageHash = ''

function startClipboardWatcher() {
  setInterval(() => {
    try {
      const text = clipboard.readText()
      if (text && text.trim() !== '' && text !== lastText) {
        lastText = text
        db.insertItem(text, 'text')
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
        }
      }

      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        const hash = crypto.createHash('md5').update(dataUrl).digest('hex')
        if (hash !== lastImageHash) {
            lastImageHash = hash
            pendingNotificationImage = { image, hash }
            createNotificationWindow()
        }
      }
    } catch (e) {
      log.error('Clipboard watcher error:', e)
    }
  }, 1000)
}

// IPC Handlers
ipcMain.handle('get-clipboard-history', (_: any, { limit = 20, offset = 0, filter = {} } = {}) => {
  return normalizeForIPC(db.getItems(limit, offset, filter))
})

ipcMain.handle('delete-history-item', (_: any, id: string) => {
  db.deleteItem(id)
  const items = normalizeForIPC(db.getItems(100))
  if (mainWindow) mainWindow.webContents.send('clipboard-update', items)
  return items
})

ipcMain.handle('search-history', (_: any, payload: any) => {
    const filter: any = {}
    if (payload && payload.query) filter.search = payload.query
    if (payload && payload.type) filter.type = payload.type
    return normalizeForIPC(db.getItems(100, 0, filter))
})

ipcMain.handle('clear-history', () => {
  db.clearAll()
  return []
})

ipcMain.on('toggle-favorite', (_: any, { id, isFavorite }: any) => {
    db.setFavorite(id, isFavorite)
    if (mainWindow) mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
})

ipcMain.on('copy-to-clipboard', (_: any, text: string) => {
  lastText = text 
  clipboard.writeText(text)
})

ipcMain.on('paste-text', () => {
    if (process.platform === 'win32') {
        const pasteExe = path.join(__dirname, 'helpers', 'paste.exe')
        if (fs.existsSync(pasteExe)) {
            require('child_process').execFile(pasteExe, (err: any) => {
                if (err) log.error('Paste error:', err)
            })
        }
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
        } catch(e) {}
    }
    if (key === 'darkMode') {
        db.updateSettings({ IsDarkMode: value === 'true' })
    }
})

ipcMain.handle('remove-config', (_: any, key: string) => {
    if (key === 'session') {
        db.updateSettings({ AccessToken: null, RefreshToken: null })
    }
})

ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-system-locale', () => app.getLocale())
ipcMain.handle('get-hostname', () => os.hostname())
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
    
    return newSettings
})

ipcMain.handle('get-current-device', () => {
    // Return explicitly selected device, or fallback to the local one logic?
    // User wants: "que cuando se cierre la app y se inicie este sea el seleccionado"
    // So we check AppSettings.SelectedDeviceId first.
    
    const settings = db.getSettings()
    if (settings.selectedDeviceId) {
        // Find this device info
        const devices = db.getDevices()
        const found = devices.find((d: any) => d.Id === settings.selectedDeviceId)
        if (found) return found
    }
    
    // Fallback to default behavior (e.g. current machine or last updated)
    return db.getDevice()
})

ipcMain.handle('get-all-devices', () => {
    return db.getDevices()
})

ipcMain.handle('register-new-device', (_: any, name: string) => {
    // Note: db.registerDevice now handles duplicate checks and merging automatically
    // so we can just pass the new info. If ID is not provided, db generates one or reuses existing by name.
    
    // However, for explicit creation from UI, we might want to generate an ID if it's "new"
    // but db.registerDevice handles that too.
    
    const resId = db.registerDevice({
        Id: null, // Let DB decide (reuse or create)
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

ipcMain.handle('set-active-device', (_: any, id: string) => {
    log.info('IPC set-active-device called with:', id)
    return db.setActiveDevice(id)
})

// App Lifecycle
app.whenReady().then(async () => {
  await db.init(app)
  configureAutoLaunch()
  
  // --- Integration Start ---
  // Initialize the BackendDaemon which sets up the request handling and IPC
  BackendDaemon.getInstance();
  log.info('Backend Daemon Initialized');
  // --- Integration End ---

  const device = db.getDevice()
  let deviceId = device ? device.Id : null
  
  if (deviceId) {
      db.registerDevice({
          Id: deviceId,
          OsName: process.platform,
          Name: device.Name,
          VersionApp: app.getVersion()
      })
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
  
  const iconPath = path.join(__dirname, 'frontend', 'media', '64x64.png')
  if (fs.existsSync(iconPath)) {
      tray = new Tray(nativeImage.createFromPath(iconPath))
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Show', click: () => mainWindow.show() },
        { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
      ])
      tray.setToolTip('Copyfy Local')
      tray.setContextMenu(contextMenu)
      tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show())
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
})

app.on('window-all-closed', () => {
})

app.on('before-quit', () => {
  isQuitting = true
})

ipcMain.on('open-image-viewer', (_: any, dataUrl: string) => {
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
        createOCRWindow(`local-image://${p}`)
    } else if (dataUrl.startsWith('data:image')) {
        createOCRWindow(dataUrl)
    } else if (dataUrl.startsWith('local-image://')) {
        createOCRWindow(dataUrl)
    } else {
        createOCRWindow(`local-image://${dataUrl}`)
    }
})

ipcMain.on('open-ocr-window', (_: any, imagePath: string) => {
    createOCRWindow(imagePath)
})

ipcMain.on('open-code-editor', (_: any, content: string) => {
    createCodeWindow(content)
})
