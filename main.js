const {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  nativeImage,
  Tray,
  Menu
} = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const path = require('path')
const axios = require('axios')
const fs = require('fs')
const os = require('os')
const db = require('./db')
const legacyHistoryPath = path.join(os.homedir(), '.clipboard-history.json')
const { exec, execFile, spawnSync } = require('child_process')
const crypto = require('crypto')

let mainWindow
let quickWindow
let history = []
const childWindows = new Set()
let tray
let isQuitting = false

function uriToPath (uri) {
  let u = String(uri || '').trim()
  if (!u) return ''
  if (u.startsWith('file://')) {
    if (process.platform === 'win32') {
      u = decodeURI(u.replace(/^file:\/\/\//, ''))
      return u.replace(/\//g, '\\')
    } else {
      return decodeURI(u.replace(/^file:\/\//, ''))
    }
  }
  return u
}

function parseCFHDrop (buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 6) return []
    const pFiles = buf.readUInt32LE(0)
    const fWide = !!buf.readUInt16LE(4)
    const start = Math.min(Math.max(pFiles, 0), buf.length)
    const slice = buf.subarray(start)
    if (fWide) {
      const raw = slice.toString('utf16le')
      return raw.split('\0').map(s => String(s || '').trim()).filter(Boolean)
    } else {
      const raw = slice.toString('ascii')
      return raw.split('\0').map(s => String(s || '').trim()).filter(Boolean)
    }
  } catch {
    return []
  }
}

function readClipboardFileUris () {
  try {
    const formats = (clipboard.availableFormats() || []).map(f => String(f || '').toLowerCase())
    const out = []
    if (formats.includes('text/uri-list')) {
      const buf = clipboard.readBuffer('text/uri-list')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      for (const line of String(txt || '').split(/\r?\n/)) {
        const s = String(line || '').trim()
        if (s) out.push(s)
      }
    }
    if (formats.includes('public.file-url')) {
      const buf = clipboard.readBuffer('public.file-url')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      for (const line of String(txt || '').split(/\r?\n/)) {
        const s = String(line || '').trim()
        if (s) out.push(s)
      }
    }
    if (formats.includes('nsfilenamespboardtype')) {
      const buf = clipboard.readBuffer('NSFilenamesPboardType')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      for (const line of String(txt || '').split(/\r?\n/)) {
        const s = String(line || '').trim()
        if (s) out.push(s)
      }
    }
    {
      const bufW = clipboard.readBuffer('FileNameW')
      if (Buffer.isBuffer(bufW) && bufW.length > 0) {
        const raw = bufW.toString('utf16le')
        const parts = String(raw || '').split('\0').map(s => String(s || '').trim()).filter(Boolean)
        for (const p of parts) out.push(p)
      }
      const bufA = clipboard.readBuffer('FileName')
      if (Buffer.isBuffer(bufA) && bufA.length > 0) {
        const raw = bufA.toString('ascii')
        const parts = String(raw || '').split('\0').map(s => String(s || '').trim()).filter(Boolean)
        for (const p of parts) out.push(p)
      }
      const bufDrop = clipboard.readBuffer('CF_HDROP')
      if (Buffer.isBuffer(bufDrop) && bufDrop.length > 0) {
        const parts = parseCFHDrop(bufDrop)
        for (const p of parts) out.push(p)
      }
    }
    if (formats.includes('x-special/gnome-copied-files')) {
      const buf = clipboard.readBuffer('x-special/gnome-copied-files')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      const lines = String(txt || '').split(/\r?\n/)
      const rest = lines.filter((_, i) => i > 0)
      for (const line of rest) {
        const s = String(line || '').trim()
        if (s) out.push(s)
      }
    }
    return out
  } catch {
    return []
  }
}

function getImagePathFromClipboard () {
  try {
    const uris = readClipboardFileUris()
    const paths = uris.map(uriToPath).filter(Boolean)
    const exts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.ico'])
    for (const p of paths) {
      const ext = path.extname(p).toLowerCase()
      if (exts.has(ext) && fs.existsSync(p)) return p
    }
    return null
  } catch {
    return null
  }
}

function getImageHistoryDir () {
  const dir = path.join(app.getPath('userData'), 'clipboard-images')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readClipboardImageSmart () {
  try {
    let img = clipboard.readImage()
    if (img && !img.isEmpty()) return img
    const formats = clipboard.availableFormats() || []
    const tryFormats = ['image/png', 'PNG', 'image/jpeg', 'JFIF', 'image/webp', 'WEBP', 'image/bmp', 'BMP', 'image/tiff', 'TIFF', 'image/gif', 'GIF']
    for (const f of formats) {
      if (tryFormats.includes(f)) {
        const buf = clipboard.readBuffer(f)
        if (Buffer.isBuffer(buf) && buf.length > 0) {
          try {
            const ni = nativeImage.createFromBuffer(buf)
            if (ni && !ni.isEmpty()) return ni
          } catch {}
        }
      }
    }
    for (const f of formats) {
      const buf = clipboard.readBuffer(f)
      if (!Buffer.isBuffer(buf) || buf.length === 0) continue
      let mime = ''
      const s = String(f || '')
      if (s.startsWith('image/')) mime = s.toLowerCase()
      else if (s === 'PNG') mime = 'image/png'
      else if (s === 'JFIF') mime = 'image/jpeg'
      else if (s === 'WEBP') mime = 'image/webp'
      else if (s === 'BMP') mime = 'image/bmp'
      else if (s === 'TIFF') mime = 'image/tiff'
      else if (s === 'GIF') mime = 'image/gif'
      if (!mime) continue
      try {
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        const ni = nativeImage.createFromDataURL(dataUrl)
        if (ni && !ni.isEmpty()) return ni
      } catch {}
    }
    const html = clipboard.readHTML()
    if (typeof html === 'string' && html) {
      const m = html.match(/data:image[^"' ]+/i)
      if (m && m[0]) {
        try {
          const ni = nativeImage.createFromDataURL(m[0])
          if (ni && !ni.isEmpty()) return ni
        } catch {}
      }
    }
    const p = getImagePathFromClipboard()
    if (p) {
      const ni = nativeImage.createFromPath(p)
      if (ni && !ni.isEmpty()) return ni
    }
    if (process.platform === 'linux') {
      const sel = clipboard.readImage('selection')
      if (sel && !sel.isEmpty()) return sel
    }
    return nativeImage.createEmpty()
  } catch {
    return nativeImage.createEmpty()
  }
}

function saveClipboardImagePNG (image) {
  if (!image || image.isEmpty()) return null
  const png = image.toPNG()
  if (!png || png.length === 0) return null
  const hash = crypto.createHash('sha256').update(png).digest('hex')
  const dir = getImageHistoryDir()
  const fileName = `${Date.now()}-${hash.slice(0, 8)}.png`
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, png)
  const manifestPath = path.join(dir, 'images.json')
  let manifest = []
  try {
    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, 'utf-8')
      manifest = JSON.parse(raw)
    }
  } catch {}
  manifest.push({ file: fileName, hash, createdAt: new Date().toISOString() })
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8') } catch {}
  return filePath
}

function startClipboardImagePolling (intervalMs = 1000) {
  let lastHash = ''
  let lastFormatsSig = ''
  setInterval(() => {
    try {
      let img = readClipboardImageSmart()
      if (img && img.isEmpty()) {
        if (process.platform === 'linux') {
          const selImg = clipboard.readImage('selection')
          if (!selImg.isEmpty()) img = selImg
        }
        try {
          const fmts = (clipboard.availableFormats() || []).join('|')
          if (fmts && fmts !== lastFormatsSig) {
            lastFormatsSig = fmts
            try { log.info('Clipboard formats', { formats: fmts }) } catch {}
          }
        } catch {}
      }
      if (img && !img.isEmpty()) {
        const png = img.toPNG()
        const hash = crypto.createHash('sha256').update(png).digest('hex')
        if (hash !== lastHash) {
          const saved = saveClipboardImagePNG(img)
          lastHash = hash
        }
      }
    } catch {}
  }, Math.max(250, Number(intervalMs) || 1000))
}

function normalizeHistory (raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(item =>
    typeof item === 'string'
      ? { value: item, favorite: false }
      : { value: item.value, favorite: !!item.favorite }
  )
}

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'

// No dependemos de JSON legacy para cargar historial. Todo se gestiona con SQLite.

//Pegado de texto
function performPaste (mainWindow) {
  const platform = process.platform
  const isDev = !app.isPackaged

  // ✅ Ocultar ventana para devolver foco a la anterior app
  if (mainWindow && mainWindow.hide) mainWindow.hide()

  log.info('Plataforma', { platform })
  log.info('Entorno', { env: isDev ? 'desarrollo' : 'producción' })

  if (platform === 'win32') {
    const exePath = isDev
      ? path.join(__dirname, 'helpers', 'paste.exe')
      : path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'helpers',
          'paste.exe'
        )

    log.info('Ejecutando', { exePath })

    execFile(exePath, err => {
      if (err) {
        log.error('Error al ejecutar paste.exe', err)
      } else {
        log.info('paste.exe ejecutado correctamente')
      }
    })
  } else if (platform === 'darwin') {
    // macOS: comando AppleScript
    setTimeout(() => {
      exec(
        `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
        err => {
          if (err) log.error('Error ejecutando osascript', err)
          else log.info('Comando pegado en macOS')
        }
      )
    }, 300)
  } else if (platform === 'linux') {
    setTimeout(async () => {
      const isWayland = !!(process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY)
      const has = name => {
        try {
          const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' })
          return r && r.status === 0
        } catch {
          return false
        }
      }
      const tasks = []
      const text = clipboard.readText()
      if (isWayland && has('wtype')) {
        tasks.push(() => new Promise(resolve => {
          exec('wtype -M ctrl -k v -m ctrl', err => {
            if (err) return resolve({ ok: false, err })
            resolve({ ok: true })
          })
        }))
      }
      if (has('xdotool')) {
        tasks.push(() => new Promise(resolve => {
          exec('xdotool key ctrl+v', err => {
            if (err) return resolve({ ok: false, err })
            resolve({ ok: true })
          })
        }))
      }
      if (isWayland && has('ydotool') && typeof text === 'string' && text.trim() !== '') {
        tasks.push(() => new Promise(resolve => {
          const tmp = path.join(os.tmpdir(), `copyfy_text_${Date.now()}.txt`)
          try {
            fs.writeFileSync(tmp, text, 'utf-8')
          } catch (e) {
            return resolve({ ok: false, err: e })
          }
          exec(`ydotool type --file "${tmp}"`, err => {
            try { fs.rmSync(tmp, { force: true }) } catch {}
            if (err) return resolve({ ok: false, err })
            resolve({ ok: true })
          })
        }))
      }
      if (has('xdotool') && typeof text === 'string' && text.trim() !== '') {
        tasks.push(() => new Promise(resolve => {
          const tmp = path.join(os.tmpdir(), `copyfy_text_${Date.now()}.txt`)
          try {
            fs.writeFileSync(tmp, text, 'utf-8')
          } catch (e) {
            return resolve({ ok: false, err: e })
          }
          exec(`xdotool type --clearmodifiers --delay 1 --file "${tmp}"`, err => {
            try { fs.rmSync(tmp, { force: true }) } catch {}
            if (err) return resolve({ ok: false, err })
            resolve({ ok: true })
          })
        }))
      }
      let done = false
      for (const t of tasks) {
        const res = await t()
        if (res && res.ok) {
          log.info('Pegado/typing automático en Linux')
          done = true
          break
        }
      }
      if (!done) {
        log.error('No se pudo pegar en Linux. Instala xdotool (X11) o wtype/ydotool (Wayland).')
        try {
          if (mainWindow?.webContents) {
            mainWindow.webContents.send('paste-status', { ok: false, message: 'No se pudo pegar en Linux. Instala xdotool (X11) o wtype/ydotool (Wayland).' })
          }
        } catch {}
      }
    }, 300)
  } else {
    log.warn('Plataforma no compatible')
}
}
//Pegado de imagen
function performPasteImage (mainWindow) {
  const platform = process.platform
  const isDev = !app.isPackaged

  // ✅ Ocultar ventana para devolver foco a la anterior app
  if (mainWindow && mainWindow.hide) mainWindow.hide()

  log.info('Plataforma', { platform })
  log.info('Entorno', { env: isDev ? 'desarrollo' : 'producción' })

  if (platform === 'win32') {
    const exePath = isDev
      ? path.join(__dirname, 'helpers', 'paste-image.exe')
      : path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'helpers',
          'paste-image.exe'
        )

    log.info('Ejecutando', { exePath })

    execFile(exePath, err => {
      if (err) {
        log.error('Error al ejecutar paste-image.exe', err)
      } else {
        log.info('paste-image.exe ejecutado correctamente')
      }
    })
  } else if (platform === 'darwin') {
    // macOS: comando AppleScript (Ctrl+V para imágenes también)
    setTimeout(() => {
      exec(
        `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
        err => {
          if (err) log.error('Error ejecutando osascript (imagen)', err)
          else log.info('Imagen pegada en macOS')
        }
      )
    }, 300)
  } else if (platform === 'linux') {
    setTimeout(() => {
      const isWayland = !!(process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY)
      const has = name => {
        try {
          const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' })
          return r && r.status === 0
        } catch {
          return false
        }
      }
      const cmds = []
      if (isWayland && has('wtype')) cmds.push('wtype -M ctrl -k v -m ctrl')
      if (has('xdotool')) cmds.push('xdotool key ctrl+v')
      const run = () => {
        const cmd = cmds.shift()
        if (!cmd) {
          log.error('Error pegando imagen en Linux. Instala xdotool (X11) o wtype (Wayland).')
          try {
            if (mainWindow?.webContents) {
              mainWindow.webContents.send('paste-status', { ok: false, message: 'No se pudo pegar imagen en Linux. Instala xdotool (X11) o wtype (Wayland).' })
            }
          } catch {}
          return
        }
        exec(cmd, err => {
          if (err) {
            if (cmds.length) return run()
            log.error('Error pegando imagen en Linux', err)
          } else {
            log.info('Imagen pegada en Linux')
          }
        })
      }
      run()
    }, 300)
  } else {
    log.warn('Plataforma no compatible para pegar imagen')
}
}

function createWindow () {
  const display = screen.getPrimaryDisplay()
  const screenWidth = display.workArea.width
  const screenHeight = display.workArea.height
  const windowWidth = 400
  const windowHeight = screenHeight
  const finalX = screenWidth - windowWidth
  const startX = screenWidth // Inicia fuera de la pantalla

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: startX,
    y: 0,
    frame: false,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    alwaysOnTop: true,
    resizable: false, // ✅ importante: no redimensionable
    icon: path.join(__dirname, 'public', 'icon.ico'),
    show: false,
    hasShadow: true, // ✅ sombra opcional
    title: '',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false // ✅ este debe ser false si usas contextBridge
    }
  })

  // Cargar interfaz
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }

  // Enviar historial al frontend
  mainWindow.webContents.on('did-finish-load', () => {
    try {
      history = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
    } catch {
      history = []
    }
    mainWindow.webContents.send('clipboard-update', history)
  })

  // Mostrar con animación
  mainWindow.once('ready-to-show', () => {
    mainWindow.setTitle('')
    mainWindow.show()

    const duration = 300 // ms
    const steps = 30
    const stepTime = duration / steps
    const deltaX = (startX - finalX) / steps

    let currentX = startX
    const interval = setInterval(() => {
      currentX -= deltaX
      if (currentX <= finalX) {
        currentX = finalX
        clearInterval(interval)
      }
      mainWindow.setBounds({
        x: Math.round(currentX),
        y: 0,
        width: windowWidth,
        height: windowHeight
      })
    }, stepTime)
    setTimeout(() => {
      try { mainWindow.focus() } catch {}
      try { mainWindow.webContents.focus() } catch {}
      try { mainWindow.webContents.send('focus-search') } catch {}
    }, 150)
  })

  // Evitar cierre completo
  mainWindow.on('close', event => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      try { childWindows.forEach(w => { try { w.close() } catch {} }) } catch {}
    }
  })

  mainWindow.on('minimize', event => {
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('show', () => {
    setTimeout(() => {
      try { mainWindow.focus() } catch {}
      try { mainWindow.webContents.focus() } catch {}
      try { mainWindow.webContents.send('focus-search') } catch {}
    }, 120)
  })
}

app.whenReady().then(async () => {
  try { require('./autolaunch').configureAutoLaunch() } catch (e) { log.error('Autolaunch setup failed', e) }
  await db.init(app)
  createWindow()
  const iconPath = path.join(
    __dirname,
    'public',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  )
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image)
  tray.setToolTip('Copyfy++')
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } },
    { label: 'Pegar texto', click: () => { performPaste(mainWindow) } },
    { label: 'Pegar imagen', click: () => { performPasteImage(mainWindow) } },
    { type: 'separator' },
    { label: 'Salir', click: () => { isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      setTimeout(() => {
        try { mainWindow.focus() } catch {}
        try { mainWindow.webContents.focus() } catch {}
        try { mainWindow.webContents.send('focus-search') } catch {}
      }, 120)
    }
  })
  if (process.platform === 'darwin' && app.dock && app.dock.hide) {
    app.dock.hide()
  }
  autoUpdater.forceDevUpdateConfig = true
  try {
    const cfg = readDeviceConfigObj()
    if (Array.isArray(cfg.history)) {
      db.importItems(getCurrentDeviceName(), normalizeHistory(cfg.history))
      history = db.getAll(getCurrentDeviceName())
      log.info('Historial (device) cargado', { count: history.length })
    } else if (fs.existsSync(legacyHistoryPath)) {
      const data = fs.readFileSync(legacyHistoryPath, 'utf-8')
      const parsed = JSON.parse(data)
      const items = normalizeHistory(parsed)
      db.importItems(getCurrentDeviceName(), items)
      cfg.history = []
      writeDeviceConfigObj(cfg)
      history = db.getAll(getCurrentDeviceName())
      log.info('Historial migrado desde legacy')
    }
  } catch (err) {
    log.error('Error al leer historial (device)', err)
  }
  try { if (!authToken) { db.trimGuestToLimit(getCurrentDeviceName(), 50); history = db.getAllGuest(getCurrentDeviceName()) } } catch {}

  const pollClipboard = () => {
    let lastImageDataUrl = ''
    let lastText = ''

    // Normalizar historial ya cargado y enviar al renderer inmediatamente
    try {
      history = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
    } catch {
      history = []
    }

    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }

    setInterval(() => {
      try {
        const currentImage = clipboard.readImage()
        if (currentImage.isEmpty()) {
          const imgPath = getImagePathFromClipboard()
          if (imgPath) {
            const ni = nativeImage.createFromPath(imgPath)
            if (!ni.isEmpty()) {
              clipboard.writeImage(ni)
              try { saveClipboardImagePNG(ni) } catch {}
              const dataUrl = ni.toDataURL()
              if (
                typeof dataUrl === 'string' &&
                dataUrl.startsWith('data:image') &&
                dataUrl.trim().length > 30 &&
                dataUrl !== lastImageDataUrl
              ) {
                lastImageDataUrl = dataUrl
                if (authToken) {
          db.insert(getCurrentDeviceName(), dataUrl)
          history = db.getAll(getCurrentDeviceName())
          saveClipboardRecord('image', dataUrl, { format: 'dataURL' })
            .then(rid => { if(rid) db.updateRemoteIdByValue(getCurrentDeviceName(), dataUrl, rid) })
            .catch(err => log.error('Immediate save error (image path)', err))
        } else {
                  db.insertGuest(getCurrentDeviceName(), dataUrl)
                  db.trimGuestToLimit(getCurrentDeviceName(), 50)
                  history = db.getAllGuest(getCurrentDeviceName())
                }
                if (mainWindow?.webContents) {
                  mainWindow.webContents.send('clipboard-update', history)
                }
              }
            }
          }
        }
      } catch {}
      const image = readClipboardImageSmart()
      if (image.isEmpty() && process.platform === 'linux') {
        const selImg = clipboard.readImage('selection')
        if (!selImg.isEmpty()) {
          const dataUrl = selImg.toDataURL()
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image') && dataUrl.trim().length > 30) {
            try { saveClipboardImagePNG(selImg) } catch {}
            lastImageDataUrl = dataUrl
            if (authToken) {
              db.insert(getCurrentDeviceName(), dataUrl)
              history = db.getAll(getCurrentDeviceName())
              saveClipboardRecord('image', dataUrl, { format: 'dataURL' })
                .then(rid => { if(rid) db.updateRemoteIdByValue(getCurrentDeviceName(), dataUrl, rid) })
                .catch(err => log.error('Immediate save error (linux sel)', err))
            } else {
              db.insertGuest(getCurrentDeviceName(), dataUrl)
              db.trimGuestToLimit(getCurrentDeviceName(), 50)
              history = db.getAllGuest(getCurrentDeviceName())
            }
            if (mainWindow?.webContents) {
              mainWindow.webContents.send('clipboard-update', history)
            }
            return
          }
        }
      }
      const text = clipboard.readText()

      // --- Si hay nueva imagen ---
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()

        // Protección contra datos vacíos o inválidos
        if (
          typeof dataUrl !== 'string' ||
          !dataUrl.startsWith('data:image') ||
          dataUrl === 'data:image/png;base64,' || // imagen vacía común
          dataUrl.trim().length < 30 || // corta, posiblemente vacía
          dataUrl === lastImageDataUrl // repetida
        ) {
          return
        }

        lastImageDataUrl = dataUrl
        try {
          const savedPath = saveClipboardImagePNG(image)
          if (savedPath) { try { log.info('Imagen guardada', { savedPath }) } catch {} }
        } catch {}
        if (authToken) {
          db.insert(getCurrentDeviceName(), dataUrl)
          history = db.getAll(getCurrentDeviceName())
          saveClipboardRecord('image', dataUrl, { format: 'dataURL' }).catch(err => log.error('Immediate save error (image)', err))
        } else {
          db.insertGuest(getCurrentDeviceName(), dataUrl)
          db.trimGuestToLimit(getCurrentDeviceName(), 50)
          history = db.getAllGuest(getCurrentDeviceName())
        }
        mainWindow.webContents.send('clipboard-update', history)
        return
      }

      // --- Si hay nuevo texto ---
      if (
        typeof text === 'string' &&
        text.trim() !== '' &&
        text !== lastText
      ) {
        lastText = text
        if (authToken) {
          db.insert(getCurrentDeviceName(), text)
          history = db.getAll(getCurrentDeviceName())
          saveClipboardRecord('text', text).catch(err => log.error('Immediate save error (text)', err))
        } else {
          db.insertGuest(getCurrentDeviceName(), text)
          db.trimGuestToLimit(getCurrentDeviceName(), 50)
          history = db.getAllGuest(getCurrentDeviceName())
        }
        mainWindow.webContents.send('clipboard-update', history)
      }
    }, 1000)
  }

  pollClipboard()
  startClipboardImagePolling(1000)
  if (app.isPackaged) {
    try { mainWindow.webContents.send('update-status', 'Comprobando actualizaciones al iniciar...') } catch {}
    setTimeout(() => {
      try {
        Promise.resolve(autoUpdater.checkForUpdates()).catch(err => {
          try { log.error('checkForUpdates startup error', err?.message || err) } catch {}
        })
      } catch (e) {
        try { log.error('autoUpdater startup error', e?.message || e) } catch {}
      }
    }, 3000)
  } else {
    try { mainWindow.webContents.send('update-status', 'Entorno de desarrollo: se omite la comprobación automática.') } catch {}
  }

  const toggleShow = () => {
    if (!mainWindow) {
      createWindow()
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide()
      return
    }
    const display = screen.getPrimaryDisplay()
    const screenWidth = display.workArea.width
    const screenHeight = display.workArea.height
    const windowWidth = 400
    const windowHeight = screenHeight
    const x = screenWidth - windowWidth
    const y = 0
    mainWindow.setBounds({ x, y, width: windowWidth, height: windowHeight })
    mainWindow.show()
    setTimeout(() => {
      try { mainWindow.focus() } catch {}
      try { mainWindow.webContents.focus() } catch {}
      try { mainWindow.webContents.send('focus-search') } catch {}
    }, 120)
  }

  globalShortcut.register('Alt+X', toggleShow)
  if (process.platform === 'darwin') {
    globalShortcut.register('Command+Option+X', toggleShow)
  }

  // Quick switcher desactivado

  // Quick switcher desactivado

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
})

