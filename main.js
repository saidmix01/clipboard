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
const db = require('./db')
const { configureAutoLaunch } = require('./autolaunch')
const electronLog = require('electron-log')
const { exec, execFile, spawnSync } = require('child_process')

const log = {
  info: (...args) => console.log('[MAIN]', ...args),
  error: (...args) => console.error('[MAIN]', ...args),
  warn: (...args) => console.warn('[MAIN]', ...args),
  debug: () => {}
}

let mainWindow
let ocrWindow = null
let codeWindow = null
let notificationWindow = null
let pendingNotificationImage = null
let pendingCodeContent = null
let tray
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
function normalizeForIPC(items) {
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
      preload: path.join(__dirname, 'preload.js'),
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
    // Check settings to see if start minimized
    const settings = db.getSettings()
    // For now show it
    mainWindow.show()
    mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
  })

  mainWindow.on('blur', () => {
    // Optional: hide on blur
  })
}

function createOCRWindow(imagePath) {
    if (ocrWindow) {
        ocrWindow.focus()
        ocrWindow.webContents.send('ocr-load-image', imagePath)
        return
    }

    const display = screen.getPrimaryDisplay()
    const screenWidth = display.workArea.width
    const screenHeight = display.workArea.height
    // Main window is 400px wide on the right
    const mainWidth = 400
    
    // Calculate position: occupy the space to the left of the main window
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
        frame: false, // Frameless to match main app style
        transparent: true,
        backgroundColor: '#00FFFFFF', // Transparent background for rounded corners effect if needed
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
    
    // Pass image via query param to trigger OCR mode in frontend
    const url = `${indexPath}?mode=ocr&img=${encodeURIComponent(imagePath)}`

    if (app.isPackaged) {
       // Load index.html and send IPC message after ready.
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

function createCodeWindow(codeContent) {
    pendingCodeContent = codeContent // Store content

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
        show: false // Don't show until ready
    })

    const indexPath = app.isPackaged
      ? path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
      : 'http://localhost:5173'
    
    // Pass mode via query param
    const url = `${indexPath}?mode=code`

    if (app.isPackaged) {
       codeWindow.loadFile(indexPath).then(() => {
           // We wait for the handshake now
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
    
    // Use query param to set mode
    const url = `${indexPath}?mode=notification`

    if (app.isPackaged) {
       notificationWindow.loadFile(indexPath).then(() => {
           // Wait for ready signal
       })
    } else {
       notificationWindow.loadURL(url)
    }

    notificationWindow.on('closed', () => {
        notificationWindow = null
    })
}

// Handshake listener
ipcMain.on('code-window-ready', (event) => {
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

ipcMain.on('notification-action', (_, action) => {
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
    
    // Clear pending and close
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
      // Text
      const text = clipboard.readText()
      if (text && text.trim() !== '' && text !== lastText) {
        lastText = text
        db.insertItem(text, 'text')
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
        }
      }

      // Image
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        const hash = crypto.createHash('md5').update(dataUrl).digest('hex')
        if (hash !== lastImageHash) {
            lastImageHash = hash
            
            // Show notification instead of auto-save
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
ipcMain.handle('get-clipboard-history', (_, { limit = 20, offset = 0, filter = {} } = {}) => {
  return normalizeForIPC(db.getItems(limit, offset, filter))
})

ipcMain.handle('delete-history-item', (_, id) => {
  db.deleteItem(id)
  // Send update to all windows so the UI refreshes immediately
  const items = normalizeForIPC(db.getItems(100))
  if (mainWindow) mainWindow.webContents.send('clipboard-update', items)
  return items
})

ipcMain.handle('search-history', (_, payload) => {
    // payload: { query: string, type: 'text'|'image' }
    // db.getItems supports filter object
    const filter = {}
    if (payload && payload.query) filter.search = payload.query
    if (payload && payload.type) filter.type = payload.type
    
    return normalizeForIPC(db.getItems(100, 0, filter))
})

ipcMain.handle('clear-history', () => {
  db.clearAll()
  return []
})

ipcMain.on('toggle-favorite', (_, { id, isFavorite }) => {
    db.setFavorite(id, isFavorite)
    if (mainWindow) mainWindow.webContents.send('clipboard-update', normalizeForIPC(db.getItems()))
})

ipcMain.on('copy-to-clipboard', (_, text) => {
  lastText = text // Prevent re-capture
  clipboard.writeText(text)
})

ipcMain.on('paste-text', () => {
    // Windows Paste using helper
    if (process.platform === 'win32') {
        const pasteExe = path.join(__dirname, 'helpers', 'paste.exe')
        if (fs.existsSync(pasteExe)) {
            require('child_process').execFile(pasteExe, (err) => {
                if (err) log.error('Paste error:', err)
            })
        }
    } else {
        // Fallback or Linux/Mac logic
        // For now, local Windows only was implied but user might want Linux too.
        // But the immediate task is fixing the "not a function" error and making it local.
    }
})

ipcMain.on('copy-image', (_, dataUrl) => {
    // Handle local image path
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
        if (fs.existsSync(p)) {
            const img = nativeImage.createFromPath(p)
            clipboard.writeImage(img)
            // Update hash to prevent re-capture
            const hash = crypto.createHash('md5').update(img.toDataURL()).digest('hex')
            lastImageHash = hash
        }
    }
})

ipcMain.handle('get-config', (_, key) => {
    const s = db.getSettings()
    if (key === 'session') return s.accessToken ? JSON.stringify({ token: s.accessToken }) : null
    if (key === 'darkMode') return s.isDarkMode ? 'true' : 'false'
    // Map other keys if needed
    return null
})

ipcMain.handle('set-config', (_, key, value) => {
    if (key === 'session') {
        try {
            const v = JSON.parse(value)
            db.updateSettings({ AccessToken: v.token })
        } catch(e) {}
    }
    if (key === 'darkMode') {
        db.updateSettings({ IsDarkMode: value === 'true' })
    }
})

ipcMain.handle('remove-config', (_, key) => {
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
    else if (win === mainWindow) win.hide() // Main window just hides
})

ipcMain.handle('get-preferences', () => {
    const s = db.getSettings()
    // Parse shortcut for frontend if needed, or frontend handles it
    // s.globalShortcut e.g. "Alt+X"
    return s
})

ipcMain.handle('set-preferences', (_, prefs) => {
    // prefs: { shortcutModifier, shortcutKey, ... } or { globalShortcut: "Alt+X" }
    // Let's support both or unify.
    // If frontend sends partials, we might need to reconstruct.
    // But better to let frontend send what it wants.
    
    // If we receive "shortcutModifier" or "shortcutKey", we might need to compose.
    // But let's assume frontend sends "globalShortcut" if it wants to change that.
    
    // Actually, SettingsMenu.tsx sends { shortcutModifier: ... } or { shortcutKey: ... } separately.
    // We should probably adapt SettingsMenu to send the full string or handle it here.
    // Handling here requires knowing the other part.
    
    let update = {}
    if (prefs.globalShortcut) update.GlobalShortcut = prefs.globalShortcut
    
    // Handle other prefs
    if (prefs.isDarkMode !== undefined) update.IsDarkMode = prefs.isDarkMode
    if (prefs.language) update.Language = prefs.language
    if (prefs.uiScale) update.UiScale = prefs.uiScale
    if (prefs.colorPrimary) update.Theme = JSON.stringify({ ...JSON.parse(db.getSettings().theme || '{}'), primary: prefs.colorPrimary }) // Complex...
    
    // Let's just update DB with whatever matches columns
    // db.updateSettings maps keys.
    
    // Map keys from frontend (camelCase) to DB (PascalCase) where db.updateSettings expects specific keys?
    // db.updateSettings expects: IsDarkMode, Theme, Language, UiScale, AccessToken, RefreshToken, GlobalShortcut
    
    const dbUpdate = {}
    if (prefs.isDarkMode !== undefined) dbUpdate.IsDarkMode = prefs.isDarkMode
    if (prefs.language) dbUpdate.Language = prefs.language
    if (prefs.globalShortcut) dbUpdate.GlobalShortcut = prefs.globalShortcut
    
    // Special handling for colors (stored in Theme JSON?)
    // db.js schema has Theme TEXT.
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
    
    // Side effects
    if (dbUpdate.GlobalShortcut) {
        const settings = db.getSettings()
        const shortcut = settings.globalShortcut
        // We need to access registerShortcut from here... it's inside app.whenReady scope.
        // We can emit an event or move registerShortcut to outer scope.
        // Or just emit the event I created earlier: 'update-global-shortcut' (but that was ipcMain.on)
        // I can just emit to myself?
        ipcMain.emit('update-global-shortcut', null, dbUpdate.GlobalShortcut)
    }
    
    return newSettings
})

ipcMain.handle('get-current-device', () => {
    // Return registered device, but filter out 'local-device' if we want to force re-registration logic here too?
    // The frontend handles the check, so raw return is fine.
    return db.getDevice()
})

ipcMain.handle('get-all-devices', () => {
    return db.getDevices()
})

ipcMain.handle('register-new-device', (_, name) => {
    const id = crypto.randomUUID()
    db.registerDevice({
        Id: id,
        OsName: process.platform,
        Name: name,
        VersionApp: app.getVersion()
    })
    
    // Update all existing items to this device
    // "todos los items que existan y los nuevos deben quedar asociados al uuid del dispositivo creado"
    db.updateAllItemsDevice(id)
    
    return { id, name }
})

ipcMain.handle('set-active-device', (_, id) => {
    return db.setActiveDevice(id)
})

// App Lifecycle
app.whenReady().then(async () => {
  await db.init(app)
  configureAutoLaunch()
  
  // Register device locally
  const hostname = os.hostname()
  // Check if device exists, if not, create it but wait for user input?
  // User said: "si el dispositivo no existe en la tabla debe salir un modal para crearlo"
  // So we should NOT auto-register here. We should check if registered.
  
  const device = db.getDevice()
  let deviceId = device ? device.Id : null
  
  if (!deviceId) {
      // We need to prompt user.
      // We can't show prompt in main process easily without a window.
      // We will let the frontend handle this check on startup.
  } else {
      // Update existing device info
      db.registerDevice({
          Id: deviceId,
          OsName: process.platform,
          Name: device.Name, // Keep existing name
          VersionApp: app.getVersion()
      })
  }

  // Register local-image protocol
  protocol.registerFileProtocol('local-image', (request, callback) => {
    const url = request.url.replace('local-image://', '')
    try {
      // Decode URL to handle spaces and special chars
      const decodedUrl = decodeURIComponent(url)
      return callback(decodedUrl)
    } catch (error) {
      console.error('Failed to register protocol', error)
    }
  })

  createWindow()
  
  // Tray
  const iconPath = path.join(__dirname, 'frontend', 'media', '64x64.png')
  // Use a simple tray setup
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

  // Global Shortcut
  const settings = db.getSettings()
  const shortcut = settings.globalShortcut || 'Alt+X'
  
  const registerShortcut = (accelerator) => {
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

  // Listener for updates
  ipcMain.on('update-global-shortcut', (_, newShortcut) => {
      db.updateSettings({ GlobalShortcut: newShortcut })
      registerShortcut(newShortcut)
      // Notify renderer?
  })
})

app.on('window-all-closed', () => {
  // Keep active in background
})

app.on('before-quit', () => {
  isQuitting = true
})

// Handle image viewer (Keep local viewer capability)
ipcMain.on('open-image-viewer', (_, dataUrl) => {
    // Reuse this for OCR window launch as requested
    // "el modal del ocr debe abrirse en al dar clic en el ojo"
    // The eye icon calls openImageViewer in frontend
    
    // Check if it's a local path or data url
    if (dataUrl.startsWith('[LOCAL_IMAGE]:')) {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
        createOCRWindow(`local-image://${p}`)
    } else if (dataUrl.startsWith('data:image')) {
        // Pass data url directly? It might be too large for URL params
        // But for IPC send it's fine.
        createOCRWindow(dataUrl)
    } else if (dataUrl.startsWith('local-image://')) {
        createOCRWindow(dataUrl)
    } else {
        // Assume path
        createOCRWindow(`local-image://${dataUrl}`)
    }
})

ipcMain.on('open-ocr-window', (_, imagePath) => {
    createOCRWindow(imagePath)
})

ipcMain.on('open-code-editor', (_, content) => {
    createCodeWindow(content)
})