app.on('before-quit', () => {
  isQuitting = true
  try { childWindows.forEach(w => { try { w.destroy() } catch {} }) } catch {}
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch {}
})

// Quick switcher desactivado

ipcMain.on('set-search-query', (_, q) => {
  try {
    const s = typeof q === 'string' ? q : ''
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('set-search-query', s)
      try {
        const qTrim = String(s || '').trim()
        let items = []
        if (qTrim.length === 0) {
          if (!authToken) {
            items = db.getRecentGuest(getCurrentDeviceName(), 'all', 50)
          } else {
            items = db.getRecent(getCurrentDeviceName(), 'all', 50)
          }
        } else {
          if (!authToken) {
            items = db.searchGuest(getCurrentDeviceName(), qTrim, 'all')
          } else {
            items = db.search(getCurrentDeviceName(), qTrim, 'all')
          }
        }
        mainWindow.webContents.send('apply-search', { query: s, items })
      } catch (e) {
        try { log.error('apply-search error', e?.message || e) } catch {}
      }
    }
  } catch (e) {
    try { log.error('set-search-query main error', e?.message || e) } catch {}
  }
})



// Evento para forzar la actualización desde el frontend
ipcMain.on('force-update', () => {
  log.info('🧪 Botón forzó búsqueda de actualización...')
  if (!app.isPackaged) {
    try { mainWindow.webContents.send('update-status', 'Solo disponible en producción.') } catch {}
    return
  }
  Promise.resolve(autoUpdater.checkForUpdates()).catch(err => {
    try { log.error('checkForUpdates error', err?.message || err) } catch {}
  })
})

// Eventos para debug y actualizaciones
autoUpdater.on('checking-for-update', () => {
  log.info('🔍 Buscando actualizaciones...')
  mainWindow.webContents.send('update-status', 'Buscando actualizaciones...')
})

autoUpdater.on('update-available', info => {
  log.info('🟠 Actualización disponible:', info)
  mainWindow.webContents.send(
    'update-status',
    'Actualización disponible, descargando...'
  )
})

autoUpdater.on('update-not-available', () => {
  log.info('✅ No hay actualizaciones.')
  mainWindow.webContents.send('update-status', 'Ya tienes la última versión.')
})

autoUpdater.on('error', err => {
  log.error('❌ Error en autoUpdater:', err)
  mainWindow.webContents.send(
    'update-status',
    'Error al buscar actualizaciones.'
  )
})

autoUpdater.on('update-downloaded', () => {
  log.info('✅ Update descargada, reiniciando...')
  mainWindow.webContents.send(
    'update-status',
    'Actualización descargada. Reiniciando...'
  )
  setTimeout(() => autoUpdater.quitAndInstall(), 2000)
})

ipcMain.handle('get-clipboard-history', async () => {
  try {}
  catch {}
  return authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
})

ipcMain.handle('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide()
  }
  try { childWindows.forEach(w => { try { w.close() } catch {} }) } catch {}
})

ipcMain.on('copy-to-clipboard', (_, text) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
})
//limpiar historial
ipcMain.handle('clear-history', () => {
  history = []

  try {
    if (authToken) db.clear(getCurrentDeviceName())
    else db.clearGuest(getCurrentDeviceName())
    mainWindow.webContents.send('clipboard-update', history)
    log.info('Historial borrado')
  } catch (err) {
    log.error('Error al borrar historial', err)
  }
})

// Borrar item especifico
ipcMain.handle('delete-history-item', async (_, id) => {
  try {
    const item = db.getById(id)
    log.info('Solicitud de borrado:', { id, found: !!item, hasAuth: !!authToken })
    
    if (authToken && item) {
       try {
          const axiosInstance = getAxiosInstance()
          const clientId = activeDeviceName || os.hostname()
          const payload = { clientId, value: item.value }
          
          log.info('Enviando POST al backend (by-value):', { url: '/clipboard/by-value', payload })
          await axiosInstance.post('/clipboard/by-value', payload, {
            headers: { 'Content-Type': 'application/json' }
          })
          
          log.info('Borrado del backend exitoso')
        } catch (e) {
         log.error('Error borrando del backend', e?.message || e)
       }
    } else {
      if (!authToken) log.info('No se borra del backend: No hay token')
      else if (!item) log.info('No se borra del backend: Item no encontrado localmente')
    }
    
    db.deleteById(id)
    history = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
    mainWindow.webContents.send('clipboard-update', history)
    log.info('Item borrado localmente:', id)
    return { success: true }
  } catch (err) {
    log.error('Error al borrar item', err)
    return { success: false, error: err.message }
  }
})

//copiar imagen
ipcMain.on('copy-image', (_, dataUrl) => {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    log.info('Imagen copiada al portapapeles')
  } catch (err) {
    log.error('Error al copiar imagen', err)
  }
})
ipcMain.on('viewer-minimize', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.minimize()
})
ipcMain.on('open-image-viewer', (_, dataUrl) => {
  try {
    if (!authToken) return
    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      resizable: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00FFFFFF',
      hasShadow: true,
      show: true,
      parent: mainWindow,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    })
    try { childWindows.add(win); win.on('closed', () => { try { childWindows.delete(win) } catch {} }) } catch {}
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const mainBounds = mainWindow?.getBounds() || { width: 400, x: wa.x + wa.width - 400, y: wa.y, height: wa.height }
    const viewerWidth = Math.max(300, wa.width - mainBounds.width)
    win.setBounds({ x: wa.x, y: wa.y, width: viewerWidth, height: wa.height })
    const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh;color:#ddd;font-family:system-ui}#wrap{position:relative;cursor:crosshair}#img{max-width:95vw;max-height:95vh;border-radius:6px;user-select:none;cursor:crosshair}#sel{position:absolute;border:2px solid #00aaff;background:rgba(0,170,255,0.2);display:none;pointer-events:none}#panel{position:fixed;top:10px;left:10px;background:#222;border:1px solid #333;border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center}button{background:#333;border:1px solid #444;color:#eee;padding:6px 10px;border-radius:4px;cursor:pointer}button:disabled{opacity:.6;cursor:not-allowed}#res{position:fixed;bottom:10px;left:10px;right:10px;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px;max-height:40vh;overflow:auto;white-space:pre-wrap}</style></head><body><div id="panel"><button id="ocr" disabled>OCR selección</button><button id="copy" disabled>Copiar</button><span id="status"></span></div><div id="wrap"><img id="img" src="${dataUrl}"/><div id="sel"></div></div><div id="res" style="display:none"></div><script src="https://unpkg.com/tesseract.js@v4.0.3/dist/tesseract.min.js"></script><script>const img=document.getElementById('img');const sel=document.getElementById('sel');const ocrBtn=document.getElementById('ocr');const copyBtn=document.getElementById('copy');const statusEl=document.getElementById('status');const resEl=document.getElementById('res');let start=null;let rect=null;function px(n){return Math.round(n)+'px'}function setStatus(t){statusEl.textContent=t}function resetSel(){sel.style.display='none';ocrBtn.disabled=true;copyBtn.disabled=true;resEl.style.display='none';resEl.textContent='';rect=null}function within(e){const r=img.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom}window.addEventListener('mousedown',e=>{if(!within(e))return;const r=img.getBoundingClientRect();start={x:e.clientX,y:e.clientY};sel.style.display='block';sel.style.left=px(start.x);sel.style.top=px(start.y);sel.style.width='0px';sel.style.height='0px';setStatus('Seleccionando...')});window.addEventListener('mousemove',e=>{if(!start)return;const x=Math.min(e.clientX,start.x);const y=Math.min(e.clientY,start.y);const w=Math.abs(e.clientX-start.x);const h=Math.abs(e.clientY-start.y);sel.style.left=px(x);sel.style.top=px(y);sel.style.width=px(w);sel.style.height=px(h)});window.addEventListener('mouseup',e=>{if(!start)return;const r=img.getBoundingClientRect();const x=Math.min(e.clientX,start.x);const y=Math.min(e.clientY,start.y);const w=Math.abs(e.clientX-start.x);const h=Math.abs(e.clientY-start.y);start=null;if(w<5||h<5){resetSel();setStatus('');return}rect={x:x-r.left,y:y-r.top,w:w,h:h};ocrBtn.disabled=false;copyBtn.disabled=true;setStatus('Selección lista')});async function cropToCanvas(){const dispW=img.clientWidth;const dispH=img.clientHeight;const natW=img.naturalWidth;const natH=img.naturalHeight;const scaleX=natW/dispW;const scaleY=natH/dispH;const sx=Math.max(0,Math.round(rect.x*scaleX));const sy=Math.max(0,Math.round(rect.y*scaleY));const sw=Math.min(natW-sx,Math.round(rect.w*scaleX));const sh=Math.min(natH-sy,Math.round(rect.h*scaleY));const c=document.createElement('canvas');c.width=sw;c.height=sh;const ctx=c.getContext('2d');ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);return c}async function runOCR(){try{setStatus('Procesando...');const c=await cropToCanvas();const r=await Tesseract.recognize(c,'spa',{logger:m=>{}});resEl.style.display='block';resEl.textContent=r.data.text||'';copyBtn.disabled=!resEl.textContent.trim();setStatus('Listo')}catch(err){resEl.style.display='block';resEl.textContent='Error: '+(err&&err.message||'');copyBtn.disabled=true;setStatus('')}}ocrBtn.addEventListener('click',()=>{if(!rect)return;runOCR()});copyBtn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(resEl.textContent||'');setStatus('Copiado')}catch(e){setStatus('No se pudo copiar')}});img.addEventListener('load',()=>{resetSel();setStatus('')});</script></body></html>`
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    win.webContents.on('did-finish-load', () => {
      const __no = null
      const inj = `(()=>{const { clipboard } = require('electron');const img=document.getElementById('img');const wrap=document.getElementById('wrap');const sel=document.getElementById('sel');const statusEl=document.getElementById('status');const resEl=document.getElementById('res');let startClient=null;let startWrap=null;let rect=null;let processing=false;function px(n){return Math.round(n)+'px'}function setStatus(t){statusEl.textContent=t}function resetSel(){sel.style.display='none';resEl.style.display='none';resEl.textContent='';rect=null}function within(e){const r=img.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom}function clampToImg(x,y){const imgR=img.getBoundingClientRect();const wrapR=wrap.getBoundingClientRect();const minX=imgR.left-wrapR.left;const minY=imgR.top-wrapR.top;const maxX=minX+img.clientWidth;const maxY=minY+img.clientHeight;return{cx:Math.max(minX,Math.min(maxX,x)),cy:Math.max(minY,Math.min(maxY,y))}}const overlay=(()=>{const o=document.createElement('div');o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999';const box=document.createElement('div');box.style.cssText='display:flex;flex-direction:column;align-items:center;gap:10px';const spinner=document.createElement('div');spinner.style.cssText='border:4px solid #555;border-top:4px solid #0af;border-radius:50%;width:42px;height:42px;animation:spin 1s linear infinite';const text=document.createElement('div');text.id='loadingText';text.style.cssText='color:#eee;font-family:system-ui';const style=document.createElement('style');style.textContent='@keyframes spin{to{transform:rotate(360deg)}}';document.head.appendChild(style);box.appendChild(spinner);box.appendChild(text);o.appendChild(box);document.body.appendChild(o);return{show:(t)=>{text.textContent=t;o.style.display='flex'},hide:()=>{o.style.display='none'}}})();document.addEventListener('mousedown',e=>{if(!within(e))return;const wrapR=wrap.getBoundingClientRect();startClient={x:e.clientX,y:e.clientY};const relX=e.clientX-wrapR.left;const relY=e.clientY-wrapR.top;const cl=clampToImg(relX,relY);startWrap={x:cl.cx,y:cl.cy};sel.style.display='block';sel.style.left=px(startWrap.x);sel.style.top=px(startWrap.y);sel.style.width='0px';sel.style.height='0px';setStatus('Seleccionando...');e.stopPropagation();e.preventDefault()},{capture:true});document.addEventListener('mousemove',e=>{if(!startWrap)return;const wrapR=wrap.getBoundingClientRect();const relX=e.clientX-wrapR.left;const relY=e.clientY-wrapR.top;const cl=clampToImg(relX,relY);const x=Math.min(cl.cx,startWrap.x);const y=Math.min(cl.cy,startWrap.y);const w=Math.abs(cl.cx-startWrap.x);const h=Math.abs(cl.cy-startWrap.y);sel.style.left=px(x);sel.style.top=px(y);sel.style.width=px(w);sel.style.height=px(h);e.stopPropagation();e.preventDefault()},{capture:true});async function cropToCanvas(){const dispW=img.clientWidth;const dispH=img.clientHeight;const natW=img.naturalWidth;const natH=img.naturalHeight;const scaleX=natW/dispW;const scaleY=natH/dispH;const sx=Math.max(0,Math.round(rect.x*scaleX));const sy=Math.max(0,Math.round(rect.y*scaleY));const sw=Math.min(natW-sx,Math.round(rect.w*scaleX));const sh=Math.min(natH-sy,Math.round(rect.h*scaleY));const c=document.createElement('canvas');c.width=sw;c.height=sh;const ctx=c.getContext('2d');ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);return c}async function runOCR(){if(!rect||processing)return;try{processing=true;overlay.show('Procesando OCR...');setStatus('Procesando...');const c=await cropToCanvas();const r=await Tesseract.recognize(c,'spa',{logger:()=>{}});const text=(r&&r.data&&r.data.text)?r.data.text:'';resEl.style.display='block';resEl.textContent=text;overlay.show('Copiando...');try{clipboard.writeText(text||'');setStatus('Copiado')}catch(e){setStatus('No se pudo copiar')}}catch(err){resEl.style.display='block';resEl.textContent='Error: '+(err&&err.message||'');setStatus('')}finally{processing=false;overlay.hide()}}document.addEventListener('mouseup',e=>{if(!startClient||!startWrap)return;const imgR=img.getBoundingClientRect();const xClient=Math.min(e.clientX,startClient.x);const yClient=Math.min(e.clientY,startClient.y);const wClient=Math.abs(e.clientX-startClient.x);const hClient=Math.abs(e.clientY-startClient.y);startClient=null;startWrap=null;if(wClient<5||hClient<5){resetSel();setStatus('');return}rect={x:xClient-imgR.left,y:yClient-imgR.top,w:wClient,h:hClient};setStatus('Seleccion lista');e.stopPropagation();e.preventDefault();runOCR()},{capture:true});img.addEventListener('load',()=>{resetSel();setStatus('')})})()`
      win.webContents.executeJavaScript(inj)
      const ui = `(()=>{const { ipcRenderer }=require('electron');document.body.style.background='transparent';const style=document.createElement('style');style.textContent=`+
      "'"+
      `#window{position:fixed;inset:0;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(45,45,45,.7);backdrop-filter:blur(10px);box-shadow:0 8px 24px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}#header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.15);-webkit-app-region:drag;color:#eee}#title{font-size:14px;margin:0}#controls{display:flex;gap:8px;-webkit-app-region:no-drag}#controls button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#3a3a3a;border:1px solid #4a4a4a;color:#eee;border-radius:6px;cursor:pointer}#controls #close{background:#d32f2f;border-color:#b71c1c;color:#fff}`+
      "'"+
      `;document.head.appendChild(style);const winEl=document.createElement('div');winEl.id='window';const header=document.createElement('div');header.id='header';const title=document.createElement('h5');title.id='title';title.textContent='📋 Copyfy++';const controls=document.createElement('div');controls.id='controls';const btnClose=document.createElement('button');btnClose.id='close';btnClose.textContent='✕';btnClose.addEventListener('click',()=>window.close());controls.appendChild(btnClose);header.appendChild(title);header.appendChild(controls);const content=document.createElement('div');content.id='content';content.style.cssText='flex:1;position:relative;display:flex;align-items:center;justify-content:center';while(document.body.firstChild){content.appendChild(document.body.firstChild)}winEl.appendChild(header);winEl.appendChild(content);document.body.appendChild(winEl);document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){window.close()}});})();`
      win.webContents.executeJavaScript(ui)
    })
  } catch (err) {
    log.error('Error abriendo visor de imagen', err)
  }
})
ipcMain.on('open-code-editor', (_, codeText) => {
  try {
    if (!authToken) return
    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      resizable: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00FFFFFF',
      hasShadow: true,
      show: true,
      parent: mainWindow,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    })
    try { childWindows.add(win); win.on('closed', () => { try { childWindows.delete(win) } catch {} }) } catch {}
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const mainBounds = mainWindow?.getBounds() || { width: 400, x: wa.x + wa.width - 400, y: wa.y, height: wa.height }
    const viewerWidth = Math.max(300, wa.width - mainBounds.width)
    win.setBounds({ x: wa.x, y: wa.y, width: viewerWidth, height: wa.height })
    win.loadFile(path.join(__dirname, 'viewer', 'code-editor.html'))
    win.webContents.on('did-finish-load', () => {
      try {
        const b64 = Buffer.from(String(codeText || ''), 'utf-8').toString('base64')
        win.webContents.send('set-content', b64)
      } catch {}
    })
  } catch (err) {
    log.error('Error abriendo editor de código', err)
  }
})
//Traducir texto
ipcMain.handle('translate-to-english', async (_, text) => {
  try {
    const params = new URLSearchParams()
    params.append('text', text)
    params.append('source_lang', 'ES')
    params.append('target_lang', 'EN')

    const response = await axios.post(
      'https://api-free.deepl.com/v2/translate',
      params,
      {
        headers: {
          Authorization:
            'DeepL-Auth-Key 51c9648c-92ca-47d5-9e3f-7382148e6089:fx', // Reemplaza con tu clave real
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    )

    return response.data.translations[0].text
  } catch (error) {
    console.error('Error en traducción:', error.response?.data || error.message)
    return 'Error de traducción'
  }
})
// Cuando se recibe el evento desde el renderer
ipcMain.on('paste-text', () => {
  performPaste(mainWindow)
})

// Escuchar favorito
ipcMain.on('toggle-favorite', async (event, payload) => {
  try {
    if (!authToken) return
    const current = readDeviceHistory()
    if (!Array.isArray(current)) return

    const value = (typeof payload === 'string') ? payload : (payload && payload.value)
    const id = (payload && typeof payload === 'object') ? payload.id : undefined
    let newFavorite = false
    const updated = current.map(item => {
      if (typeof item === 'object' && item.value === value) {
        const fav = !item.favorite
        newFavorite = fav
        return { ...item, favorite: fav }
      }
      return item
    })
    db.setFavorite(getCurrentDeviceName(), value, newFavorite)

    // También actualizamos la variable en memoria
    history = db.getAll(getCurrentDeviceName())

    // Enviar al frontend
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }

    console.log('⭐ Favorito actualizado:', value)

    if (authToken && id) {
      try {
        await updateClipboardRecord(id, { favorite: !!newFavorite })
      } catch {}
    }
  } catch (err) {
    console.error('❌ Error actualizando favoritos:', err)
  }
})

ipcMain.handle('pasteImage', () => {
  performPasteImage(mainWindow)
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})
let BACKEND_URL = 'https://copyfy.webcolsoluciones.com.co'
//let BACKEND_URL = 'http://localhost:3000'
try { BACKEND_URL = require('./config').BACKEND_URL || BACKEND_URL } catch {}
let authToken = null
let deviceId = null
let activeDeviceName = null
let syncLock = false
let favoritesSyncCooldownUntil = 0

function getCurrentDeviceName () {
  return sanitizeDeviceName(activeDeviceName || os.hostname())
}

function getCurrentDeviceConfigPath () {
  const baseDir = path.join(app.getPath('userData'), 'devices')
  const selected = activeDeviceName ? sanitizeDeviceName(activeDeviceName) : sanitizeDeviceName(os.hostname())
  const deviceDir = path.join(baseDir, selected)
  if (!fs.existsSync(deviceDir)) fs.mkdirSync(deviceDir, { recursive: true })
  return path.join(deviceDir, 'config.json')
}

function readDeviceConfigObj () {
  const cfgPath = getCurrentDeviceConfigPath()
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf-8')
      const obj = JSON.parse(raw)
      if (!obj.deviceName) obj.deviceName = os.hostname()
      if (!obj.preferences) obj.preferences = {}
      if (!obj.version) obj.version = 1
      if (!Array.isArray(obj.history)) obj.history = []
      return obj
    } else {
      const obj = {
        deviceName: os.hostname(),
        createdAt: new Date().toISOString(),
        preferences: {},
        version: 1,
        history: []
      }
      fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2), 'utf-8')
      return obj
    }
  } catch {
    return {
      deviceName: os.hostname(),
      createdAt: new Date().toISOString(),
      preferences: {},
      version: 1,
      history: []
    }
  }
}

function writeDeviceConfigObj (obj) {
  const cfgPath = getCurrentDeviceConfigPath()
  fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2), 'utf-8')
}

function readDeviceHistory () {
  try {
    return db.getAll(getCurrentDeviceName())
  } catch {
    return []
  }
}

function writeDeviceHistory (hist) {
  try {
    db.importItems(getCurrentDeviceName(), normalizeHistory(hist))
  } catch (err) {
    log.error('Error al guardar historial (device)', err)
  }
}

function getDeviceConfigPathByName (rawName) {
  const baseDir = path.join(app.getPath('userData'), 'devices')
  const dirName = sanitizeDeviceName(rawName)
  const deviceDir = path.join(baseDir, dirName)
  return path.join(deviceDir, 'config.json')
}

function listLocalDevices () {
  try {
    const baseDir = path.join(app.getPath('userData'), 'devices')
    if (!fs.existsSync(baseDir)) return []
    const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
    return dirs.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }
}

function readDeviceHistoryByName (rawName) {
  try {
    const name = sanitizeDeviceName(rawName)
    const all = db.getAll(name)
    return normalizeHistory(all)
  } catch {
    return []
  }
}

async function getDevicesFromBackend () {
  try {
    const axiosInstance = getAxiosInstance()
    try {
      const res = await axiosInstance.get('/devices')
      const data = res?.data
      const container = (data && typeof data === 'object' ? (data.data ?? data) : {})
      const list = Array.isArray(container) ? container : (Array.isArray(container.items) ? container.items : [])
      const names = Array.isArray(list)
        ? list
            .map(p => {
              if (typeof p === 'string') return p
              const obj = p || {}
              return String(obj.clientId || obj.name || '')
            })
            .filter(Boolean)
        : []
      if (names.length > 0) return names
    } catch {}

    const res2 = await axiosInstance.get('/users/me')
    const data2 = res2?.data
    const payload = (data2 && typeof data2 === 'object' ? (data2.data ?? data2) : {})
    const user = payload?.user || payload
    const devices = user?.devices || []
    const names2 = Array.isArray(devices)
      ? devices
          .map(p => {
            if (typeof p === 'string') return p
            const obj = p || {}
            return obj.name || obj.clientId || ''
          })
          .filter(Boolean)
      : []
    return names2
  } catch (error) {
    log.error('getDevicesFromBackend error', error?.message || error)
    return []
  }
}

function sanitizeDeviceName (name) {
  const s = String(name || '').trim()
  return s.replace(/[<>:"/\\|?*]/g, '').slice(0, 64) || 'device'
}

async function ensureLocalDevices () {
  try {
    const names = await getDevicesFromBackend()
    const baseDir = path.join(app.getPath('userData'), 'devices')
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true })

    for (const raw of names) {
      const dirName = sanitizeDeviceName(raw)
      const deviceDir = path.join(baseDir, dirName)
      const cfgPath = path.join(deviceDir, 'config.json')
      if (!fs.existsSync(deviceDir)) fs.mkdirSync(deviceDir, { recursive: true })
      if (!fs.existsSync(cfgPath)) {
        const cfg = {
          deviceName: raw,
          createdAt: new Date().toISOString(),
          preferences: {},
          version: 1
        }
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
        log.info('Dispositivo local creado', { dir: deviceDir })
      }
    }

    log.info('ensureLocalDevices completo', { count: names.length })
  } catch (error) {
    log.error('ensureLocalDevices error', error?.message || error)
  }
}

ipcMain.on('set-auth-token', (event, token) => {
  authToken = token
  console.log('✅ Token recibido en main.js:', authToken)
  syncClipboardHistory()
  ensureLocalDevices()
})

async function resolveDeviceIdentifiers (rawName) {
  try {
    const axiosInstance = getAxiosInstance()
    const res = await axiosInstance.get('/devices')
    const data = res?.data
    const container = (data && typeof data === 'object' ? (data.data ?? data) : {})
    const list = Array.isArray(container) ? container : (Array.isArray(container.items) ? container.items : [])
    const target = sanitizeDeviceName(rawName)
    for (const p of Array.isArray(list) ? list : []) {
      const obj = p || {}
      const name = obj.name || obj.clientId || ''
      const sname = sanitizeDeviceName(name)
      if (sname === target) {
        return { deviceId: obj.id || (obj.device && obj.device.id) || null, clientId: obj.clientId || null, name: name }
      }
    }
  } catch {}
  return { deviceId: null, clientId: null, name: sanitizeDeviceName(rawName) }
}

ipcMain.handle('switch-active-device', async (_, deviceName) => {
  try {
    activeDeviceName = sanitizeDeviceName(deviceName)
    await ensureLocalDevices()
    const devHist = readDeviceHistory()
    history = devHist
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('sync-progress', { percentage: 1, message: 'Sincronizando…' })
    }
    let finished = false
    const syncPromise = (async () => { await syncClipboardHistory(); finished = true })()
    const timeoutMs = 30 * 1000
    const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs))
    await Promise.race([syncPromise, timeout])
    if (!finished && mainWindow?.webContents) {
      mainWindow.webContents.send('sync-progress', { percentage: 30, message: 'Sincronización en segundo plano' })
    }
    return history
  } catch (e) {
    log.error('switch-active-device error', e?.message || e)
    return []
  }
})

ipcMain.handle('list-devices', async () => {
  try {
    await ensureLocalDevices()
    return listLocalDevices()
  } catch {
    return []
  }
})

  ipcMain.handle('load-device-history', async (_, deviceName) => {
    try {
      const list = listLocalDevices()
      const target = sanitizeDeviceName(deviceName)
      if (!list.includes(target)) {
        return []
      }
      const devHist = authToken ? readDeviceHistoryByName(target) : db.getAllGuest(target)
      history = devHist
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('clipboard-update', history)
      }
      return history
    } catch {
      return []
    }
  })

ipcMain.handle('get-active-device', async () => {
  try {
    return activeDeviceName || os.hostname()
  } catch {
    return os.hostname()
  }
})

function getAxiosInstance () {
  if (!authToken) {
    throw new Error('No hay token de autenticación disponible')
  }

  return axios.create({
    baseURL: BACKEND_URL,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  })
}

async function fetchBackendClipboard () {
  try {
    const axiosInstance = getAxiosInstance()
    const clientId = activeDeviceName || os.hostname()
    const res = await axiosInstance.get('/clipboard', { params: { clientId } })
    const data = res?.data
    const items = (data && typeof data === 'object' ? (data.data?.items ?? data.items ?? []) : [])
    const mapped = Array.isArray(items)
      ? items.map(it => ({
          id: it.id,
          value: String(it.value ?? ''),
          favorite: !!it.favorite,
          deviceId: it.deviceId || (it.device && it.device.id) || null,
          clientId: it.clientId || (it.meta && it.meta.clientId) || (it.device && it.device.clientId) || null
        }))
      : []
    history = mapped
    writeDeviceHistory(history)
    history = db.getAll(getCurrentDeviceName())
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }
  } catch (error) {
    log.error('fetchBackendClipboard error', error?.message || error)
  }
}

async function ensureDeviceRegistered () {
  try {
    if (deviceId) return deviceId
    const axiosInstance = getAxiosInstance()
    const hostname = os.hostname()
    const osName = process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'macOS' : 'Linux')
    const payload = { clientId: hostname, name: hostname, metadata: { os: osName, appVersion: app.getVersion() } }
    const res = await axiosInstance.post('/devices', payload)
    const data = res?.data
    const obj = (data && typeof data === 'object' ? (data.data ?? data) : {})
    deviceId = obj?.id || obj?.device?.id || null
    return deviceId
  } catch (error) {
    log.error('ensureDeviceRegistered error', error?.message || error)
    return null
  }
}

async function saveClipboardRecord (type, value, meta = {}, overrides = {}) {
  try {
    const axiosInstance = getAxiosInstance()
    const clientIdOverride = overrides && overrides.clientId ? String(overrides.clientId) : null
    const deviceIdOverride = overrides && overrides.deviceId ? overrides.deviceId : null
    const hostname = os.hostname()
    const desiredClientId = clientIdOverride ?? (activeDeviceName || hostname)
    let desiredDeviceId = null
    if (deviceIdOverride) {
      desiredDeviceId = deviceIdOverride
    } else if (sanitizeDeviceName(desiredClientId) === sanitizeDeviceName(hostname)) {
      desiredDeviceId = deviceId || (await ensureDeviceRegistered())
    }
    const payload = desiredDeviceId
      ? { type, value, meta, clientId: desiredClientId, deviceId: desiredDeviceId }
      : { type, value, meta, clientId: desiredClientId }
    log.info('clipboard save request', { type, deviceId: desiredDeviceId })
    const res = await axiosInstance.post('/clipboard', payload)
    const data = res?.data
    const item = (data && typeof data === 'object') ? (data.data ?? data) : null
    return item?.id
  } catch (error) {
    if (error.response && error.response.status === 413) {
      log.warn('clipboard save skipped: payload too large (413)', { type, size: value?.length })
    } else {
      log.error('clipboard save error', error?.message || error)
    }
  }
}

async function updateClipboardRecord (id, patch) {
  try {
    const axiosInstance = getAxiosInstance()
    await axiosInstance.put(`/clipboard/${id}`,(patch && typeof patch==='object')?patch:{})
  } catch (error) {
    log.error('clipboard update error', error?.message || error)
  }
}

function readLocalHistory () {
  try {
    return readDeviceHistory()
  } catch {
    return []
  }
}

async function syncClipboardHistory () {
  try {
    if (syncLock) return
    syncLock = true
    if (!authToken) return
    const axiosInstance = getAxiosInstance()
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 5, message: 'Iniciando sincronización' }) }
    const clientId = activeDeviceName || os.hostname()
    const res = await axiosInstance.get('/clipboard', { params: { clientId } })
    const data = res?.data
    const items = (data && typeof data === 'object' ? (data.data?.items ?? data.items ?? []) : [])
    const backendItems = Array.isArray(items)
      ? items.map(it => ({
          id: it.id,
          value: String(it.value ?? ''),
          favorite: !!it.favorite,
          deviceId: it.deviceId || (it.device && it.device.id) || null,
          clientId: it.clientId || (it.meta && it.meta.clientId) || (it.device && it.device.clientId) || null
        }))
      : []
    const backendByValue = new Map(backendItems.map(it => [it.value, it]))
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 25, message: 'Descargando historial' }) }

    await ensureDeviceRegistered()

    let ident = null
    if (activeDeviceName) {
      ident = await resolveDeviceIdentifiers(activeDeviceName)
    }

    const filtered = (activeDeviceName && ident && (ident.deviceId || ident.clientId))
      ? backendItems.filter(be => {
          if (ident.deviceId && be.deviceId) return String(be.deviceId) === String(ident.deviceId)
          if (ident.clientId && be.clientId) return String(be.clientId) === String(ident.clientId)
          return true
        })
      : backendItems

    const backendByValueFiltered = new Map(filtered.map(it => [it.value, it]))
    const remoteValues = filtered.map(it => it.value)
    const localForRemote = db.getByValues(getCurrentDeviceName(), remoteValues)
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 35, message: 'Leyendo historial local' }) }

    const localByValue = new Map(localForRemote.map(it => [it.value, it]))
    const localNotInRemote = db.getNotIn(getCurrentDeviceName(), remoteValues)
    for (const it of localNotInRemote) {
      if (!it || typeof it.value !== 'string') continue
      const isImage = it.value.startsWith('data:image')
      const overrides = ident && (ident.deviceId || ident.clientId) ? { deviceId: ident.deviceId, clientId: ident.clientId } : {}
      await saveClipboardRecord(isImage ? 'image' : 'text', it.value, isImage ? { format: 'dataURL' } : {}, overrides)
    }
    for (const be of filtered) {
      const loc = localByValue.get(be.value)
      if (loc && be.favorite !== !!loc.favorite) {
        await updateClipboardRecord(be.id, { favorite: !!loc.favorite })
      }
    }
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 65, message: 'Subiendo cambios locales' }) }

    db.importItems(getCurrentDeviceName(), filtered.map(x => ({ value: x.value, favorite: !!x.favorite })))
    history = db.getAll(getCurrentDeviceName())
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 85, message: 'Fusionando con remoto' }) }
    history = db.getAll(getCurrentDeviceName())
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 100, message: 'Completado' }) }

    log.info('syncClipboardHistory completo')
  } catch (error) {
    log.error('syncClipboardHistory error', error?.message || error)
    if (mainWindow?.webContents) { mainWindow.webContents.send('sync-progress', { percentage: 100, message: 'Sincronización fallida' }) }
  }
  finally {
    syncLock = false
  }
}

async function fetchBackendFavorites () {
  const axiosInstance = getAxiosInstance()
  const res = await axiosInstance.get('/favorite/get_favorites')
  if (!res.data.status) throw new Error('Error al obtener favoritos')
  return res.data.data
}

async function createFavorite (value) {
  const axiosInstance = getAxiosInstance()
  const res = await axiosInstance.post('/favorite/save', { value })
  if (!res.data.status) throw new Error('Error al crear favorito')
  return res.data.data
}

async function deleteFavorite (value) {
  const axiosInstance = getAxiosInstance()
  const res = await axiosInstance.post(`/favorite/delete`,{value})
  if (!res.data.status) {
    log.error('Error al eliminar favorito:', res.data.message)
    throw new Error('Error al eliminar favorito')
  }
}

function readLocalFavorites () {
  try {
    const items = readDeviceHistory()
    return items.filter(item => item.favorite).map(item => item.value)
  } catch {
    return []
  }
}

async function syncFavorites () {
  try {
    if (!authToken) return
    if (Date.now() < favoritesSyncCooldownUntil) return
    const localFavorites = readLocalFavorites()
    const backendFavorites = await fetchBackendFavorites()

    const backendValues = backendFavorites.map(fav => fav.value)

    for (const value of localFavorites) {
      if (!backendValues.includes(value)) {
        log.info('syncFavorites creando favorito', { value })
        await createFavorite(value)
      }
    }

    for (const fav of backendFavorites) {
      if (!localFavorites.includes(fav.value)) {
        log.info('syncFavorites eliminando favorito', { value: fav.value })
        await deleteFavorite(fav.value)
      }
    }

    log.info('syncFavorites sincronización completa')
  } catch (error) {
    const status = error && error.response && error.response.status
    if (status === 404) {
      favoritesSyncCooldownUntil = Date.now() + (10 * 60 * 1000)
      log.warn('syncFavorites deshabilitado temporalmente (404)', { cooldownMin: 10 })
    } else {
      log.error('syncFavorites error', { message: error.message })
    }
  }
}

// Dentro de app.whenReady()
setInterval(() => {
  syncClipboardHistory()
}, 15 * 60 * 1000)

syncClipboardHistory()

ipcMain.handle('register-device', async (_, clientId) => {
  try {
    const axiosInstance = getAxiosInstance()
    const hostname = os.hostname()
    const osName = process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'macOS' : 'Linux')
    const payload = { clientId: hostname, name: hostname, metadata: { os: osName, appVersion: app.getVersion() } }
    log.info('register-device request', payload)
    const res = await axiosInstance.post('/devices', payload)
    const data = res?.data
    const obj = (data && typeof data === 'object' ? (data.data ?? data) : {})
    deviceId = obj?.id || obj?.device?.id || null
    log.info('register-device success')
  } catch (error) {
    log.error('register-device error', error?.message || error)
  }
})

ipcMain.handle('auth-login', async (_, body) => {
  try {
    const url = `${BACKEND_URL}/auth/login`
    const res = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' }
    })
    return res.data
  } catch (error) {
    log.error('auth-login error', error?.message || error)
    throw error
  }
})

ipcMain.handle('clear-user-data', async () => {
  try {
    const baseDir = path.join(app.getPath('userData'), 'devices')
    if (fs.existsSync(baseDir)) {
      try { fs.rmSync(baseDir, { recursive: true, force: true }) } catch {}
    }
    try { fs.rmSync(legacyHistoryPath, { force: true }) } catch {}
    try {
      const alt1 = path.join(__dirname, '.clipboard-history.json')
      const alt2 = path.join(__dirname, 'clipboard-history.json')
      if (fs.existsSync(alt1)) { try { fs.rmSync(alt1, { force: true }) } catch {} }
      if (fs.existsSync(alt2)) { try { fs.rmSync(alt2, { force: true }) } catch {} }
    } catch {}
    authToken = null
    deviceId = null
    activeDeviceName = null
    history = []
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }
  } catch (error) {
    log.error('clear-user-data error', error?.message || error)
  }
})

ipcMain.handle('get-preferences', async () => {
  try {
    const obj = readDeviceConfigObj()
    return obj.preferences || {}
  } catch {
    return {}
  }
})

ipcMain.handle('set-preferences', async (_, patch) => {
  try {
    const obj = readDeviceConfigObj()
    const prefs = (patch && typeof patch === 'object') ? patch : {}
    obj.preferences = { ...(obj.preferences || {}), ...prefs }
    writeDeviceConfigObj(obj)
    return obj.preferences
  } catch {
    return {}
  }
})
ipcMain.handle('search-history', async (_, payload) => {
  try {
    const q = (payload && typeof payload === 'object') ? String(payload.query || '') : ''
    const f = (payload && typeof payload === 'object') ? String(payload.filter || 'all') : 'all'
    if (!authToken) {
      if (f === 'favorite') return []
      return db.searchGuest(getCurrentDeviceName(), q, f)
    }
    return db.search(getCurrentDeviceName(), q, f)
  } catch {
    return []
  }
})
ipcMain.handle('list-recent', async (_, payload) => {
  try {
    const f = (payload && typeof payload === 'object') ? String(payload.filter || 'all') : 'all'
    const limit = (payload && typeof payload === 'object') ? Number(payload.limit || 50) : 50
    if (!authToken) {
      if (f === 'favorite') return []
      return db.getRecentGuest(getCurrentDeviceName(), f, limit)
    }
    return db.getRecent(getCurrentDeviceName(), f, limit)
  } catch {
    return []
  }
})
process.on('unhandledRejection', (reason) => {
  try { log.error('unhandledRejection', reason?.message || reason) } catch {}
})
process.on('uncaughtException', (error) => {
  try { log.error('uncaughtException', error?.message || error) } catch {}
})

function detectPkgManager () {
  const which = name => {
    try {
      const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' })
      return r && r.status === 0
    } catch {
      return false
    }
  }
  if (which('apt-get')) return 'apt'
  if (which('dnf')) return 'dnf'
  if (which('pacman')) return 'pacman'
  if (which('zypper')) return 'zypper'
  return null
}

function getRootRunner () {
  const which = name => {
    try {
      const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' })
      return r && r.status === 0
    } catch {
      return false
    }
  }
  if (which('pkexec')) return 'pkexec'
  if (which('sudo')) return 'sudo'
  return null
}

async function installLinuxPasteSupport () {
  try {
    if (process.platform !== 'linux') return { ok: false, message: 'Solo Linux' }
    const isWayland = !!(process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY)
    const pkg = detectPkgManager()
    const runner = getRootRunner()
    if (!pkg) return { ok: false, message: 'No se detectó gestor de paquetes' }
    if (!runner) return { ok: false, message: 'No se detectó pkexec/sudo' }
    const buildCmd = names => {
      if (pkg === 'apt') return `apt-get update && apt-get install -y ${names.join(' ')}`
      if (pkg === 'dnf') return `dnf install -y ${names.join(' ')}`
      if (pkg === 'pacman') return `pacman -Sy --noconfirm ${names.join(' ')}`
      if (pkg === 'zypper') return `zypper --non-interactive install ${names.join(' ')}`
      return ''
    }
    const names = isWayland ? ['wtype', 'ydotool'] : ['xdotool']
    const cmd = buildCmd(names.filter(Boolean))
    if (!cmd) return { ok: false, message: 'No se pudo construir comando de instalación' }
    const full = runner === 'pkexec' ? `pkexec bash -lc "${cmd}"` : `sudo bash -lc "${cmd}"`
    return await new Promise(resolve => {
      exec(full, err => {
        if (err) {
          log.error('installLinuxPasteSupport error', err)
          resolve({ ok: false, message: 'Instalación fallida' })
        } else {
          resolve({ ok: true, message: 'Instalación completada' })
        }
      })
    })
  } catch (e) {
    log.error('installLinuxPasteSupport error', e?.message || e)
    return { ok: false, message: 'Error instalando' }
  }
}

ipcMain.handle('install-linux-paste-support', async () => {
  const res = await installLinuxPasteSupport()
  try {
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('paste-status', res)
    }
  } catch {}
  return res
})
