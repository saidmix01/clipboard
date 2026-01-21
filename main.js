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
const { autoUpdater } = require('electron-updater')
const electronLog = require('electron-log')
const log = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {}
}
const path = require('path')

// Logs al inicio eliminados

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('[MAIN] UNCAUGHT EXCEPTION:', error)
  console.error('[MAIN] Stack:', error.stack)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MAIN] UNHANDLED REJECTION at:', promise)
  console.error('[MAIN] Reason:', reason)
})

if (process.platform === 'win32') {
  app.setAppUserModelId('Copyfy')
}

const axios = require('axios')
const fs = require('fs')
const os = require('os')
const { PassThrough } = require('stream')
const db = require('./db')
const legacyHistoryPath = path.join(os.homedir(), '.clipboard-history.json')
const { exec, execFile, spawnSync, fork } = require('child_process')
const crypto = require('crypto')
const FormData = require('form-data')
const { dialog } = require('electron')

let mainWindow
let quickWindow
let history = []
const childWindows = new Set()
let tray
let isQuitting = false
let activeUploadWindow = null
let syncDaemon = null // Sync daemon process (forked Node process)

if (process.platform === 'linux') {
  try { app.setName('copyfy') } catch {}
  // Forzar --no-sandbox para AppImage (necesario para evitar problemas de permisos)
  if (process.env.APPIMAGE) {
    try { app.commandLine.appendSwitch('no-sandbox') } catch {}
  }
  // Detectar si Wayland está disponible, sino usar X11
  // En Electron, si no se especifica, intentará usar Wayland primero si está disponible
  // Solo forzar X11 si hay problemas específicos con Wayland
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY
  if (!isWayland) {
    // Si no es Wayland, usar X11 explícitamente (más compatible con atajos globales)
    try { app.commandLine.appendSwitch('ozone-platform', 'x11') } catch {}
    log.info('Linux: Usando X11 (más compatible con atajos globales)')
  } else {
    // Si es Wayland, advertir sobre posibles problemas con atajos globales
    log.warn('Linux: Detectado Wayland. Los atajos globales pueden requerir permisos adicionales.')
    log.warn('Si los atajos no funcionan, considera usar X11 o configurar permisos para atajos globales en Wayland.')
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Si alguien intenta correr una segunda instancia, enfocamos nuestra ventana
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      // En Linux, mover al frente y asegurar always on top puede requerir métodos adicionales
      if (process.platform === 'linux') {
        try {
          mainWindow.setAlwaysOnTop(true)
          mainWindow.moveTop()
        } catch {}
      }
    }
  })
}

function uriToPath (uri) {
  try {
    let u = String(uri || '').trim()
    if (!u) return ''
    
    // Manejar diferentes formatos de URI de archivos
    if (u.startsWith('file://')) {
      if (process.platform === 'win32') {
        // Windows: file:///C:/path o file://C:/path
        // Remover el prefijo file:// y manejar diferentes variantes
        u = u.replace(/^file:\/\/(\/+)?/, '')
        // Decodificar URI y normalizar
        u = decodeURIComponent(u)
        // path.normalize() ya maneja correctamente los separadores en Windows
        return path.normalize(u)
      } else {
        // macOS/Linux: file:///path o file://localhost/path
        u = u.replace(/^file:\/\/(localhost\/)?/, '')
        u = decodeURIComponent(u)
        // Normalizar ruta (path.normalize() usa el separador correcto para la plataforma)
        return path.normalize(u)
      }
    }
    
    // Si ya es una ruta, normalizarla usando path.normalize() que es multiplataforma
    return path.normalize(u)
  } catch (e) {
    log.error('Error convirtiendo URI a path:', e?.message || e)
    return String(uri || '').trim()
  }
}

// Extensiones de archivos de texto y documentos permitidas
const TEXT_FILE_EXTENSIONS = new Set([
  // Archivos de texto plano y código fuente
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'py', 'java', 'cpp', 'c', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'vbs',
  'sql', 'csv', 'tsv', 'log', 'ini', 'cfg', 'conf', 'config', 'yaml', 'yml', 'toml',
  'dockerfile', 'makefile', 'cmake', 'gradle', 'maven',
  'r', 'm', 'pl', 'pm', 'lua', 'vim', 'diff', 'patch',
  'tex', 'bib', 'rst', 'adoc', 'wiki', 'org',
  // Documentos de Office y PDF
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'rtf', 'pages', 'numbers', 'key', 'wps', 'wpd'
])

function isTextFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    return TEXT_FILE_EXTENSIONS.has(ext)
  } catch {
    return false
  }
}

function parseCFHDrop (buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 20) return []
    
    // Estructura DROPFILES (20 bytes):
    // Offset 0-3: pFiles (DWORD) - offset donde empiezan los paths (típicamente 20)
    // Offset 4-7: pt.x (LONG) - coordenada X del mouse
    // Offset 8-11: pt.y (LONG) - coordenada Y del mouse
    // Offset 12-15: fNC (BOOL) - flag
    // Offset 16-19: fWide (BOOL) - 0 = ANSI, 1 = Unicode
    
    const pFiles = buf.readUInt32LE(0) // Offset donde empiezan los paths
    const fWide = buf.readUInt32LE(16) !== 0 // Flag unicode (offset 16-19)
    
    // El offset mínimo debería ser 20 (tamaño de DROPFILES structure)
    const start = Math.max(pFiles, 20)
    if (start >= buf.length) return []
    
    const files = []
    let pos = start
    
    if (fWide) {
      // Unicode (UTF-16LE): cada path termina con doble null (\0\0 = 4 bytes)
      // La lista completa termina con cuádruple null (8 bytes)
      while (pos + 4 < buf.length) {
        // Buscar el siguiente doble null (dos UInt16LE consecutivos que sean 0)
        let pathStart = pos
        let foundDoubleNull = false
        
        while (pos + 4 <= buf.length) {
          const u16_1 = buf.readUInt16LE(pos)
          const u16_2 = buf.readUInt16LE(pos + 2)
          
          if (u16_1 === 0 && u16_2 === 0) {
            foundDoubleNull = true
            break
          }
          pos += 2
        }
        
        if (foundDoubleNull && pos > pathStart) {
          // Extraer el path desde pathStart hasta pos
          const pathBuf = buf.subarray(pathStart, pos)
          const pathStr = pathBuf.toString('utf16le').replace(/\0+$/, '').trim()
          if (pathStr && pathStr.length > 0) {
            files.push(pathStr)
          }
          
          // Saltar el doble null (4 bytes)
          pos += 4
          
          // Verificar si hay otro doble null (fin de lista)
          if (pos + 4 <= buf.length && buf.readUInt16LE(pos) === 0 && buf.readUInt16LE(pos + 2) === 0) {
            break // Fin de lista
          }
        } else {
          break // No encontramos más archivos
        }
      }
    } else {
      // ANSI: cada path termina con null (1 byte)
      // La lista completa termina con doble null (2 bytes)
      while (pos < buf.length) {
        // Buscar el siguiente null terminator
        let pathStart = pos
        while (pos < buf.length && buf[pos] !== 0) {
          pos++
        }
        
        if (pos > pathStart) {
          // Extraer el path
          const pathBuf = buf.subarray(pathStart, pos)
          const pathStr = pathBuf.toString('ascii').trim()
          if (pathStr && pathStr.length > 0) {
            files.push(pathStr)
          }
        }
        
        // Saltar el null
        pos++
        
        // Si encontramos otro null inmediatamente, significa fin de lista
        if (pos < buf.length && buf[pos] === 0) {
          break
        }
      }
    }
    
    // Eliminar duplicados y retornar
    const uniqueFiles = [...new Set(files)].filter(Boolean)
    return uniqueFiles
  } catch (e) {
    log.error('Error parseando CF_HDROP:', e?.message || e)
    return []
  }
}

function readClipboardFileUris () {
  try {
    const formats = (clipboard.availableFormats() || []).map(f => String(f || '').toLowerCase())
    const out = []
    const seen = new Set() // Para evitar duplicados
    
    // En Windows, CF_HDROP es el formato más confiable para múltiples archivos
    if (process.platform === 'win32') {
      const bufDrop = clipboard.readBuffer('CF_HDROP')
      if (Buffer.isBuffer(bufDrop) && bufDrop.length > 0) {
        const parts = parseCFHDrop(bufDrop)
        for (const p of parts) {
          if (p) {
            // Usar path.resolve() para obtener ruta absoluta normalizada (compatible con todas las plataformas)
            const resolved = path.resolve(p)
            const normalized = resolved.toLowerCase()
            if (!seen.has(normalized)) {
              seen.add(normalized)
              out.push(resolved)
            }
          }
        }
      }
    }
    
    // También verificar otros formatos como respaldo
    // text/uri-list: formato estándar usado en Linux y algunas aplicaciones
    if (formats.includes('text/uri-list')) {
      const buf = clipboard.readBuffer('text/uri-list')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      for (const line of String(txt || '').split(/\r?\n/)) {
        const s = String(line || '').trim()
        if (s && !s.startsWith('#')) { // Ignorar comentarios en URI list
          const p = uriToPath(s)
          if (p) {
            const resolved = path.resolve(p)
            const normalized = resolved.toLowerCase()
            if (!seen.has(normalized)) {
              seen.add(normalized)
              out.push(resolved)
            }
          }
        }
      }
    }
    
    // public.file-url: formato usado en algunas aplicaciones Linux/macOS
    if (formats.includes('public.file-url')) {
      const buf = clipboard.readBuffer('public.file-url')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      for (const line of String(txt || '').split(/\r?\n/)) {
        const s = String(line || '').trim()
        if (s) {
          const p = uriToPath(s)
          if (p) {
            const resolved = path.resolve(p)
            const normalized = resolved.toLowerCase()
            if (!seen.has(normalized)) {
              seen.add(normalized)
              out.push(resolved)
            }
          }
        }
      }
    }
    
    // macOS: NSFilenamesPboardType es un array serializado de PropertyList (plist)
    if (process.platform === 'darwin' && formats.includes('nsfilenamespboardtype')) {
      try {
        const buf = clipboard.readBuffer('NSFilenamesPboardType')
        if (Buffer.isBuffer(buf) && buf.length > 0) {
          // Intentar parsear como plist binario o XML
          // En macOS moderno, Electron puede devolver esto como string JSON o array
          // Primero intentar como string/array si es posible
          try {
            const text = buf.toString('utf8')
            // Si parece JSON (array de strings)
            if (text.startsWith('[') || text.startsWith('"')) {
              const parsed = JSON.parse(text)
              const files = Array.isArray(parsed) ? parsed : [parsed]
              for (const file of files) {
                const filePath = String(file || '').trim()
                if (filePath) {
                  // Convertir a ruta absoluta normalizada
                  const resolved = path.resolve(filePath)
                  const normalized = resolved.toLowerCase()
                  if (!seen.has(normalized)) {
                    seen.add(normalized)
                    out.push(resolved)
                  }
                }
              }
            }
          } catch {
            // Si no es JSON, intentar leer como texto plano (archivos separados por null o newline)
            const text = buf.toString('utf8')
            const parts = text.split(/\0|\r?\n/).map(s => s.trim()).filter(Boolean)
            for (const part of parts) {
              if (part) {
                // Convertir a ruta absoluta normalizada
                const resolved = path.resolve(part)
                const normalized = resolved.toLowerCase()
                if (!seen.has(normalized)) {
                  seen.add(normalized)
                  out.push(resolved)
                }
              }
            }
          }
        }
      } catch (e) {
        log.error('Error leyendo NSFilenamesPboardType:', e?.message || e)
      }
    }
    
    // FileNameW y FileName: formatos de Windows para un solo archivo (rara vez múltiples)
    if (process.platform === 'win32') {
      const bufW = clipboard.readBuffer('FileNameW')
      if (Buffer.isBuffer(bufW) && bufW.length > 0) {
        const raw = bufW.toString('utf16le')
        const parts = String(raw || '').split('\0').map(s => String(s || '').trim()).filter(Boolean)
        for (const p of parts) {
          if (p) {
            const resolved = path.resolve(p)
            const normalized = resolved.toLowerCase()
            if (!seen.has(normalized)) {
              seen.add(normalized)
              out.push(resolved)
            }
          }
        }
      }
      const bufA = clipboard.readBuffer('FileName')
      if (Buffer.isBuffer(bufA) && bufA.length > 0) {
        const raw = bufA.toString('ascii')
        const parts = String(raw || '').split('\0').map(s => String(s || '').trim()).filter(Boolean)
        for (const p of parts) {
          if (p) {
            const resolved = path.resolve(p)
            const normalized = resolved.toLowerCase()
            if (!seen.has(normalized)) {
              seen.add(normalized)
              out.push(resolved)
            }
          }
        }
      }
    }
    
    // x-special/gnome-copied-files: formato usado en GNOME/Linux
    if (formats.includes('x-special/gnome-copied-files')) {
      const buf = clipboard.readBuffer('x-special/gnome-copied-files')
      const txt = Buffer.isBuffer(buf) ? buf.toString('utf-8') : ''
      const lines = String(txt || '').split(/\r?\n/)
      const rest = lines.filter((_, i) => i > 0) // Saltar primera línea (acción: copy/cut)
      for (const line of rest) {
        const s = String(line || '').trim()
        if (s) {
          const p = uriToPath(s)
          if (p) {
            const resolved = path.resolve(p)
            const normalized = resolved.toLowerCase()
            if (!seen.has(normalized)) {
              seen.add(normalized)
              out.push(resolved)
            }
          }
        }
      }
    }
    
    return out
  } catch (e) {
    log.error('Error leyendo archivos del portapapeles:', e)
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

// Función helper para obtener el estado actual de los archivos del portapapeles
// Devuelve la clave (key) que representa los archivos de texto actuales, o '' si no hay archivos de texto
function getCurrentClipboardFilesKey () {
  try {
    if (!authToken) return ''
    
    const rawUris = readClipboardFileUris()
    const uniqueFileMap = new Map()

    if (rawUris && rawUris.length > 0) {
      for (const uri of rawUris) {
        const p = uriToPath(uri)
        if (p && fs.existsSync(p)) {
          try {
            const stat = fs.statSync(p)
            if (stat.isFile() && isTextFile(p)) {
              const key = (stat.ino && stat.dev) ? `${stat.dev}-${stat.ino}` : path.resolve(p).toLowerCase()
              const existing = uniqueFileMap.get(key)
              
              if (!existing) {
                uniqueFileMap.set(key, p)
              } else {
                const score = (pathStr) => {
                  let s = 0
                  if (/~\d+(\.|$)/i.test(pathStr)) s -= 10
                  if (pathStr === pathStr.toUpperCase() && /[a-z]/.test(pathStr.toLowerCase())) s -= 2
                  return s + (pathStr.length * 0.01)
                }
                if (score(p) > score(existing)) {
                  uniqueFileMap.set(key, p)
                }
              }
            }
          } catch (e) {
            // Silenciar errores menores
          }
        }
      }
    }

    if (uniqueFileMap.size > 0) {
      const sortedPaths = Array.from(uniqueFileMap.values()).sort()
      const normalizedPaths = sortedPaths.map(p => path.resolve(p)).sort()
      return normalizedPaths.join('|')
    }
    
    return ''
  } catch {
    return ''
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

function getImagePathFromDataURL (dataUrl) {
  try {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null
    const ni = nativeImage.createFromDataURL(dataUrl)
    if (!ni || ni.isEmpty()) return null
    const png = ni.toPNG()
    if (!png || png.length === 0) return null
    const hash = crypto.createHash('sha256').update(png).digest('hex')
    const dir = getImageHistoryDir()
    const manifestPath = path.join(dir, 'images.json')
    try {
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(raw)
        const found = Array.isArray(manifest) ? manifest.find(x => x && x.hash === hash) : null
        if (found && found.file) {
          const p = path.join(dir, found.file)
          if (fs.existsSync(p)) return p
        }
      }
    } catch {}
    const saved = saveClipboardImagePNG(ni)
    return saved || null
  } catch {
    return null
  }
}

function augmentHistoryWithImagePaths (list) {
  try {
    const arr = Array.isArray(list) ? list : []
    return arr.map(it => {
      const v = it && typeof it.value === 'string' ? it.value : ''
      if (v.startsWith('data:image')) {
        const p = getImagePathFromDataURL(v)
        if (p) return { ...it, imagePath: p }
      } else if (v.startsWith('[LOCAL_IMAGE]:')) {
        const p = v.replace('[LOCAL_IMAGE]:', '')
        return { ...it, imagePath: p }
      }
      return it
    })
  } catch {
    return Array.isArray(list) ? list : []
  }
}

function normalizeHistory (raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(item =>
    typeof item === 'string'
      ? { value: item, favorite: false }
      : { value: item.value, favorite: !!item.favorite }
  )
}

autoUpdater.logger = electronLog
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
    // Rutas de ejecutables compatibles con desarrollo y producción en Windows
    let exePath
    if (isDev) {
      exePath = path.join(__dirname, 'helpers', 'paste.exe')
    } else {
      // En producción, intentar múltiples ubicaciones posibles
      const possiblePaths = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'helpers', 'paste.exe'),
        path.join(process.resourcesPath, 'helpers', 'paste.exe'),
        path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'helpers', 'paste.exe'),
        path.join(path.dirname(process.execPath), 'helpers', 'paste.exe')
      ]
      
      exePath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0]
    }

    if (!fs.existsSync(exePath)) {
      log.error('paste.exe no encontrado en:', exePath)
      return
    }

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
    // ✅ Always ensure clipboard is written first (already done by copy handlers)
    // ✅ Check if auto-paste is enabled in preferences
    let enableAutoPaste = false
    try {
      const prefsStr = db.getConfig('preferences')
      const prefs = prefsStr ? JSON.parse(prefsStr) : {}
      enableAutoPaste = prefs.enableAutoPaste === true
    } catch (e) {
      log.error('Error reading preferences for auto-paste', e)
    }

    // ✅ If auto-paste is disabled, just inform user politely with system notification
    if (!enableAutoPaste) {
      log.info('Auto-paste disabled. Content is in clipboard. Press Ctrl+V to paste.')
      try {
        new Notification({ 
          title: 'Copyfy', 
          body: 'Contenido copiado al portapapeles. Presiona Ctrl+V para pegar.',
          silent: false
        }).show()
      } catch (e) {
        log.error('Error showing paste notification', e)
      }
      return
    }

    // ✅ Auto-paste is enabled - attempt it as fallback
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
      
      // Priority order: wtype (Wayland) > xdotool (X11) > ydotool (last resort, Wayland only)
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
          // os.tmpdir() es multiplataforma y devuelve la ruta correcta en todas las plataformas
          const tmp = path.join(os.tmpdir(), `copyfy_text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.txt`)
          try {
            fs.writeFileSync(tmp, text, 'utf-8')
          } catch (e) {
            return resolve({ ok: false, err: e })
          }
          // Escapar la ruta correctamente para evitar problemas con espacios o caracteres especiales
          // En Linux, usar comillas simples y normalizar separadores de ruta
          const normalizedTmp = tmp.replace(/\\/g, '/')
          exec(`ydotool type --file '${normalizedTmp.replace(/'/g, "'\"'\"'")}'`, err => {
            try { fs.rmSync(tmp, { force: true }) } catch {}
            if (err) return resolve({ ok: false, err })
            resolve({ ok: true })
          })
        }))
      }
      if (has('xdotool') && typeof text === 'string' && text.trim() !== '') {
        tasks.push(() => new Promise(resolve => {
          // os.tmpdir() es multiplataforma (funciona en Windows, Linux, macOS)
          const tmp = path.join(os.tmpdir(), `copyfy_text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.txt`)
          try {
            fs.writeFileSync(tmp, text, 'utf-8')
          } catch (e) {
            return resolve({ ok: false, err: e })
          }
          // Escapar la ruta correctamente para evitar problemas con espacios o caracteres especiales
          // Normalizar separadores para Linux (usar /)
          const normalizedTmp = tmp.replace(/\\/g, '/')
          exec(`xdotool type --clearmodifiers --delay 1 --file '${normalizedTmp.replace(/'/g, "'\"'\"'")}'`, err => {
            try { fs.rmSync(tmp, { force: true }) } catch {}
            if (err) return resolve({ ok: false, err })
            resolve({ ok: true })
          })
        }))
      }
      
      // ✅ Try auto-paste if tools are available
      let done = false
      for (const t of tasks) {
        const res = await t()
        if (res && res.ok) {
          log.info('Pegado/typing automático en Linux')
          done = true
          break
        }
      }
      
      // ✅ If auto-paste failed or no tools available, inform user politely with system notification
      if (!done) {
        log.info('Auto-paste not available. Content is in clipboard. Press Ctrl+V to paste.')
        try {
          new Notification({ 
            title: 'Copyfy', 
            body: 'Contenido copiado al portapapeles. Presiona Ctrl+V para pegar.',
            silent: false
          }).show()
        } catch (e) {
          log.error('Error showing paste notification', e)
        }
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
    // Rutas de ejecutables compatibles con desarrollo y producción en Windows
    let exePath
    if (isDev) {
      exePath = path.join(__dirname, 'helpers', 'paste-image.exe')
    } else {
      // En producción, intentar múltiples ubicaciones posibles
      const possiblePaths = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'helpers', 'paste-image.exe'),
        path.join(process.resourcesPath, 'helpers', 'paste-image.exe'),
        path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'helpers', 'paste-image.exe'),
        path.join(path.dirname(process.execPath), 'helpers', 'paste-image.exe')
      ]
      
      exePath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0]
    }

    if (!fs.existsSync(exePath)) {
      log.error('paste-image.exe no encontrado en:', exePath)
      return
    }

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
    // ✅ Always ensure clipboard is written first (already done by copy handlers)
    // ✅ Check if auto-paste is enabled in preferences
    let enableAutoPaste = false
    try {
      const prefsStr = db.getConfig('preferences')
      const prefs = prefsStr ? JSON.parse(prefsStr) : {}
      enableAutoPaste = prefs.enableAutoPaste === true
    } catch (e) {
      log.error('Error reading preferences for auto-paste', e)
    }

    // ✅ If auto-paste is disabled, just inform user politely with system notification
    if (!enableAutoPaste) {
      log.info('Auto-paste disabled. Image is in clipboard. Press Ctrl+V to paste.')
      try {
        new Notification({ 
          title: 'Copyfy', 
          body: 'Imagen copiada al portapapeles. Presiona Ctrl+V para pegar.',
          silent: false
        }).show()
      } catch (e) {
        log.error('Error showing paste notification', e)
      }
      return
    }

    // ✅ Auto-paste is enabled - attempt it as fallback
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
      // Priority order: wtype (Wayland) > xdotool (X11)
      if (isWayland && has('wtype')) cmds.push('wtype -M ctrl -k v -m ctrl')
      if (has('xdotool')) cmds.push('xdotool key ctrl+v')
      
      const run = () => {
        const cmd = cmds.shift()
        if (!cmd) {
          // ✅ No tools available - inform user politely with system notification
          log.info('Auto-paste not available. Image is in clipboard. Press Ctrl+V to paste.')
          try {
            new Notification({ 
              title: 'Copyfy', 
              body: 'Imagen copiada al portapapeles. Presiona Ctrl+V para pegar.',
              silent: false
            }).show()
          } catch (e) {
            log.error('Error showing paste notification', e)
          }
          return
        }
        exec(cmd, err => {
          if (err) {
            if (cmds.length) return run()
            // ✅ All tools failed - inform user politely with system notification
            log.info('Auto-paste failed. Image is in clipboard. Press Ctrl+V to paste.')
            try {
              new Notification({ 
                title: 'Copyfy', 
                body: 'Imagen copiada al portapapeles. Presiona Ctrl+V para pegar.',
                silent: false
              }).show()
            } catch (e) {
              log.error('Error showing paste notification', e)
            }
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
    icon: app.isPackaged 
      ? path.join(app.getAppPath(), 'frontend', 'media', '64x64.png')
      : path.join(__dirname, 'frontend', 'media', '64x64.png'),
    show: false,
    hasShadow: true, // ✅ sombra opcional
    title: '',
    webPreferences: {
      // Ruta de preload compatible con desarrollo y producción en todas las plataformas
      preload: app.isPackaged 
        ? path.join(app.getAppPath(), 'preload.js')
        : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  // Cargar interfaz: compatible con desarrollo y producción en todas las plataformas
  if (app.isPackaged) {
    // En producción, usar app.getAppPath() que funciona correctamente en todas las plataformas
    const indexPath = path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  } else {
    // En desarrollo, usar el servidor de Vite
    mainWindow.loadURL('http://localhost:5173')
  }

  // Enviar historial al frontend (ya cargado al inicio)
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
    }
  })
  
  // Manejar errores de carga
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[MAIN] Window failed to load:', {
      errorCode,
      errorDescription,
      validatedURL
    })
  })
  
  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('[MAIN] Window crashed:', { killed })
  })

  // Mostrar sin animación manual para evitar bloqueos
  mainWindow.once('ready-to-show', () => {
    mainWindow.setTitle('')
    mainWindow.setBounds({
      x: finalX,
      y: 0,
      width: windowWidth,
      height: windowHeight
    })
    
    // Comprobar si debe iniciar minimizada
    try {
      const prefsStr = db.getConfig('preferences')
      const prefs = prefsStr ? JSON.parse(prefsStr) : {}
      if (!prefs.startMinimized) {
        mainWindow.show()
        // Asegurar que la ventana esté siempre encima en Linux desde el inicio
        if (process.platform === 'linux') {
          try {
            mainWindow.setAlwaysOnTop(true)
            mainWindow.moveTop()
          } catch {}
        }
      }
    } catch {
      mainWindow.show()
      // Asegurar que la ventana esté siempre encima en Linux desde el inicio
      if (process.platform === 'linux') {
        try {
          mainWindow.setAlwaysOnTop(true)
          mainWindow.moveTop()
        } catch {}
      }
    }
    if (mainWindow && !mainWindow.isVisible()) {
      setTimeout(() => {
        try { mainWindow.focus() } catch {}
        try { mainWindow.webContents.focus() } catch {}
        try { mainWindow.webContents.send('focus-search') } catch {}
      }, 150)
    } else {
      // Si inicia minimizada, aseguramos que esté oculta pero lista
      mainWindow.hide() 
    }
    
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

  // Optimización de memoria: liberar RAM cuando la ventana se oculta
  mainWindow.on('hide', () => {
    try {
      // Habilitar throttling de fondo para reducir uso de CPU/RAM
      mainWindow.webContents.setBackgroundThrottling(true)
      // Limpiar cachés del navegador para liberar memoria
      mainWindow.webContents.session.clearCache().catch(() => {})
      // Limpiar almacenamiento en memoria del navegador
      mainWindow.webContents.session.clearStorageData({
        storages: ['cache', 'cookies', 'filesystem']
      }).catch(() => {})
      // Notificar al frontend que la ventana está oculta
      mainWindow.webContents.send('window-visibility-changed', { visible: false })
    } catch (err) {
      log.error('Error en optimización de memoria al ocultar:', err)
    }
  })

  mainWindow.on('show', () => {
    try {
      // Deshabilitar throttling cuando la ventana es visible
      mainWindow.webContents.setBackgroundThrottling(false)
      // Notificar al frontend que la ventana está visible
      mainWindow.webContents.send('window-visibility-changed', { visible: true })
    } catch (err) {
      log.error('Error al mostrar ventana:', err)
    }
    // Asegurar que la ventana esté siempre encima, especialmente en Linux
    if (process.platform === 'linux') {
      try {
        mainWindow.setAlwaysOnTop(true)
        mainWindow.moveTop()
      } catch {}
    }
    setTimeout(() => {
      try { mainWindow.focus() } catch {}
      try { mainWindow.webContents.focus() } catch {}
      try { mainWindow.webContents.send('focus-search') } catch {}
    }, 120)
  })
}

// Variables de estado del portapapeles (fuera de app.whenReady para accesibilidad global)
let lastImageDataUrl = ''
let lastText = ''
let lastFilesKey = ''

// Función para reinicializar el estado de los archivos del portapapeles
// Se llama al iniciar la app, al iniciar sesión, y cuando se reactiva la app
function resetClipboardFilesState () {
  lastFilesKey = getCurrentClipboardFilesKey()
}

app.whenReady().then(async () => {
  
  protocol.registerFileProtocol('local-image', (request, callback) => {
    const url = request.url.replace('local-image://', '')
    try {
      return callback(decodeURIComponent(url))
    } catch (error) {
      // Failed to register protocol
    }
  })

  try { require('./autolaunch').configureAutoLaunch() } catch (e) { log.error('Autolaunch setup failed', e) }
  await db.init(app)
  
  // Si se ejecuta con --sql-mode, abrir solo el editor SQL
  const args = process.argv.slice(1)
  const sqlMode = args.includes('--sql-mode') || args.includes('--sql')
  if (sqlMode) {
    setTimeout(() => {
      openSQLEditor()
    }, 500)
    return
  }
  
  // Initialize active device from database (devices table)
  initializeActiveDevice()
  
  // Actualizar lista de dispositivos al inicio si hay sesión
  try {
    const sessionStr = db.getConfig('session')
    if (sessionStr) {
      const session = JSON.parse(sessionStr)
      if (session && session.token) {
        authToken = session.token
        // Actualizar lista de dispositivos al inicio
        ensureLocalDevices().catch(err => {
          log.error('Error updating devices list at startup:', err)
        })
      }
    }
  } catch (e) {
    // No session or error reading session
  }
  
  // ============================================================================
  // SYNC DAEMON - Fork del proceso Node independiente para sincronización
  // ============================================================================
  function startSyncDaemon() {
    if (syncDaemon) {
      return
    }
    
    try {
      const daemonPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'sync-daemon.js')
        : path.join(__dirname, 'sync-daemon.js')
      
      // Verificar que el archivo existe
      if (!fs.existsSync(daemonPath)) {
        return
      }
      
      
      syncDaemon = fork(daemonPath, [app.getPath('userData')], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env }
      })
      
      // Redirigir stdout/stderr del daemon a la consola del proceso principal
      if (syncDaemon.stdout) {
        syncDaemon.stdout.on('data', (data) => {
          const text = data.toString().trim()
          if (text && (
            text.includes('[DAEMON-SYNC-PULL] Descargados:') || 
            text.includes('[DAEMON-SYNC] Subidos:') ||
            text.includes('[DAEMON-SYNC] performSync') ||
            text.includes('[DAEMON-SYNC] Parámetros de sync') ||
            text.includes('[DAEMON-SYNC-PULL] Petición') ||
            text.includes('[DAEMON-SYNC-PULL] Parámetros') ||
            text.includes('[DAEMON-SYNC-PUSH] Petición') ||
            text.includes('[DAEMON-SYNC-PUSH] Payload')
          )) {
            console.log(text)
          }
        })
      }
      if (syncDaemon.stderr) {
        syncDaemon.stderr.on('data', (data) => {
          const text = data.toString().trim()
          // Solo mostrar errores del sync
          if (text && text.includes('[DAEMON-SYNC')) {
            console.error(text)
          }
        })
      }
      
      // Handler de mensajes del daemon
      syncDaemon.on('message', (msg) => {
        try {
          switch (msg.type) {
            case 'READY':
              
              // Cargar sesión de la base de datos
              let sessionData = null
              try {
                const sessionStr = db.getConfig('session')
                if (sessionStr) {
                  sessionData = JSON.parse(sessionStr)
                  
                  // Si hay token en la sesión, actualizar authToken
                  if (sessionData?.token) {
                    authToken = sessionData.token
                  }
                }
              } catch (e) {
                console.error('[MAIN] Error loading session:', e)
              }
              
              // Enviar configuración inicial al daemon
              if (BACKEND_URL) {
                const configToSend = {
                  backendUrl: BACKEND_URL,
                  userDataPath: app.getPath('userData')
                }
                
                // Si hay token, enviarlo
                if (authToken) {
                  configToSend.authToken = authToken
                }
                
                // Si hay sesión, enviarla también
                if (sessionData) {
                  configToSend.session = sessionData
                }
                
                syncDaemon.send({
                  type: 'SET_CONFIG',
                  config: configToSend
                })
              }
              break
              
            case 'SYNC_PROGRESS':
              if (msg.stage === 'sync' || msg.stage === 'push' || msg.stage === 'pull' || msg.stage === 'start' || msg.stage === 'device') {
              }
              if (mainWindow?.webContents) {
                mainWindow.webContents.send('sync-progress', {
                  percentage: msg.percentage || 0,
                  message: msg.message || '',
                  type: msg.stage || 'sync'
                })
              }
              break
              
            case 'SYNC_ERROR':
              syncLock = false
              if (mainWindow?.webContents) {
                mainWindow.webContents.send('sync-progress', {
                  percentage: 100,
                  message: `Error: ${msg.error}`,
                  type: 'sync-error'
                })
              }
              break
              
            case 'SYNC_DONE':
              console.log('[MAIN] Sync: Subidos:', msg.pushResult?.successful || 0, 'Fallidos:', msg.pushResult?.failed || 0, '| Descargados:', msg.pullResult?.received || 0, 'Insertados:', msg.pullResult?.inserted || 0, 'Actualizados:', msg.pullResult?.updated || 0)
              syncLock = false
              
              // Recargar historial desde DB del dispositivo sincronizado
              // Usar el deviceName del mensaje si está disponible, sino usar el dispositivo actual
              const syncedDeviceName = msg.deviceName ? sanitizeDeviceName(msg.deviceName) : getCurrentDeviceName()
              const currentDevice = getCurrentDeviceName()
              
              // Solo recargar el historial si el dispositivo sincronizado es el dispositivo activo actual
              if (syncedDeviceName === currentDevice) {
                history = authToken ? readDeviceHistoryByName(currentDevice) : db.getAllGuest(currentDevice)
                
                if (mainWindow?.webContents) {
                  mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
                  mainWindow.webContents.send('sync-progress', {
                    percentage: 100,
                    message: msg.message || 'Sincronización completada',
                    type: 'sync-done'
                  })
                }
              }
              
              // Notificar que el sync terminó (siempre, incluso si no se actualizó la UI)
              if (syncCompletionResolve) {
                syncCompletionResolve()
                syncCompletionResolve = null
              }
              break
              
            case 'MIGRATION_DONE':
              migrationInProgress = false
              migrationCompleted = true
              
              // Recargar historial desde DB del dispositivo actual (que debería ser el seleccionado)
              const migrationDevice = getCurrentDeviceName()
              history = db.getAll(migrationDevice)
              if (mainWindow?.webContents) {
                mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
                mainWindow.webContents.send('sync-progress', {
                  percentage: 100,
                  message: msg.message || 'Migración completada',
                  type: 'migration-done'
                })
              }
              // Emitir evento para notificar que la migración terminó
              if (migrationCompletionResolve) {
                migrationCompletionResolve()
                migrationCompletionResolve = null
              }
              break
              
            case 'MIGRATION_ERROR':
              migrationInProgress = false
              if (mainWindow?.webContents) {
                mainWindow.webContents.send('sync-progress', {
                  percentage: 100,
                  message: `Error en migración: ${msg.error}`,
                  type: 'migration-error'
                })
              }
              break
              
            case 'TOKEN_REFRESHED':
              // Actualizar el token en el main process
              authToken = msg.token
              
              // Actualizar la sesión en la base de datos
              if (msg.session) {
                try {
                  db.setConfig('session', JSON.stringify(msg.session))
                  
                  // Notificar al frontend sobre el token refrescado
                  if (mainWindow?.webContents) {
                    mainWindow.webContents.send('token-refreshed', msg.token)
                  }
                } catch (e) {
                  console.error('[MAIN] Error updating session:', e)
                }
              }
              break
              
            default:
          }
        } catch (error) {
          console.error('[MAIN] Error handling daemon message:', error)
        }
      })
      
      syncDaemon.on('error', (error) => {
        console.error('[MAIN] Sync daemon error:', error)
        syncLock = false
      })
      
      syncDaemon.on('exit', (code, signal) => {
        syncDaemon = null
        syncLock = false
        
        // Reiniciar daemon si se cierra inesperadamente (solo si no es shutdown intencional)
        if (code !== 0 && !isQuitting) {
          setTimeout(() => {
            if (!isQuitting) {
              startSyncDaemon()
            }
          }, 2000)
        }
      })
      
      // Inicializar daemon
      syncDaemon.send({
        type: 'INIT',
        userDataPath: app.getPath('userData')
      })
      
    } catch (error) {
      console.error('[MAIN] Failed to start sync daemon:', error)
    }
  }
  
  // Iniciar daemon
  startSyncDaemon()
  
  createWindow()
  // Ruta del icono: compatible con desarrollo y producción en todas las plataformas
  // En empaquetado, usar app.getAppPath() que funciona correctamente en todas las plataformas
  const iconPath = app.isPackaged
    ? path.join(app.getAppPath(), 'frontend', 'media', '64x64.png')
    : path.join(__dirname, 'frontend', 'media', '64x64.png')
  
  // Verificar que el icono existe, usar fallback si no
  let image
  try {
    if (fs.existsSync(iconPath)) {
      image = nativeImage.createFromPath(iconPath)
      if (image && image.isEmpty()) {
        throw new Error('Icono vacío')
      }
    } else {
      // Fallback: intentar desde __dirname (puede funcionar en desarrollo)
      const fallbackPath = path.join(__dirname, 'frontend', 'media', '64x64.png')
      if (fs.existsSync(fallbackPath)) {
        image = nativeImage.createFromPath(fallbackPath)
      } else {
        image = nativeImage.createEmpty()
      }
    }
  } catch (e) {
    log.error('Error cargando icono:', e?.message || e)
    // Último fallback: icono vacío (Electron usará el icono por defecto)
    image = nativeImage.createEmpty()
  }
  tray = new Tray(image)
  tray.setToolTip('Copyfy++')
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } },
    { label: 'Ver tutorial', click: () => { 
      if (mainWindow?.webContents) { 
        mainWindow.show(); 
        mainWindow.focus(); 
        try { mainWindow.webContents.send('open-tutorial') } catch {} 
      } 
    } },
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
  
  // Cargar historial una sola vez al inicio (optimización)
  try {
    history = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
  } catch (err) {
    log.error('Error al leer historial (device)', err)
    history = []
  }
  
  // Migración legacy asíncrona (no bloquea el inicio)
  if (fs.existsSync(legacyHistoryPath)) {
    Promise.resolve().then(async () => {
      try {
        const data = fs.readFileSync(legacyHistoryPath, 'utf-8')
        const parsed = JSON.parse(data)
        const items = normalizeHistory(parsed)
        db.importItems(getCurrentDeviceName(), items)
        history = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
        log.info('Historial migrado desde legacy')
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
        }
      } catch (e) {
        log.error('Error en migración legacy', e)
      }
    }).catch(() => {})
  }
  
  // Diferir enforceHistoryLimit/enforceGuestLimit (no crítico para el inicio)
  Promise.resolve().then(async () => {
    try {
      if (authToken) {
        await Promise.resolve(enforceHistoryLimit(1000)).catch(() => {})
      } else {
        enforceGuestLimit(1000)
      }
    } catch {}
  }).catch(() => {})

  const pollClipboard = () => {
    // Enviar historial ya cargado al renderer (ya fue cargado al inicio)
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
    }

    // Inicializar lastFilesKey con el estado actual del portapapeles
    // Esto previene que archivos copiados antes de abrir la app/iniciar sesión/desbloquear se procesen
    resetClipboardFilesState()

    setInterval(() => {
      try {
        // Solo detectar archivos si el usuario está autenticado
        if (!authToken) {
          // Si no hay autenticación, resetear lastFilesKey para evitar detecciones previas
          if (lastFilesKey !== '') {
            lastFilesKey = ''
          }
          // Continuar con el resto del polling (texto e imágenes)
        } else {
          // Usuario autenticado - procesar archivos del portapapeles
          const rawUris = readClipboardFileUris()
          const uniqueFileMap = new Map()

          if (rawUris && rawUris.length > 0) {
            for (const uri of rawUris) {
              const p = uriToPath(uri)
              if (p && fs.existsSync(p)) {
                try {
                  const stat = fs.statSync(p)
                  // Solo procesar archivos de texto
                  if (stat.isFile() && isTextFile(p)) {
                    // Clave única basada en inodo para detectar duplicados (e.g. 8.3 vs nombre largo)
                    // Usar inodo + device si están disponibles, sino usar ruta normalizada
                    const key = (stat.ino && stat.dev) ? `${stat.dev}-${stat.ino}` : path.resolve(p).toLowerCase()
                    const existing = uniqueFileMap.get(key)
                    
                    if (!existing) {
                      uniqueFileMap.set(key, p)
                    } else {
                      // Heurística para elegir el "mejor" nombre de archivo (preferir nombre largo sobre 8.3)
                      const score = (pathStr) => {
                         let s = 0
                         // Penalizar nombre corto 8.3 (contiene ~ y digito)
                         if (/~\d+(\.|$)/i.test(pathStr)) s -= 10
                         // Penalizar todo mayúsculas si el otro tiene minúsculas
                         if (pathStr === pathStr.toUpperCase() && /[a-z]/.test(pathStr.toLowerCase())) s -= 2
                         // Preferir longitud mayor como desempate
                         return s + (pathStr.length * 0.01)
                      }
                      if (score(p) > score(existing)) {
                        uniqueFileMap.set(key, p)
                      }
                    }
                  }
                } catch (e) {
                  // Silenciar errores menores durante polling normal
                }
              }
            }
          }

          if (uniqueFileMap.size > 0) {
            const sortedPaths = Array.from(uniqueFileMap.values()).sort()
            // Normalizar las rutas para la comparación (resolver paths relativos y absolutos)
            const normalizedPaths = sortedPaths.map(p => path.resolve(p)).sort()
            const currentFilesKey = normalizedPaths.join('|')
            
            if (currentFilesKey !== lastFilesKey) {
              // Solo loggear cuando haya un cambio real en los archivos
              log.info(`Archivos de texto detectados: ${sortedPaths.length} archivo(s)`, sortedPaths.map(p => path.basename(p)))
              lastFilesKey = currentFilesKey
              // Upload files - pasar todos los archivos de texto juntos
              askForUpload(sortedPaths)
            }
          } else {
            // Solo resetear lastFilesKey si realmente cambió (no hay archivos)
            if (lastFilesKey !== '') {
              lastFilesKey = ''
            }
          }
        }
      } catch {}

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
                
                let savedPath = null
                try { savedPath = saveClipboardImagePNG(ni) } catch {}
                const dbValue = savedPath ? `[LOCAL_IMAGE]:${savedPath}` : dataUrl

                if (authToken) {
                  // Save locally as pending - push will upload to backend later
                  db.insert(getCurrentDeviceName(), dbValue, null, 'image')
                  Promise.resolve(enforceHistoryLimit(1000)).catch(() => {})
                  history = db.getAll(getCurrentDeviceName())
                } else {
                  db.insertGuest(getCurrentDeviceName(), dbValue)
                  enforceGuestLimit(1000)
                  history = db.getAllGuest(getCurrentDeviceName())
                }
                if (mainWindow?.webContents) {
                  mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
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
              // Save locally as pending - push will upload to backend later
              db.insert(getCurrentDeviceName(), dataUrl, null, 'image')
              Promise.resolve(enforceHistoryLimit(1000)).catch(() => {})
              history = db.getAll(getCurrentDeviceName())
            } else {
              db.insertGuest(getCurrentDeviceName(), dataUrl)
              enforceGuestLimit(1000)
              history = db.getAllGuest(getCurrentDeviceName())
            }
            if (mainWindow?.webContents) {
              mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
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

        if (authToken) {
          lastImageDataUrl = dataUrl
          
          const tempDir = path.join(app.getPath('userData'), 'temp-screenshots')
          try {
             if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
             const fileName = `screenshot-${Date.now()}.png`
             const tempPath = path.join(tempDir, fileName)
             fs.writeFileSync(tempPath, image.toPNG())
             createScreenshotNotificationWindow(tempPath, dataUrl)
          } catch(e) {
             log.error('Failed to handle screenshot', e)
          }
          return
        }

        // Guest logic (Optimized RAM but no confirmation)
        lastImageDataUrl = dataUrl
        let savedPath = null
        try {
          savedPath = saveClipboardImagePNG(image)
          if (savedPath) { try { log.info('Imagen guardada', { savedPath }) } catch {} }
        } catch {}

        const dbValue = savedPath ? `[LOCAL_IMAGE]:${savedPath}` : dataUrl

        db.insertGuest(getCurrentDeviceName(), dbValue)
        enforceGuestLimit(1000)
        history = db.getAllGuest(getCurrentDeviceName())
        
        mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
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
          // Save locally as pending - push will upload to backend later
          db.insert(getCurrentDeviceName(), text, null, 'text')
          Promise.resolve(enforceHistoryLimit(1000)).catch(() => {})
          history = db.getAll(getCurrentDeviceName())
        } else {
          db.insertGuest(getCurrentDeviceName(), text)
          enforceGuestLimit(1000)
          history = db.getAllGuest(getCurrentDeviceName())
        }
        mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
      }
    }, 1000)
  }

  pollClipboard()
  // Solo buscar actualizaciones en Windows
  if (app.isPackaged && process.platform === 'win32') {
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
  } else if (!app.isPackaged) {
    try { mainWindow.webContents.send('update-status', 'Entorno de desarrollo: se omite la comprobación automática.') } catch {}
  }

  const toggleShow = () => {
    log.info('Shortcut toggleShow triggered')
    if (!mainWindow) {
      createWindow()
    }
    
    // Si la ventana está visible y NO está minimizada, la ocultamos
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide()
      return
    }

    // Si está oculta o minimizada, la mostramos
    const display = screen.getPrimaryDisplay()
    const screenWidth = display.workArea.width
    const screenHeight = display.workArea.height
    const windowWidth = 400
    const windowHeight = screenHeight
    const x = screenWidth - windowWidth
    const y = 0
    mainWindow.setBounds({ x, y, width: windowWidth, height: windowHeight })
    
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    
    setTimeout(() => {
      try { mainWindow.focus() } catch {}
      try { mainWindow.webContents.focus() } catch {}
      try { mainWindow.webContents.send('focus-search') } catch {}
    }, 120)
  }

  const updateGlobalShortcuts = () => {
    try { globalShortcut.unregisterAll() } catch {}

    try {
      const prefsStr = db.getConfig('preferences')
      const prefs = prefsStr ? JSON.parse(prefsStr) : {}
      let modifier = prefs.shortcutModifier
      let key = prefs.shortcutKey

      // Default defaults
      if (!modifier) modifier = process.platform === 'darwin' ? 'Command+Option' : 'Alt'
      if (!key) key = 'X'

      const accelerator = `${modifier}+${key}`
      try {
        // En Linux, especialmente en Wayland, puede haber problemas con atajos globales
        // Intentar registrar el atajo
        const ret = globalShortcut.register(accelerator, toggleShow)
        if (ret) {
          log.info(`Shortcut registrado exitosamente: ${accelerator}`, {
            platform: process.platform,
            isPackaged: app.isPackaged,
            sessionType: process.env.XDG_SESSION_TYPE,
            wayland: !!process.env.WAYLAND_DISPLAY
          })
        } else {
          log.warn(`Fallo al registrar shortcut: ${accelerator}. Intentando fallback...`, {
            platform: process.platform,
            isPackaged: app.isPackaged,
            sessionType: process.env.XDG_SESSION_TYPE
          })
          // Fallback safe defaults if custom fails
          const fallbackAccelerator = process.platform === 'darwin' ? 'Command+Option+X' : 'Alt+X'
          const fallbackRet = globalShortcut.register(fallbackAccelerator, toggleShow)
          if (fallbackRet) {
            log.info(`Shortcut fallback registrado: ${fallbackAccelerator}`)
          } else {
            log.error(`Fallo al registrar shortcut fallback: ${fallbackAccelerator}`)
            // En Linux, si falla, puede ser un problema de permisos o Wayland
            if (process.platform === 'linux') {
              log.error('ATENCIÓN: Los atajos globales pueden no funcionar en Wayland sin configuración adicional.')
              log.error('Solución: Usa X11 o configura permisos para atajos globales en Wayland.')
            }
          }
        }
      } catch (e) {
        log.error('Error registrando shortcut', e)
        if (process.platform === 'linux') {
          log.error('En Linux, los atajos globales pueden requerir permisos especiales o usar X11 en lugar de Wayland.')
        }
      }
    } catch (e) {
      log.error('Error reading preferences for shortcuts', e)
    }
  }

  // Registrar atajos después de que la ventana esté completamente lista
  // Esto es especialmente importante en Linux compilado donde los atajos pueden fallar
  // si se registran demasiado pronto
  if (mainWindow) {
    mainWindow.once('ready-to-show', () => {
      // Esperar un poco más para asegurar que la app esté completamente inicializada
      setTimeout(() => {
        updateGlobalShortcuts()
      }, 1500)
    })
  } else {
    // Si mainWindow aún no existe, esperar un poco y registrar
    setTimeout(() => {
      updateGlobalShortcuts()
    }, 3000)
  }
  
  app.on('update-shortcuts', updateGlobalShortcuts)

  // Quick switcher desactivado

  // Quick switcher desactivado

  // NO cargar sesión en el proceso principal al inicio
  // El frontend (React) se encargará de cargar la sesión y refrescar el token
  // Una vez que el frontend establezca el token vía 'set-auth-token', 
  // entonces se ejecutarán las funciones que requieren autenticación (incluyendo syncClipboardHistory)

  // Iniciar sincronización periódica cada 15 minutos (se ejecutará solo si hay authToken)
  setInterval(() => {
    if (authToken && !syncLock) {
      syncClipboardHistory()
    }
  }, 15 * 60 * 1000) // 15 minutos

  // Ejecutar registro de dispositivo después de un breve delay
  // para asegurar que el frontend haya cargado la sesión si existe
  // La migración se ejecutará cuando se establezca el token (set-auth-token)
  // El sync periódico se ejecutará cada 15 minutos automáticamente
  setTimeout(async () => {
    if (authToken) {
      // First ensure device is registered (this will call POST /devices)
      await ensureDeviceRegistered()
      // El sync inicial se ejecutará automáticamente después de la migración
      // o en el próximo intervalo de 15 minutos
    } else {
    }
  }, 2000) // 2 segundos de delay para que el frontend cargue la sesión
})

app.on('window-all-closed', () => {
})

app.on('before-quit', () => {
  isQuitting = true
  // Stop sync daemon gracefully
  if (syncDaemon) {
    stopSyncDaemon()
  }
  try { childWindows.forEach(w => { try { w.destroy() } catch {} }) } catch {}
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch {}
})

// Reinicializar el estado de los archivos cuando la app se reactiva o el sistema se desbloquea
// Esto previene que archivos copiados antes de desbloquear/reactivar se procesen
if (powerMonitor) {
  // Evento unlock-screen funciona en macOS y Linux
  powerMonitor.on('unlock-screen', () => {
    resetClipboardFilesState()
  })
  
  // En Windows, usar el evento 'resume' que se dispara cuando el sistema vuelve de suspensión
  if (process.platform === 'win32') {
    powerMonitor.on('resume', () => {
      resetClipboardFilesState()
    })
  }
}

// Reinicializar cuando la ventana principal recibe foco (app se reactiva)
// Esto ayuda especialmente en Windows cuando se desbloquea o inicia sesión
app.on('browser-window-focus', (event, window) => {
  if (window === mainWindow) {
    // Pequeño delay para asegurar que el estado del sistema esté actualizado
    setTimeout(() => {
      resetClipboardFilesState()
    }, 500)
  }
})

// En Windows, también detectar cuando la app vuelve a estar activa después de estar inactiva
if (process.platform === 'win32') {
  app.on('activate', () => {
    setTimeout(() => {
      resetClipboardFilesState()
    }, 500)
  })
}

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
  // Solo buscar actualizaciones en Windows
  if (process.platform !== 'win32') {
    try { mainWindow.webContents.send('update-status', 'Las actualizaciones automáticas solo están disponibles en Windows.') } catch {}
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
  const res = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
  return augmentHistoryWithImagePaths(res)
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
ipcMain.handle('clear-history', async () => {
  try {
    if (authToken) {
      const axiosInstance = getAxiosInstance()
      const currentDeviceId = await ensureDeviceRegistered()
      if (currentDeviceId) {
        try {
          log.info('Intentando DELETE backend por device id (path param)', { url: `/clipboard/by-device/${currentDeviceId}` })
          await axiosInstance.delete(`/clipboard/by-device/${currentDeviceId}`)
          log.info('Historial borrado en backend (DELETE path)')
        } catch (e) {
          try { log.warn('DELETE path falló, probando POST /clipboard/by-device', e?.message || e) } catch {}
          try {
            const payload = { id: currentDeviceId }
            log.info('Intentando POST backend por device id (body)', { url: '/clipboard/by-device', payload })
            await axiosInstance.post('/clipboard/by-device', payload, { headers: { 'Content-Type': 'application/json' } })
            log.info('Historial borrado en backend (POST body)')
          } catch (e2) {
            try { log.warn('POST /clipboard/by-device falló, probando DELETE /clipboard con params', e2?.message || e2) } catch {}
            try {
              log.info('Intentando DELETE backend por device id (query param)', { url: '/clipboard', params: { id: currentDeviceId } })
              await axiosInstance.delete('/clipboard', { params: { id: currentDeviceId } })
              log.info('Historial borrado en backend (DELETE query)')
            } catch (e3) {
              log.error('Error borrando historial en backend con todos los intentos', e3?.message || e3)
            }
          }
        }
      }
    }
    history = []
    if (authToken) db.clear(getCurrentDeviceName())
    else db.clearGuest(getCurrentDeviceName())
    mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
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
          const currentDeviceId = await ensureDeviceRegistered()
          if (currentDeviceId) {
            const payload = { id: currentDeviceId, value: item.value }
            
            log.info('Enviando POST al backend (by-value):', { url: '/clipboard/by-value', payload })
            await axiosInstance.post('/clipboard/by-value', payload, {
              headers: { 'Content-Type': 'application/json' }
            })
            
            log.info('Borrado del backend exitoso')
          }
        } catch (e) {
         log.error('Error borrando del backend', e?.message || e)
       }
    } else {
      if (!authToken) log.info('No se borra del backend: No hay token')
      else if (!item) log.info('No se borra del backend: Item no encontrado localmente')
    }
    
    db.deleteById(id)
    history = authToken ? db.getAll(getCurrentDeviceName()) : db.getAllGuest(getCurrentDeviceName())
    mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
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
    let image
    if (dataUrl && dataUrl.startsWith('[LOCAL_IMAGE]:')) {
      const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
      if (fs.existsSync(p)) {
        image = nativeImage.createFromPath(p)
      }
    } else {
      image = nativeImage.createFromDataURL(dataUrl)
    }

    if (image && !image.isEmpty()) {
      lastImageDataUrl = image.toDataURL() // ✅ Evitar que el watcher lo detecte como nuevo
      clipboard.writeImage(image)
      log.info('Imagen copiada al portapapeles (self)')
    } else {
      log.error('Imagen vacía o inválida al intentar copiar')
    }
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
        sandbox: false,
        devTools: !app.isPackaged
      }
    })
    try { childWindows.add(win); win.on('closed', () => { try { childWindows.delete(win) } catch {} }) } catch {}
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const mainBounds = mainWindow?.getBounds() || { width: 400, x: wa.x + wa.width - 400, y: wa.y, height: wa.height }
    const viewerWidth = Math.max(300, wa.width - mainBounds.width)
    win.setBounds({ x: wa.x, y: wa.y, width: viewerWidth, height: wa.height })

    let finalSrc = dataUrl
    if (typeof dataUrl === 'string' && dataUrl.startsWith('[LOCAL_IMAGE]:')) {
      try {
        const p = dataUrl.replace('[LOCAL_IMAGE]:', '')
        if (fs.existsSync(p)) {
          const b64 = fs.readFileSync(p).toString('base64')
          finalSrc = `data:image/png;base64,${b64}`
        }
      } catch (e) {
        log.error('Error cargando imagen local para visor', e)
      }
    }

    const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh;color:#ddd;font-family:system-ui}#wrap{position:relative;cursor:crosshair}#img{max-width:95vw;max-height:95vh;border-radius:6px;user-select:none;cursor:crosshair}#sel{position:absolute;border:2px solid #00aaff;background:rgba(0,170,255,0.2);display:none;pointer-events:none}#panel{position:fixed;top:10px;left:10px;background:#222;border:1px solid #333;border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center}button{background:#333;border:1px solid #444;color:#eee;padding:6px 10px;border-radius:4px;cursor:pointer}button:disabled{opacity:.6;cursor:not-allowed}#res{position:fixed;bottom:10px;left:10px;right:10px;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px;max-height:40vh;overflow:auto;white-space:pre-wrap}</style></head><body><div id="panel"><button id="ocr" disabled>OCR selección</button><button id="copy" disabled>Copiar</button><span id="status"></span></div><div id="wrap"><img id="img" src="${finalSrc}"/><div id="sel"></div></div><div id="res" style="display:none"></div><script src="https://unpkg.com/tesseract.js@v4.0.3/dist/tesseract.min.js"></script><script>const img=document.getElementById('img');const sel=document.getElementById('sel');const ocrBtn=document.getElementById('ocr');const copyBtn=document.getElementById('copy');const statusEl=document.getElementById('status');const resEl=document.getElementById('res');let start=null;let rect=null;function px(n){return Math.round(n)+'px'}function setStatus(t){statusEl.textContent=t}function resetSel(){sel.style.display='none';ocrBtn.disabled=true;copyBtn.disabled=true;resEl.style.display='none';resEl.textContent='';rect=null}function within(e){const r=img.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom}window.addEventListener('mousedown',e=>{if(!within(e))return;const r=img.getBoundingClientRect();start={x:e.clientX,y:e.clientY};sel.style.display='block';sel.style.left=px(start.x);sel.style.top=px(start.y);sel.style.width='0px';sel.style.height='0px';setStatus('Seleccionando...')});window.addEventListener('mousemove',e=>{if(!start)return;const x=Math.min(e.clientX,start.x);const y=Math.min(e.clientY,start.y);const w=Math.abs(e.clientX-start.x);const h=Math.abs(e.clientY-start.y);sel.style.left=px(x);sel.style.top=px(y);sel.style.width=px(w);sel.style.height=px(h)});window.addEventListener('mouseup',e=>{if(!start)return;const r=img.getBoundingClientRect();const x=Math.min(e.clientX,start.x);const y=Math.min(e.clientY,start.y);const w=Math.abs(e.clientX-start.x);const h=Math.abs(e.clientY-start.y);start=null;if(w<5||h<5){resetSel();setStatus('');return}rect={x:x-r.left,y:y-r.top,w:w,h:h};ocrBtn.disabled=false;copyBtn.disabled=true;setStatus('Selección lista')});async function cropToCanvas(){const dispW=img.clientWidth;const dispH=img.clientHeight;const natW=img.naturalWidth;const natH=img.naturalHeight;const scaleX=natW/dispW;const scaleY=natH/dispH;const sx=Math.max(0,Math.round(rect.x*scaleX));const sy=Math.max(0,Math.round(rect.y*scaleY));const sw=Math.min(natW-sx,Math.round(rect.w*scaleX));const sh=Math.min(natH-sy,Math.round(rect.h*scaleY));const c=document.createElement('canvas');c.width=sw;c.height=sh;const ctx=c.getContext('2d');ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);return c}async function runOCR(){try{setStatus('Procesando...');const c=await cropToCanvas();const r=await Tesseract.recognize(c,'spa',{logger:m=>{}});resEl.style.display='block';resEl.textContent=r.data.text||'';copyBtn.disabled=!resEl.textContent.trim();setStatus('Listo')}catch(err){resEl.style.display='block';resEl.textContent='Error: '+(err&&err.message||'');copyBtn.disabled=true;setStatus('')}}ocrBtn.addEventListener('click',()=>{if(!rect)return;runOCR()});copyBtn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(resEl.textContent||'');setStatus('Copiado')}catch(e){setStatus('No se pudo copiar')}});img.addEventListener('load',()=>{resetSel();setStatus('')});</script></body></html>`
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
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, devTools: !app.isPackaged }
    })
    try { childWindows.add(win); win.on('closed', () => { try { childWindows.delete(win) } catch {} }) } catch {}
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const mainBounds = mainWindow?.getBounds() || { width: 400, x: wa.x + wa.width - 400, y: wa.y, height: wa.height }
    const viewerWidth = Math.max(300, wa.width - mainBounds.width)
    win.setBounds({ x: wa.x, y: wa.y, width: viewerWidth, height: wa.height })
    // Ruta del viewer compatible con desarrollo y producción en todas las plataformas
    const editorPath = app.isPackaged
      ? path.join(app.getAppPath(), 'viewer', 'code-editor.html')
      : path.join(__dirname, 'viewer', 'code-editor.html')
    
    // Obtener idioma
    let lang = app.getLocale()
    try {
       const prefsStr = db.getConfig('preferences')
       if (prefsStr) {
          const p = JSON.parse(prefsStr)
          if (p.language) lang = p.language
       }
    } catch {}

    win.loadFile(editorPath, { query: { lang } })
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
    const deeplKey = (() => {
      try { return require('./config').DEEPL_KEY } catch { return process.env.DEEPL_KEY || process.env.DEEPL_API_KEY || '' }
    })()
    if (!deeplKey) {
      log.warn('Traducción deshabilitada: falta DEEPL_KEY')
      return 'Configura la API de DeepL para traducir'
    }
    const params = new URLSearchParams()
    params.append('text', text)
    params.append('source_lang', 'ES')
    params.append('target_lang', 'EN')

    const response = await axios.post(
      'https://api-free.deepl.com/v2/translate',
      params,
      {
        headers: {
          Authorization: `DeepL-Auth-Key ${deeplKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    )

    return response.data.translations[0].text
  } catch (error) {
    log.error('Error en traducción:', error.response?.data || error.message)
    return 'Error de traducción'
  }
})
// Cuando se recibe el evento desde el renderer
ipcMain.on('paste-text', () => {
  performPaste(mainWindow)
})

// Escuchar favorito (offline-first)
ipcMain.on('toggle-favorite', async (event, payload) => {
  try {
    // Siempre trabajar contra el historial local actual
    const current = readDeviceHistory()
    if (!Array.isArray(current)) return

    const value = (typeof payload === 'string') ? payload : (payload && payload.value)
    if (!value) return

    let newFavorite = false
    const updated = current.map(item => {
      if (typeof item === 'object' && item.value === value) {
        const fav = !item.favorite
        newFavorite = fav
        return { ...item, favorite: fav }
      }
      return item
    })

    // 1) Actualizar siempre en la DB local y marcar pending=1 (lo hace setFavorite)
    db.setFavorite(getCurrentDeviceName(), value, newFavorite)

    // 2) Notificar al daemon para que recargue la base de datos
    //    (verá el cambio y lo enviará al backend en la próxima sincronización)
    if (syncDaemon && syncDaemon.connected) {
      syncDaemon.send({
        type: 'RELOAD_DATABASE'
      })
    }

    // 3) Actualizar la caché en memoria desde la DB
    history = authToken
      ? db.getAll(getCurrentDeviceName())
      : db.getAllGuest(getCurrentDeviceName())

    // 4) Enviar al frontend el historial actualizado
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
    }

    // 5) NO llamar al backend directamente aquí.
    //    El envío al servidor se hará únicamente desde el sync-daemon
    //    cuando haya conectividad / token disponible.
  } catch (err) {
    log.error('❌ Error actualizando favoritos:', err)
  }
})

ipcMain.handle('pasteImage', () => {
  performPasteImage(mainWindow)
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-system-locale', () => {
  return app.getLocale()
})

ipcMain.on('screenshot-action', async (event, { action, tempPath }) => {
  try {
    if (action === 'discard') {
      try { fs.rmSync(tempPath, { force: true }) } catch {}
    } else if (action === 'save') {
      if (!fs.existsSync(tempPath)) return
      
      const dir = path.join(app.getPath('userData'), 'clipboard-images')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      
      const fileName = path.basename(tempPath)
      const finalPath = path.join(dir, fileName)
      
      try {
        fs.renameSync(tempPath, finalPath)
      } catch (e) {
        fs.copyFileSync(tempPath, finalPath)
        try { fs.rmSync(tempPath) } catch {}
      }

      const dbValue = `[LOCAL_IMAGE]:${finalPath}`
      const deviceName = getCurrentDeviceName()

      db.insert(deviceName, dbValue)
      Promise.resolve(enforceHistoryLimit(1000)).catch(() => {})
      history = db.getAll(deviceName)
      
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
      }
    }
  } catch (e) {
    log.error('Error handling screenshot action', e)
  }
})
ipcMain.on('open-external-url', (_, url) => {
  try {
    if (mainWindow) mainWindow.hide()
    try { childWindows.forEach(w => { try { w.close() } catch {} }) } catch {}
    const targetRaw = String(url || '').trim() || 'https://copyfy.lat/novedades'
    const target = (/^https?:\/\//i.test(targetRaw)) ? targetRaw : 'https://copyfy.lat/novedades'
    Promise.resolve(shell.openExternal(target)).catch(err => { try { log.error('shell.openExternal error', err?.message || err) } catch {} })
  } catch (err) {
    log.error('Error abriendo navegador externo', err)
  }
})
let BACKEND_URL = 'https://copyfy.webcolsoluciones.com.co'
//let BACKEND_URL = 'http://localhost:3000'
try { BACKEND_URL = require('./config').BACKEND_URL || BACKEND_URL } catch {}
let authToken = null
let deviceId = null
let activeDeviceName = null

// Initialize active device on startup - always use real hostname
function initializeActiveDevice() {
  try {
    // Always use the real hostname of the current machine
    const realHostname = os.hostname()
    activeDeviceName = sanitizeDeviceName(realHostname)
  } catch (e) {
    // Fallback to hostname on error
    activeDeviceName = sanitizeDeviceName(os.hostname())
  }
}
let syncLock = false

// Función para detener el daemon de sync (debe estar fuera de app.whenReady para ser accesible)
function stopSyncDaemon() {
  if (syncDaemon) {
    syncDaemon.send({ type: 'SHUTDOWN' })
    setTimeout(() => {
      if (syncDaemon && !syncDaemon.killed) {
        syncDaemon.kill()
      }
      syncDaemon = null
    }, 1000)
  }
}

function getCurrentDeviceName () {
  // activeDeviceName is always initialized in app.whenReady()
  // If somehow it's null, fallback to hostname
  if (!activeDeviceName) {
    activeDeviceName = sanitizeDeviceName(os.hostname())
  }
  return sanitizeDeviceName(activeDeviceName)
}

function getCurrentDeviceId () {
  // First check if we have a cached deviceId
  if (deviceId) return deviceId
  
  // Try to get from database
  const savedDevice = db.getDevice()
  if (savedDevice && savedDevice.id) {
    deviceId = savedDevice.id
    return deviceId
  }
  
  // Fallback to hostname (for backward compatibility during transition)
  return null
}

function readDeviceConfigObj () {
  try {
    const prefsStr = db.getConfig('preferences')
    const preferences = prefsStr ? JSON.parse(prefsStr) : {}
    return {
      deviceName: os.hostname(),
      createdAt: new Date().toISOString(),
      preferences: preferences,
      version: 1,
      history: []
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
  try {
    if (obj.preferences) {
      db.setConfig('preferences', JSON.stringify(obj.preferences))
    }
  } catch (e) {
    log.error('Error writing preferences to DB:', e)
  }
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

function listLocalDevices () {
  try {
    // Primero intentar obtener dispositivos de la tabla devices
    const devicesFromTable = db.getAllDevices()
    if (Array.isArray(devicesFromTable) && devicesFromTable.length > 0) {
      const clientIds = devicesFromTable
        .map(d => d.clientId || d.name)
        .filter(Boolean)
      if (clientIds.length > 0) {
        return clientIds
      }
    }
    
    // Fallback: obtener dispositivos desde la DB config (compatibilidad)
    const devicesStr = db.getConfig('devices')
    if (devicesStr) {
      try {
        const devices = JSON.parse(devicesStr)
        if (Array.isArray(devices)) return devices
      } catch {}
    }
    // Si no hay en DB, retornar solo el dispositivo actual
    return [getCurrentDeviceName()]
  } catch {
    return [getCurrentDeviceName()]
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
  // Caracteres prohibidos en nombres de archivos/carpetas en Windows, Linux y macOS:
  // Windows: < > : " / \ | ? *
  // Linux/macOS: / (y null bytes, pero eso se maneja con trim)
  // Usar una regex que funcione en todas las plataformas
  // También remover caracteres de control y espacios al inicio/final
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remover caracteres prohibidos y control
    .replace(/^\s+|\s+$/g, '') // Remover espacios al inicio y final
    .replace(/\.{2,}/g, '.') // Reemplazar múltiples puntos consecutivos
    .replace(/^\.+|\.+$/g, '') // Remover puntos al inicio y final (problemas en Linux)
    .slice(0, 64) || 'device'
}

async function ensureLocalDevices () {
  try {
    const axiosInstance = getAxiosInstance()
    try {
      const res = await axiosInstance.get('/devices')
      const data = res?.data
      const container = (data && typeof data === 'object' ? (data.data ?? data) : {})
      const list = Array.isArray(container) ? container : (Array.isArray(container.items) ? container.items : [])
      
      // Guardar cada dispositivo en la tabla devices
      if (Array.isArray(list) && list.length > 0) {
        for (const deviceData of list) {
          if (deviceData && typeof deviceData === 'object') {
            const deviceInfo = {
              id: deviceData.id || deviceData.uuid || null,
              userId: deviceData.userId || deviceData.user_id || '',
              clientId: deviceData.clientId || deviceData.client_id || deviceData.name || '',
              name: deviceData.name || deviceData.clientId || deviceData.client_id || '',
              createdAt: deviceData.createdAt || deviceData.created_at || new Date().toISOString()
              // OJO: No enviamos lastSyncAt aquí.
              // Es un valor local y se conserva en db.saveDevice cuando no se pasa la propiedad.
            }
            
            if (deviceInfo.id) {
              db.saveDevice(deviceInfo)
              log.info('Device saved to local table:', { id: deviceInfo.id, name: deviceInfo.name, clientId: deviceInfo.clientId })
            }
          }
        }
      }
      
      // También mantener compatibilidad con el formato anterior (lista de nombres)
      const names = Array.isArray(list)
        ? list
            .map(p => {
              if (typeof p === 'string') return p
              const obj = p || {}
              return String(obj.clientId || obj.client_id || obj.name || '')
            })
            .filter(Boolean)
        : []
      
      if (names.length > 0) {
        db.setConfig('devices', JSON.stringify(names))
      }
      
      log.info('ensureLocalDevices completo', { count: list.length, savedToTable: list.length })
    } catch (error) {
      log.error('ensureLocalDevices error al obtener dispositivos del backend', error?.message || error)
    }
  } catch (error) {
    log.error('ensureLocalDevices error', error?.message || error)
  }
}

/**
 * Intenta refrescar el token usando el refreshToken de la sesión
 * @param {Object} session - Objeto de sesión con refreshToken
 * @returns {Promise<string|null>} - Nuevo token si el refresh fue exitoso, null si falló
 */
/**
 * Intenta refrescar el token usando el refreshToken de la sesión
 * @param {Object} session - Objeto de sesión con refreshToken
 * @returns {Promise<string|null>} - Nuevo token si el refresh fue exitoso, null si falló
 */
async function refreshTokenFromSession (session) {
  try {
    if (!session || !session.refreshToken) {
      log.debug('No hay refreshToken en la sesión')
      return null
    }

    const url = `${BACKEND_URL}/auth/refresh`
    const refreshTokenValue = session.refreshToken
    log.info('Intentando refrescar token', { 
      url, 
      hasRefreshToken: !!refreshTokenValue,
      refreshTokenType: typeof refreshTokenValue,
      refreshTokenLength: refreshTokenValue ? String(refreshTokenValue).length : 0
    })
    
    if (!refreshTokenValue || refreshTokenValue === null || refreshTokenValue === undefined) {
      log.error('refreshToken es null o undefined en la sesión', { sessionKeys: Object.keys(session || {}) })
      return null
    }

    const requestPayload = { refreshToken: refreshTokenValue }
    
    const res = await axios.post(url, requestPayload, {
      headers: { 'Content-Type': 'application/json' }
    })

    const data = res?.data
    // El formato puede ser: { data: { token, refreshToken } } o { token, refreshToken }
    const payload = (data && typeof data === 'object' ? (data.data ?? data) : {})
    const okFlag = (data && typeof data === 'object') ? (data.success ?? data.status ?? res.status === 200) : res.status === 200
    const newToken = payload?.token
    const newRefreshToken = payload?.refreshToken || session.refreshToken

    if (okFlag && newToken) {
      // Actualizar la sesión con el nuevo token
      const updatedSession = {
        ...session,
        token: newToken,
        refreshToken: newRefreshToken
      }
      
      // Guardar la sesión actualizada en DB
      db.setConfig('session', JSON.stringify(updatedSession))

      log.info('Token refrescado exitosamente', { hasNewRefreshToken: !!newRefreshToken })
      return newToken
    } else {
      log.warn('Refresh token falló: respuesta inválida', { 
        status: res.status, 
        hasToken: !!newToken,
        okFlag: okFlag,
        responseData: data 
      })
      return null
    }
  } catch (error) {
    const status = error?.response?.status
    const statusText = error?.response?.statusText
    log.warn('Error al refrescar token', {
      error: error?.message || error,
      status: status,
      statusText: statusText,
      responseData: error?.response?.data
    })
    
    // Si el error es 401, el refreshToken está expirado
    if (status === 401 || status === 403) {
      log.warn('RefreshToken expirado o inválido - el usuario debe iniciar sesión de nuevo')
    }
    
    return null
  }
}

// Flag to prevent multiple migration executions
let migrationInProgress = false
let migrationCompleted = false
let migrationCompletionResolve = null // Promise resolver para esperar la migración
let syncCompletionResolve = null // Promise resolver para esperar el sync

ipcMain.on('set-auth-token', async (event, token) => {
  authToken = token
  // Reinicializar el estado de los archivos del portapapeles al iniciar sesión
  // Esto previene que archivos copiados antes de iniciar sesión se procesen
  resetClipboardFilesState()
  
  // Cargar sesión de la base de datos para enviarla al daemon
  let sessionData = null
  try {
    const sessionStr = db.getConfig('session')
    if (sessionStr) {
      sessionData = JSON.parse(sessionStr)
    }
  } catch (e) {
    console.error('[MAIN] Error loading session for daemon:', e)
  }
  
  // Enviar configuración al daemon
  if (syncDaemon && syncDaemon.connected) {
    const configToSend = {
      backendUrl: BACKEND_URL,
      authToken: authToken,
      userDataPath: app.getPath('userData')
    }
    
    // Si hay sesión, enviarla también
    if (sessionData) {
      configToSend.session = sessionData
    }
    
    syncDaemon.send({
      type: 'SET_CONFIG',
      config: configToSend
    })
    
    // Run migration once: clear local history and load from server (non-blocking)
    // Verificar si la migración ya se ejecutó (guardado en DB local)
    const migrationCompletedInDB = db.getConfig('migration_completed')
    if (migrationCompletedInDB === 'true') {
      migrationCompleted = true
      return // No ejecutar migración si ya se completó
    }
    
    if (!migrationInProgress && !migrationCompleted) {
      // console.log('[MAIN] ==========================================')
      // console.log('[MAIN] Requesting migration from daemon...')
      // console.log('[MAIN] Device name:', getCurrentDeviceName())
      // console.log('[MAIN] Daemon connected:', syncDaemon && syncDaemon.connected)
      // console.log('[MAIN] ==========================================')
      migrationInProgress = true
      const deviceName = getCurrentDeviceName()
      if (syncDaemon && syncDaemon.connected) {
        syncDaemon.send({
          type: 'MIGRATION_START',
          deviceName: deviceName
        })
        // console.log('[MAIN] Migration request sent to daemon')
      } else {
        // console.error('[MAIN] Cannot send migration: daemon not connected')
        migrationInProgress = false
      }
    } else if (migrationInProgress) {
      // console.log('[MAIN] Migration already in progress, skipping...')
    } else if (migrationCompleted) {
      // console.log('[MAIN] Migration already completed, skipping...')
    }
  }
  
  // First ensure device is registered (this will call POST /devices)
  await ensureDeviceRegistered()
  
  // Then sync using daemon
  syncClipboardHistory()
  ensureLocalDevices()
  Promise.resolve(enforceHistoryLimit(1000)).catch(() => {})
})

// Handlers IPC para configuración (DB local)
ipcMain.handle('get-config', (event, key) => {
  try {
    return db.getConfig(key)
  } catch (e) {
    log.error('get-config error:', e)
    return null
  }
})

ipcMain.handle('set-config', (event, key, value) => {
  try {
    return db.setConfig(key, value)
  } catch (e) {
    log.error('set-config error:', e)
    return false
  }
})

ipcMain.handle('remove-config', (event, key) => {
  try {
    return db.removeConfig(key)
  } catch (e) {
    log.error('remove-config error:', e)
    return false
  }
})

ipcMain.handle('get-all-config', () => {
  try {
    return db.getAllConfig()
  } catch (e) {
    log.error('get-all-config error:', e)
    return {}
  }
})

// Handlers IPC para sesión (usando DB local)
ipcMain.handle('save-session', (event, sessionData) => {
  try {
    if (sessionData && typeof sessionData === 'object') {
      db.setConfig('session', JSON.stringify(sessionData))
      
      // Actualizar authToken si hay token en la sesión
      if (sessionData.token) {
        authToken = sessionData.token
      }
      
      // Sincronizar con el daemon si está conectado
      if (syncDaemon && syncDaemon.connected) {
        syncDaemon.send({
          type: 'SET_CONFIG',
          config: {
            backendUrl: BACKEND_URL,
            authToken: sessionData.token || authToken,
            userDataPath: app.getPath('userData'),
            session: sessionData
          }
        })
      }
      
      return true
    }
    return false
  } catch (e) {
    log.error('save-session error:', e)
    return false
  }
})

ipcMain.handle('read-session', () => {
  try {
    const sessionStr = db.getConfig('session')
    if (sessionStr) {
      try {
        return JSON.parse(sessionStr)
      } catch (e) {
        log.error('Error parsing session from DB:', e)
      }
    }
    return null
  } catch (e) {
    log.error('read-session error:', e)
    return null
  }
})

ipcMain.handle('clear-session-file', () => {
  try {
    db.removeConfig('session')
    db.removeConfig('x-token')
    return true
  } catch (e) {
    log.error('clear-session-file error:', e)
    return false
  }
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

async function startMigration(deviceName) {
  try {
    if (!authToken) {
      console.warn('[MAIN-MIGRATION] No auth token, skipping migration')
      return
    }
    
    if (!syncDaemon || !syncDaemon.connected) {
      console.error('[MAIN-MIGRATION] Sync daemon not available')
      return
    }
    
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('sync-progress', { percentage: 0, message: 'Iniciando migración...', type: 'migration-start' })
    }
    
    // Enviar comando de migración al daemon con el deviceName especificado
    const targetDeviceName = deviceName ? sanitizeDeviceName(deviceName) : getCurrentDeviceName()
    syncDaemon.send({
      type: 'MIGRATION_START',
      deviceName: targetDeviceName
    })
    
  } catch (error) {
    console.error('[MAIN-MIGRATION] startMigration error:', error?.message || error)
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('sync-progress', { percentage: 100, message: 'Migración fallida', type: 'migration-error' })
    }
  }
}

// Handler para sincronizar manualmente (botón "Sincronizar ahora")
ipcMain.handle('sync-now', async () => {
  try {
    if (!authToken) {
      return { success: false, error: 'No hay sesión activa' }
    }
    
    if (syncLock) {
      return { success: false, error: 'Sincronización en progreso' }
    }
    
    // Crear una promesa que se resuelve cuando el sync termine
    const syncWaitPromise = new Promise((resolve) => {
      syncCompletionResolve = resolve
    })
    
    // Iniciar el sync (usa el dispositivo actual)
    syncClipboardHistory()
    
    // Esperar a que el sync termine (con timeout)
    const timeoutMs = 30 * 1000
    const timeout = new Promise(resolve => setTimeout(() => {
      if (syncCompletionResolve) {
        syncCompletionResolve()
        syncCompletionResolve = null
      }
      resolve()
    }, timeoutMs))
    
    await Promise.race([syncWaitPromise, timeout])
    
    return { success: true }
  } catch (e) {
    log.error('sync-now error', e?.message || e)
    return { success: false, error: e?.message || 'Error al sincronizar' }
  }
})

ipcMain.handle('switch-active-device', async (_, deviceName) => {
  try {
    const targetDeviceName = sanitizeDeviceName(deviceName)
    
    // Obtener el clientId del dispositivo seleccionado desde la tabla devices LOCAL
    let targetClientId = targetDeviceName
    const deviceInfo = db.getDeviceByClientId(targetDeviceName)
    if (deviceInfo && deviceInfo.clientId) {
      targetClientId = deviceInfo.clientId
      activeDeviceName = targetClientId
    } else {
      activeDeviceName = targetDeviceName
    }
    
    // Cargar el historial del dispositivo seleccionado
    const devHist = authToken 
      ? readDeviceHistoryByName(targetClientId) 
      : db.getAllGuest(targetClientId)
    history = devHist
    
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
    }
    
    // Verificar si el dispositivo ya fue migrado
    const isMigrated = deviceInfo && deviceInfo.migrated === true
    
    if (!isMigrated && authToken) {
      // Si no está migrado, ejecutar migración y cargar items
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('sync-progress', { percentage: 0, message: 'Migrando dispositivo por primera vez...', type: 'device-migration' })
      }
      
      const migrationWaitPromise = new Promise((resolve) => {
        migrationCompletionResolve = resolve
      })
      
      if (syncDaemon && syncDaemon.connected) {
        syncDaemon.send({
          type: 'MIGRATION_START',
          deviceName: targetClientId
        })
      }
      
      const migrationTimeoutMs = 60 * 1000
      const migrationTimeout = new Promise(resolve => setTimeout(() => {
        if (migrationCompletionResolve) {
          migrationCompletionResolve()
          migrationCompletionResolve = null
        }
        resolve()
      }, migrationTimeoutMs))
      
      await Promise.race([migrationWaitPromise, migrationTimeout])
      
      // Recargar historial después de la migración
      const migratedHist = authToken 
        ? readDeviceHistoryByName(targetClientId) 
        : db.getAllGuest(targetClientId)
      history = migratedHist
      
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
        mainWindow.webContents.send('sync-progress', { percentage: 100, message: 'Migración completada', type: 'device-switch-complete' })
      }
    } else if (isMigrated && authToken) {
      // Si ya está migrado, ejecutar sync con el device id
      const syncWaitPromise = new Promise((resolve) => {
        syncCompletionResolve = resolve
      })
      
      syncClipboardHistory(targetClientId)
      
      const timeoutMs = 30 * 1000
      const timeout = new Promise(resolve => setTimeout(() => {
        if (syncCompletionResolve) {
          syncCompletionResolve()
          syncCompletionResolve = null
        }
        resolve()
      }, timeoutMs))
      
      await Promise.race([syncWaitPromise, timeout])
      
      // Recargar historial después del sync
      const updatedHist = authToken 
        ? readDeviceHistoryByName(targetClientId) 
        : db.getAllGuest(targetClientId)
      history = updatedHist
      
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
      }
    }
    
    return history
  } catch (e) {
    log.error('switch-active-device error', e?.message || e)
    return []
  }
})

ipcMain.handle('list-devices', async () => {
  try {
    // Usar solo la tabla local, no llamar al backend (para funcionar offline)
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
        mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
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

const https = require('https')
const http = require('http')

function getAxiosInstance () {
  if (!authToken) {
    throw new Error('No hay token de autenticación disponible')
  }

  const instance = axios.create({
    baseURL: BACKEND_URL,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  })

  // Log básico de cada request/response
  instance.interceptors.request.use((config) => {
    return config
  })

  instance.interceptors.response.use(
    (response) => {
      return response
    },
    (error) => {
      try {
        console.error('[MAIN-HTTP-ERROR]', {
          url: error.config?.url,
          status: error.response?.status,
          dataPreview: error.response?.data
            ? (typeof error.response.data === 'string'
                ? error.response.data.slice(0, 200)
                : JSON.stringify(error.response.data).slice(0, 200))
            : undefined,
          message: error.message
        })
      } catch {}
      return Promise.reject(error)
    }
  )

  // Interceptor para manejar errores 401 y refrescar token automáticamente
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config

      // Si el error es 401 y no hemos intentado refrescar ya
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true

        try {
          // Obtener la sesión desde la DB
          const sessionStr = db.getConfig('session')
          if (!sessionStr) {
            log.warn('No hay sesión guardada para refrescar token')
            return Promise.reject(error)
          }

          const session = JSON.parse(sessionStr)
          if (!session || !session.refreshToken) {
            log.warn('No hay refreshToken en la sesión')
            return Promise.reject(error)
          }

          log.info('Token expirado, intentando refrescar con refreshToken')
          
          // Intentar refrescar el token
          const newToken = await refreshTokenFromSession(session)
          
          if (newToken) {
            // Actualizar el token global
            authToken = newToken
            
            // Notificar al frontend del nuevo token
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
              mainWindow.webContents.send('token-refreshed', newToken)
            }
            
            // Actualizar el header de autorización para la petición original
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            
            log.info('Token refrescado exitosamente, reintentando petición original')
            
            // Reintentar la petición original con el nuevo token
            return instance(originalRequest)
          } else {
            log.warn('No se pudo refrescar el token')
            return Promise.reject(error)
          }
        } catch (refreshError) {
          log.error('Error al intentar refrescar token:', refreshError)
          return Promise.reject(error)
        }
      }

      return Promise.reject(error)
    }
  )

  return instance
}

async function enforceHistoryLimit (limit = 1000) {
  try {
    const device = getCurrentDeviceName()
    const count = db.countActive(device)
    if (count > limit) {
      db.trimToLimit(device, limit)
      // Nota: El endpoint /clipboard/trim no existe en el backend, 
      // el recorte se hace solo localmente con db.trimToLimit
      // Si en el futuro se necesita sincronizar el recorte con el backend,
      // se debería implementar el endpoint primero
    }
  } catch {}
}

function enforceGuestLimit (limit = 1000) {
  try {
    const device = getCurrentDeviceName()
    const count = db.countGuestActive(device)
    if (count > limit) {
      db.trimGuestToLimit(device, limit)
    }
  } catch {}
}

async function ensureDeviceRegistered () {
  try {
    // 1) Si ya tenemos un dispositivo guardado en la DB, reutilizarlo tal cual (no tocar lastSyncAt)
    const savedDevice = db.getDevice()
    if (savedDevice && savedDevice.id) {
      deviceId = savedDevice.id
      return deviceId
    }
    
    // 2) Si no hay dispositivo aún y tenemos token, registrar uno nuevo
    if (!authToken) {
      return null
    }
    
    try {
      const axiosInstance = getAxiosInstance()
      const hostname = os.hostname()
      const osName = process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'macOS' : 'Linux')
      const payload = { clientId: hostname, name: hostname, metadata: { os: osName, appVersion: app.getVersion() } }
      
      const res = await axiosInstance.post('/devices', payload)
      const data = res?.data
      
      // Extraer el dispositivo de la respuesta: { success, message, data: { device: {...} } }
      const device = (data && data.data && data.data.device) 
        ? data.data.device 
        : (data && data.device) 
          ? data.device 
          : (data && typeof data === 'object' && data.id ? data : null)
      
      if (!device || !device.id) {
        console.error('[MAIN] Failed to extract device from response. Full response:', JSON.stringify(data, null, 2))
        return null
      }
      
      deviceId = device.id
      
      // Guardar el dispositivo inicial; lastSyncAt viene del backend si existe, o null si es la primera vez
      db.saveDevice({
        id: device.id,
        userId: device.userId || '',
        clientId: device.clientId || hostname,
        name: device.name || hostname,
        createdAt: device.createdAt || new Date().toISOString(),
        lastSyncAt: device.lastSyncAt || null
      })
      
      return deviceId
    } catch (error) {
      console.error('[MAIN] Error registering device (direct method):', error?.message || error)
      if (error?.response) {
        console.error('[MAIN] Error response status:', error.response.status)
        console.error('[MAIN] Error response data:', JSON.stringify(error.response.data, null, 2))
      }
      return null
    }
  } catch (error) {
    console.error('[MAIN] ensureDeviceRegistered error:', error?.message || error)
    return null
  }
}

function askForUpload(filePaths) {
  try {
    // Validar autenticación - solo usuarios logueados pueden subir archivos
    if (!authToken) {
      log.info('Intento de subir archivos sin autenticación - ignorado')
      return
    }

    const isArray = Array.isArray(filePaths)
    const files = isArray ? filePaths : [filePaths]
    if (files.length === 0) return

    // Filtrar solo archivos de texto (doble verificación)
    const textFiles = files.filter(f => isTextFile(f))
    if (textFiles.length === 0) return

    // Usar ventana de notificación con barra de progreso en todas las plataformas
    // Las notificaciones del sistema en Linux/macOS no soportan barras de progreso interactivas
    createNotificationWindow(textFiles)
  } catch (e) {
    log.error('Error mostrando notificacion', e)
  }
}

let activeScreenshotWindow = null

function createScreenshotNotificationWindow(tempPath, dataUrl) {
  try {
    if (activeScreenshotWindow && !activeScreenshotWindow.isDestroyed()) {
      try { activeScreenshotWindow.close() } catch {}
    }

    const display = screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize
    const { x: screenX, y: screenY } = display.workArea
    const winWidth = 360
    const winHeight = 120
    
    const x = screenX + width - winWidth - 20
    const y = screenY + height - winHeight - 20
    
    const notifWindow = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x: Math.max(0, x),
      y: Math.max(0, y),
      frame: false,
      transparent: process.platform !== 'linux',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      hasShadow: process.platform === 'darwin',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    activeScreenshotWindow = notifWindow

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
      <style>
      body { margin: 0; padding: 10px 12px; background: #1e1e1e; color: #fff; font-family: system-ui, -apple-system, sans-serif; border-radius: 8px; border: 1px solid #333; box-shadow: 0 4px 12px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
      .title { font-weight: 600; font-size: 13px; margin-bottom: 2px; color: #fff; line-height: 1.2; }
      .message { font-size: 12px; color: #aaa; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
      .timeout-container { display: block; margin: 4px 0; }
      .timeout-bar { width: 100%; height: 3px; background: #333; border-radius: 2px; overflow: hidden; margin-bottom: 2px; }
      .timeout-fill { height: 100%; background: #ef4444; width: 100%; transition: width 1s linear; }
      .timeout-text { font-size: 9px; color: #888; text-align: center; line-height: 1.2; }
      .actions { display: flex; gap: 6px; margin-top: auto; justify-content: flex-end; }
      button { border: none; padding: 5px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.2s; font-weight: 500; line-height: 1.2; }
      .btn-primary { background: #3b82f6; color: white; }
      .btn-primary:hover { background: #2563eb; }
      .btn-secondary { background: #333; color: #ccc; }
      .btn-secondary:hover { background: #444; }
      .close { position: absolute; top: 6px; right: 6px; background: none; color: #666; font-size: 14px; padding: 0; cursor: pointer; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
      .close:hover { color: #fff; }
      </style>
      </head>
      <body>
      <button class="close" onclick="discard()">×</button>
      <div class="title">Captura detectada</div>
      <div class="message">¿Guardar esta captura en el historial?</div>
      
      <div class="timeout-container">
        <div class="timeout-bar"><div class="timeout-fill" id="timeoutFill"></div></div>
        <div class="timeout-text" id="timeoutText">30s restantes</div>
      </div>

      <div class="actions">
        <button class="btn-secondary" onclick="discard()">Descartar</button>
        <button class="btn-primary" onclick="save()">Guardar</button>
      </div>

      <script>
        const { ipcRenderer } = require('electron')
        
        // Timeout logic
        let timeLeft = 30
        const timeoutFill = document.getElementById('timeoutFill')
        const timeoutText = document.getElementById('timeoutText')
        
        const timer = setInterval(() => {
          timeLeft--
          timeoutText.textContent = timeLeft + 's restantes'
          const pct = (timeLeft / 30) * 100
          timeoutFill.style.width = pct + '%'
          
          if (timeLeft <= 0) {
            clearInterval(timer)
            discard()
          }
        }, 1000)

        function discard() {
          ipcRenderer.send('screenshot-action', { action: 'discard', tempPath: '${tempPath.replace(/\\/g, '\\\\')}' })
          window.close()
        }
        
        function save() {
          ipcRenderer.send('screenshot-action', { action: 'save', tempPath: '${tempPath.replace(/\\/g, '\\\\')}' }) 
          window.close()
        }
      </script>
      </body>
      </html>
    `
    notifWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
    notifWindow.once('ready-to-show', () => {
      notifWindow.show()
      // Asegurar que la ventana esté siempre encima, especialmente en Linux
      if (process.platform === 'linux') {
        try {
          notifWindow.setAlwaysOnTop(true)
          notifWindow.moveTop()
        } catch {}
      }
    })
  } catch (e) {
    log.error('Error creating screenshot window', e)
  }
}

function createNotificationWindow(filePaths) {
  try {
    const isArray = Array.isArray(filePaths)
    const files = isArray ? filePaths : [filePaths]
    
    // Cerrar ventana anterior si existe
    if (activeUploadWindow && !activeUploadWindow.isDestroyed()) {
      try {
        activeUploadWindow.close()
      } catch {}
    }
    
    const title = files.length === 1 ? 'Archivo detectado' : `${files.length} Archivos detectados`
    const message = files.length === 1 
      ? `¿Subir "${path.basename(files[0])}" a Copyfy?` 
      : `¿Subir ${files.length} archivos a Copyfy?`
    
    // Serializar los archivos para usar en el HTML como array literal de JavaScript
    const filesJsonForJS = JSON.stringify(files)
    
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize
    const { x: screenX, y: screenY } = display.workArea
    const winWidth = 360
    const winHeight = 140 // Optimizada para reducir espacio desperdiciado
    
    // Posicionar la ventana en la esquina inferior derecha, compatible con todas las plataformas
    // macOS puede tener el dock en la parte inferior, Linux puede tener paneles
    const x = screenX + width - winWidth - 20
    const y = screenY + height - winHeight - 20
    
    const notifWindow = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x: Math.max(0, x),
      y: Math.max(0, y),
      frame: false,
      transparent: process.platform !== 'linux', // Transparencia puede no funcionar bien en algunos Linux
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      hasShadow: process.platform === 'darwin', // macOS usa sombras por defecto
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    activeUploadWindow = notifWindow

    // Construir el HTML usando concatenación de strings para evitar problemas con template strings anidados
    const htmlContentParts = [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<style>',
      'body { margin: 0; padding: 10px 12px; background: #1e1e1e; color: #fff; font-family: system-ui, -apple-system, sans-serif; border-radius: 8px; border: 1px solid #333; box-shadow: 0 4px 12px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }',
      '.title { font-weight: 600; font-size: 13px; margin-bottom: 2px; color: #fff; line-height: 1.2; }',
      '.message { font-size: 12px; color: #aaa; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }',
      '.timeout-container { display: block; margin: 4px 0; }',
      '.timeout-bar { width: 100%; height: 3px; background: #333; border-radius: 2px; overflow: hidden; margin-bottom: 2px; }',
      '.timeout-fill { height: 100%; background: #ef4444; width: 100%; transition: width 1s linear; }',
      '.timeout-text { font-size: 9px; color: #888; text-align: center; line-height: 1.2; }',
      '.progress-container { display: none; margin: 6px 0; }',
      '.progress-container.visible { display: block; }',
      '.progress-bar { width: 100%; height: 5px; background: #333; border-radius: 3px; overflow: hidden; margin-bottom: 3px; }',
      '.progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s ease; }',
      '.progress-text { font-size: 10px; color: #888; text-align: center; line-height: 1.2; }',
      '.current-file { font-size: 10px; color: #aaa; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }',
      '.actions { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }',
      '.actions.uploading { display: none; }',
      'button { border: none; padding: 5px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.2s; font-weight: 500; line-height: 1.2; }',
      '.btn-primary { background: #3b82f6; color: white; }',
      '.btn-primary:hover { background: #2563eb; }',
      '.btn-secondary { background: #333; color: #ccc; }',
      '.btn-secondary:hover { background: #444; }',
      '.close { position: absolute; top: 6px; right: 6px; background: none; color: #666; font-size: 14px; padding: 0; cursor: pointer; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }',
      '.close:hover { color: #fff; }',
      '</style>',
      '</head>',
      '<body>',
      '<button class="close" onclick="cancel()">×</button>',
      '<div class="title">' + title.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>',
      '<div class="message">' + message.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>',
      '<div class="timeout-container" id="timeoutContainer">',
      '<div class="timeout-bar">',
      '<div class="timeout-fill" id="timeoutFill"></div>',
      '</div>',
      '<div class="timeout-text" id="timeoutText">60s restantes</div>',
      '</div>',
      '<div class="progress-container" id="progressContainer">',
      '<div class="progress-bar">',
      '<div class="progress-fill" id="progressFill"></div>',
      '</div>',
      '<div class="progress-text" id="progressText">0%</div>',
      '<div class="current-file" id="currentFile"></div>',
      '</div>',
      '<div class="actions" id="actions">',
      '<button class="btn-secondary" onclick="cancel()">Cancelar</button>',
      '<button class="btn-primary" onclick="confirm()">' + (files.length === 1 ? 'Subir archivo' : 'Subir todos') + '</button>',
      '</div>',
      '<script>',
      'const { ipcRenderer } = require(\'electron\')',
      'const progressContainer = document.getElementById(\'progressContainer\')',
      'const progressFill = document.getElementById(\'progressFill\')',
      'const progressText = document.getElementById(\'progressText\')',
      'const currentFile = document.getElementById(\'currentFile\')',
      'const actions = document.getElementById(\'actions\')',
      'const timeoutContainer = document.getElementById(\'timeoutContainer\')',
      'const timeoutFill = document.getElementById(\'timeoutFill\')',
      'const timeoutText = document.getElementById(\'timeoutText\')',
      '',
      '// Archivos a subir (pasados desde el main process)',
      'const filePaths = ' + filesJsonForJS + ';',
      '',
      'let autoClose = null',
      'let countdownInterval = null',
      'let remainingSeconds = 60',
      'const TIMEOUT_MS = 60000',
      '',
      'function updateCountdown() {',
      '  remainingSeconds--',
      '  const percentage = (remainingSeconds / 60) * 100',
      '  timeoutFill.style.width = percentage + "%"',
      '  timeoutText.textContent = remainingSeconds + "s restantes"',
      '  if (remainingSeconds <= 10) {',
      '    timeoutText.style.color = "#ef4444"',
      '    timeoutFill.style.background = "#ef4444"',
      '  } else if (remainingSeconds <= 20) {',
      '    timeoutText.style.color = "#f59e0b"',
      '    timeoutFill.style.background = "#f59e0b"',
      '  } else {',
      '    timeoutText.style.color = "#888"',
      '    timeoutFill.style.background = "#3b82f6"',
      '  }',
      '  if (remainingSeconds <= 0) {',
      '    clearInterval(countdownInterval)',
      '    clearTimeout(autoClose)',
      '    ipcRenderer.send(\'notification-timeout\', { filePaths: filePaths })',
      '    window.close()',
      '  }',
      '}',
      '',
      'function confirm() {',
      '  clearTimeout(autoClose)',
      '  clearInterval(countdownInterval)',
      '  timeoutContainer.style.display = "none"',
      '  progressContainer.classList.add("visible")',
      '  actions.classList.add("uploading")',
      '  ipcRenderer.send(\'notification-action\', { action: "upload", filePaths: filePaths })',
      '}',
      '',
      'function cancel() {',
      '  clearTimeout(autoClose)',
      '  clearInterval(countdownInterval)',
      '  ipcRenderer.send(\'notification-cancel\', { filePaths: filePaths })',
      '  window.close()',
      '}',
      '',
      'ipcRenderer.on(\'upload-progress\', (_, data) => {',
      '  const { percent, current, total, fileName } = data',
      '  progressFill.style.width = percent + "%"',
      '  progressText.textContent = percent.toFixed(0) + "%"',
      '  if (fileName) {',
      '    currentFile.textContent = fileName',
      '  }',
      '})',
      '',
      'ipcRenderer.on(\'upload-complete\', () => {',
      '  clearInterval(countdownInterval)',
      '  timeoutContainer.style.display = "none"',
      '  progressFill.style.width = "100%"',
      '  progressText.textContent = "100% ✓"',
      '  setTimeout(() => window.close(), 1500)',
      '})',
      '',
      'countdownInterval = setInterval(updateCountdown, 1000)',
      '',
      'autoClose = setTimeout(() => {',
      '  clearInterval(countdownInterval)',
      '  if (!progressContainer.classList.contains("visible")) {',
      '    ipcRenderer.send(\'notification-timeout\', { filePaths: filePaths })',
      '    window.close()',
      '  }',
      '}, TIMEOUT_MS)',
      '',
      'setTimeout(() => {',
      '  timeoutFill.style.width = "100%"',
      '  timeoutFill.style.transition = "width 60s linear"',
      '  timeoutFill.style.width = "0%"',
      '}, 100)',
      '</script>',
      '</body>',
      '</html>'
    ]
    
    const htmlContent = htmlContentParts.join('\n')

    notifWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)
    notifWindow.once('ready-to-show', () => {
      notifWindow.show()
      // Asegurar que la ventana esté siempre encima, especialmente en Linux
      if (process.platform === 'linux') {
        try {
          notifWindow.setAlwaysOnTop(true)
          notifWindow.moveTop()
        } catch {}
      }
    })
    
    notifWindow.on('closed', () => {
      if (activeUploadWindow === notifWindow) {
        activeUploadWindow = null
      }
    })
  } catch (e) {
    log.error('Error creando ventana de notificacion', e)
  }
}

ipcMain.on('notification-action', async (_, { action, filePath, filePaths }) => {
  if (action === 'upload') {
    const targets = filePaths || (filePath ? [filePath] : [])
    
    if (targets.length === 0) return
    
    let completed = 0
    const total = targets.length
    
    // Función para actualizar progreso
    const updateProgress = (current, fileName) => {
      const percent = (current / total) * 100
      try {
        if (activeUploadWindow && !activeUploadWindow.isDestroyed() && !activeUploadWindow.webContents.isDestroyed()) {
          activeUploadWindow.webContents.send('upload-progress', {
            percent,
            current,
            total,
            fileName: fileName ? path.basename(fileName) : null
          })
        }
      } catch (e) {
        // Ventana cerrada durante la subida
      }
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('file-upload-status', { status: 'uploading', file: fileName, progress: percent })
      }
    }
    
    // Subir archivos secuencialmente para mostrar progreso correcto
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]
      const fileName = path.basename(p)
      
      try {
        updateProgress(completed, p)
        
        const res = await uploadFile(p)
        
        if (res.success) {
          completed++
          updateProgress(completed, p)
          
          if (mainWindow?.webContents) {
            mainWindow.webContents.send('file-uploaded', res.data)
          }
        } else {
          completed++
          updateProgress(completed, p)
          
          if (mainWindow?.webContents) {
            mainWindow.webContents.send('file-upload-error', { file: p, error: res.error })
          }
          new Notification({ title: 'Error', body: `Error al subir ${fileName}.` }).show()
        }
      } catch (error) {
        completed++
        updateProgress(completed, p)
        
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('file-upload-error', { file: p, error: error?.message || 'Error desconocido' })
        }
        new Notification({ title: 'Error', body: `Error al subir ${fileName}.` }).show()
      }
    }
    
    // Notificar finalización
    try {
      if (activeUploadWindow && !activeUploadWindow.isDestroyed() && !activeUploadWindow.webContents.isDestroyed()) {
        activeUploadWindow.webContents.send('upload-complete')
      }
    } catch (e) {
      // Ventana ya cerrada
    }
    
    // Mostrar notificación de éxito si todos fueron subidos correctamente
    if (completed === total) {
      new Notification({ 
        title: 'Subida completada', 
        body: total === 1 ? `${path.basename(targets[0])} se ha subido correctamente.` : `${total} archivos subidos correctamente.` 
      }).show()
    }
  }
})

// Handler para cuando el timeout expira - reinicializar el estado de los archivos
ipcMain.on('notification-timeout', (_, { filePaths }) => {
  try {
    // Reinicializar el estado de los archivos para que no se vuelvan a procesar
    resetClipboardFilesState()
    log.info('Timeout de notificación de subir archivos - estado reinicializado')
  } catch (e) {
    log.error('Error en notification-timeout', e)
  }
})

// Handler para cuando el usuario cancela - reinicializar el estado de los archivos
ipcMain.on('notification-cancel', (_, { filePaths }) => {
  try {
    // Reinicializar el estado de los archivos para que no se vuelvan a procesar
    resetClipboardFilesState()
    log.info('Usuario canceló notificación de subir archivos - estado reinicializado')
  } catch (e) {
    log.error('Error en notification-cancel', e)
  }
})

async function uploadFile(filePath) {
  try {
    if (!authToken) return { success: false, message: 'No autenticado' }
    if (!fs.existsSync(filePath)) return { success: false, message: 'Archivo no encontrado' }
    
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath))
    
    const axiosInstance = getAxiosInstance()
    const currentDeviceId = await ensureDeviceRegistered()
    if (!currentDeviceId) return { success: false, message: 'Device not registered' }
    
    const headers = {
      ...axiosInstance.defaults.headers,
      ...form.getHeaders(),
      'x-device-id': currentDeviceId
    }
    
    // Asegurar que el Content-Type sea el del form-data (multipart)
    if (headers['Content-Type'] === 'application/json') {
      delete headers['Content-Type']
    }
    // form-data devuelve headers en minúsculas usualmente
    const formHeaders = form.getHeaders()
    for (const k in formHeaders) {
      headers[k] = formHeaders[k]
    }
    
    const res = await axiosInstance.post('/api/files/upload', form, { headers })
    return { success: true, data: res.data }
  } catch (error) {
    log.error('Error subiendo archivo', error?.message || error)
    return { success: false, error: error?.message || 'Error de red' }
  }
}

async function saveClipboardRecord (type, value, meta = {}, overrides = {}) {
  try {
    const axiosInstance = getAxiosInstance()
    const deviceIdOverride = overrides && overrides.deviceId ? overrides.deviceId : null
    let desiredDeviceId = null
    if (deviceIdOverride) {
      desiredDeviceId = deviceIdOverride
    } else {
      desiredDeviceId = await ensureDeviceRegistered()
    }
    if (!desiredDeviceId) {
      log.warn('clipboard save skipped: device not registered')
      return null
    }
    const payload = { type, value, meta, id: desiredDeviceId }
    log.info('clipboard save request', { type, id: desiredDeviceId })
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
    log.info('clipboard update request', { id, patch: (patch && typeof patch==='object')?patch:{} })
    await axiosInstance.put(`/clipboard/${id}`,(patch && typeof patch==='object')?patch:{})
  } catch (error) {
    log.error('clipboard update error', error?.message || error)
    try { if (error && error.response) { log.error('clipboard update response', error.response.data) } } catch {}
  }
}

function readLocalHistory () {
  try {
    return readDeviceHistory()
  } catch {
    return []
  }
}



// NEW SYNC FUNCTION - Usa el daemon para sincronización
async function syncClipboardHistory(deviceNameOverride = null) {
  try {
    if (syncLock) {
      return
    }
    if (!authToken) {
      return
    }
    
    if (!syncDaemon || !syncDaemon.connected) {
      return
    }
    
    syncLock = true
    
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('sync-progress', { percentage: 0, message: 'Iniciando sincronización...', type: 'sync-start' })
    }
    
    // Enviar comando de sync al daemon con el deviceName especificado o el actual
    const deviceName = deviceNameOverride ? sanitizeDeviceName(deviceNameOverride) : getCurrentDeviceName()
    syncDaemon.send({
      type: 'SYNC_START',
      deviceName: deviceName
    })
    
  } catch (error) {
    syncLock = false
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('sync-progress', { percentage: 100, message: 'Sincronización fallida', type: 'sync-error' })
    }
  }
}




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
    try { fs.rmSync(legacyHistoryPath, { force: true }) } catch {}
    // Limpiar configuración de la DB (solo datos de sesión / auth, NO preferencias de UI)
    try {
      db.removeConfig('session')
      db.removeConfig('x-token')
      db.removeConfig('devices')
    } catch {}
    try {
      // Limpiar archivos legacy en diferentes ubicaciones posibles (multiplataforma)
      const legacyPaths = [
        legacyHistoryPath, // Ya verificado arriba
        path.join(os.homedir(), 'clipboard-history.json'), // Alternativa
        path.join(app.getPath('userData'), 'clipboard-history.json'), // En userData
      ]
      
      // Solo intentar limpiar __dirname si estamos en desarrollo (no empaquetado)
      if (!app.isPackaged) {
        legacyPaths.push(
          path.join(__dirname, '.clipboard-history.json'),
          path.join(__dirname, 'clipboard-history.json')
        )
      }
      
      for (const legacyPath of legacyPaths) {
        try {
          if (fs.existsSync(legacyPath)) {
            fs.rmSync(legacyPath, { force: true })
          }
        } catch {}
      }
    } catch {}
    authToken = null
    deviceId = null
    activeDeviceName = null
    history = []
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', augmentHistoryWithImagePaths(history))
    }
  } catch (error) {
    log.error('clear-user-data error', error?.message || error)
  }
})

ipcMain.handle('get-preferences', async () => {
  try {
    const prefsStr = db.getConfig('preferences')
    return prefsStr ? JSON.parse(prefsStr) : {}
  } catch (e) {
    log.error('get-preferences error:', e)
    return {}
  }
})

ipcMain.handle('set-preferences', async (_, patch) => {
  try {
    const prefsStr = db.getConfig('preferences')
    const currentPrefs = prefsStr ? JSON.parse(prefsStr) : {}
    const prefs = (patch && typeof patch === 'object') ? patch : {}
    
    // Si alguna preferencia es undefined, eliminarla del objeto
    const newPrefs = { ...currentPrefs }
    for (const key in prefs) {
      if (prefs[key] === undefined || prefs[key] === null) {
        delete newPrefs[key]
      } else {
        newPrefs[key] = prefs[key]
      }
    }
    
    db.setConfig('preferences', JSON.stringify(newPrefs))
    
    // Si cambiaron los atajos, recargar
    if (prefs.shortcutModifier || prefs.shortcutKey) {
      app.emit('update-shortcuts')
    }
    
    return newPrefs
  } catch (e) {
    log.error('set-preferences error:', e)
    return {}
  }
})
ipcMain.handle('search-history', async (_, payload) => {
  try {
    const q = (payload && typeof payload === 'object') ? String(payload.query || '') : ''
    const f = (payload && typeof payload === 'object') ? String(payload.filter || 'all') : 'all'
    const page = (payload && typeof payload === 'object') ? Math.max(0, Number(payload.page || 0)) : 0
    const limit = (payload && typeof payload === 'object') ? Math.max(1, Math.min(100, Number(payload.limit || 20))) : 20
    
    // Si hay búsqueda activa, usar función paginada
    if (q.trim().length > 0) {
      if (!authToken) {
        if (f === 'favorite') return []
        return augmentHistoryWithImagePaths(db.searchGuestPaginated(getCurrentDeviceName(), q, f, page, limit))
      }
      return augmentHistoryWithImagePaths(db.searchPaginated(getCurrentDeviceName(), q, f, page, limit))
    } else {
      // Sin búsqueda, usar función normal (limitada a 50 items como antes)
      if (!authToken) {
        if (f === 'favorite') return []
        return augmentHistoryWithImagePaths(db.searchGuest(getCurrentDeviceName(), q, f))
      }
      return augmentHistoryWithImagePaths(db.search(getCurrentDeviceName(), q, f))
    }
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
      return augmentHistoryWithImagePaths(db.getRecentGuest(getCurrentDeviceName(), f, limit))
    }
    return augmentHistoryWithImagePaths(db.getRecent(getCurrentDeviceName(), f, limit))
  } catch {
    return []
  }
})

ipcMain.handle('list-files', async (_, params) => {
  try {
    // Validar autenticación - solo usuarios logueados pueden ver archivos
    if (!authToken) {
      log.info('Intento de listar archivos sin autenticación')
      return { success: false, error: 'No autenticado', items: [] }
    }

    const axiosInstance = getAxiosInstance()
    
    // Configurar parámetros de paginación con defaults correctos
    const page = params?.page ? Math.max(1, parseInt(params.page)) : 1
    const limit = params?.limit ? Math.min(200, Math.max(1, parseInt(params.limit))) : 50
    
    // Siempre incluir clientId - usar el de params si existe, sino activeDeviceName, sino hostname
    const p = { page, limit }
    p.clientId = params?.clientId || activeDeviceName || os.hostname()
    
    log.info('list-files FULL URL:', `${axiosInstance.defaults.baseURL}/api/files`, 'PARAMS:', p)
    const res = await axiosInstance.get('/api/files', { params: p })
    log.info('list-files response data:', JSON.stringify(res.data, null, 2))
    return res.data
  } catch (e) {
    log.error('list-files error:', e.message)
    if (e.response) log.error('list-files response error:', e.response.data)
    return { success: false, error: e.message, items: [] }
  }
})

ipcMain.handle('delete-file', async (_, fileId) => {
  try {
    // Validar autenticación - solo usuarios logueados pueden eliminar archivos
    if (!authToken) {
      log.info('Intento de eliminar archivo sin autenticación')
      return { success: false, error: 'No autenticado' }
    }

    const axiosInstance = getAxiosInstance()
    const res = await axiosInstance.delete(`/api/files/${fileId}`)
    return res.data
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('download-file', async (_, fileId, fileName) => {
  let writer = null
  let progressStream = null
  let responseStream = null
  
  try {
    // Validar autenticación - solo usuarios logueados pueden descargar archivos
    if (!authToken) {
      log.info('Intento de descargar archivo sin autenticación')
      return { success: false, error: 'No autenticado', canceled: false }
    }

    const axiosInstance = getAxiosInstance()
    
    let filePath
    
    // En Linux, descargar directamente sin abrir diálogo del sistema
    if (process.platform === 'linux') {
      // Obtener directorio de descargas
      let defaultDir
      try {
        defaultDir = path.join(os.homedir(), 'Downloads')
        // Si no existe Downloads, usar home
        if (!fs.existsSync(defaultDir)) {
          defaultDir = os.homedir()
        }
      } catch {
        defaultDir = os.homedir()
      }
      
      // Construir ruta completa
      const defaultFileName = fileName || 'downloaded-file'
      let finalPath = path.join(defaultDir, defaultFileName)
      
      // Si el archivo ya existe, agregar un número para evitar sobrescribir
      if (fs.existsSync(finalPath)) {
        const ext = path.extname(defaultFileName)
        const baseName = path.basename(defaultFileName, ext)
        let counter = 1
        do {
          finalPath = path.join(defaultDir, `${baseName} (${counter})${ext}`)
          counter++
        } while (fs.existsSync(finalPath) && counter < 1000)
      }
      
      filePath = finalPath
      
      // Mostrar notificación informando al usuario
      try {
        const displayName = path.basename(filePath)
        new Notification({
          title: 'Descarga iniciada',
          body: `El archivo se guardará en: ${defaultDir}\n${displayName}`,
          silent: false
        }).show()
      } catch (notifError) {
        log.warn('No se pudo mostrar notificación:', notifError)
      }
      
      log.info('Linux: Descargando directamente a', filePath)
    } else {
      // Para Windows y macOS, usar el diálogo del sistema
      // Obtener directorio de descargas por defecto
      let defaultDir
      try {
        if (process.platform === 'win32') {
          defaultDir = path.join(os.homedir(), 'Downloads')
        } else if (process.platform === 'darwin') {
          defaultDir = path.join(os.homedir(), 'Downloads')
        } else {
          defaultDir = path.join(os.homedir(), 'Downloads')
        }
      } catch {
        defaultDir = os.homedir()
      }
      
      // Construir ruta por defecto completa
      const defaultFileName = fileName || 'downloaded-file'
      const defaultPath = path.join(defaultDir, defaultFileName)
      
      // Preparar opciones del diálogo
      const dialogOptions = {
        title: 'Guardar archivo',
        defaultPath: defaultPath,
        buttonLabel: 'Guardar'
      }
      
      // Agregar filtros si hay extensión
      if (fileName && path.extname(fileName)) {
        const ext = path.extname(fileName).slice(1)
        if (ext) {
          dialogOptions.filters = [
            { name: 'Archivos', extensions: [ext] },
            { name: 'Todos los archivos', extensions: ['*'] }
          ]
        }
      }
      
      log.info('Mostrando diálogo de guardado', { defaultPath, fileName, platform: process.platform })
      
      // Mostrar el diálogo
      let dialogResult
      try {
        // Para Windows y macOS, usar la ventana padre si está disponible
        if (mainWindow && !mainWindow.isDestroyed()) {
          // Asegurar que la ventana esté visible y enfocada
          if (!mainWindow.isVisible()) {
            mainWindow.show()
          }
          mainWindow.focus()
          // Pequeño delay para asegurar que la ventana esté lista
          await new Promise(resolve => setTimeout(resolve, 100))
          dialogResult = await dialog.showSaveDialog(mainWindow, dialogOptions)
        } else {
          // Si no hay ventana, mostrar diálogo sin ventana padre
          log.info('Mostrando diálogo sin ventana padre')
          dialogResult = await dialog.showSaveDialog(dialogOptions)
        }
      } catch (dialogError) {
        log.error('Error en showSaveDialog:', dialogError)
        // Intentar una vez más sin ventana padre si falló con ventana
        try {
          log.info('Reintentando diálogo sin ventana padre')
          dialogResult = await dialog.showSaveDialog(dialogOptions)
        } catch (retryError) {
          log.error('Error en segundo intento de diálogo:', retryError)
          return { success: false, error: `Error al abrir diálogo de guardado: ${retryError.message || dialogError.message}`, canceled: true }
        }
      }
      
      if (!dialogResult) {
        log.warn('Dialog result es null/undefined')
        return { success: false, canceled: true }
      }
      
      const { canceled, filePath: selectedPath } = dialogResult
      if (canceled || !selectedPath || !selectedPath.trim()) {
        log.info('Usuario canceló la descarga o no seleccionó ruta')
        return { success: false, canceled: true }
      }
      
      filePath = selectedPath
      log.info('Ruta seleccionada para descarga:', filePath)
    }
    
    // Validar que el directorio existe y es escribible
    const dir = path.dirname(filePath)
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      // Verificar permisos de escritura
      fs.accessSync(dir, fs.constants.W_OK)
    } catch (dirError) {
      log.error('Error creando/verificando directorio:', dirError)
      return { success: false, error: `No se pudo crear o escribir en el directorio: ${dirError.message}` }
    }
    
    // En Linux, agregar un pequeño delay antes de iniciar la descarga para evitar bloqueos
    if (process.platform === 'linux') {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    const res = await axiosInstance.get(`/api/files/${fileId}/download`, { responseType: 'stream' })
    responseStream = res.data
    
    // Obtener el tamaño total del archivo desde los headers
    const totalSize = parseInt(res.headers['content-length'] || '0', 10)
    let downloadedSize = 0
    
    // Enviar evento inicial de inicio de descarga
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        fileName: fileName || 'downloaded-file',
        percentage: 0,
        downloaded: 0,
        total: totalSize
      })
    }
    
    // Crear un stream intermedio para monitorear el progreso
    progressStream = new PassThrough()
    writer = fs.createWriteStream(filePath)
    
    // Manejo de errores en el stream de respuesta
    responseStream.on('error', (err) => {
      log.error('Error en stream de respuesta:', err)
      if (writer && !writer.destroyed) {
        writer.destroy()
      }
      if (progressStream && !progressStream.destroyed) {
        progressStream.destroy()
      }
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          fileName: fileName || 'downloaded-file',
          percentage: 0,
          error: err.message || 'Error en la descarga'
        })
      }
    })
    
    // Manejo de errores en el progressStream
    progressStream.on('error', (err) => {
      log.error('Error en progressStream:', err)
      if (writer && !writer.destroyed) {
        writer.destroy()
      }
      if (responseStream && !responseStream.destroyed) {
        responseStream.destroy()
      }
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          fileName: fileName || 'downloaded-file',
          percentage: 0,
          error: err.message || 'Error en el progreso de descarga'
        })
      }
    })
    
    // Monitorear el progreso de descarga en el stream intermedio
    progressStream.on('data', (chunk) => {
      downloadedSize += chunk.length
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        const percentage = totalSize > 0 ? Math.min(100, Math.round((downloadedSize / totalSize) * 100)) : 0
        mainWindow.webContents.send('download-progress', {
          fileName: fileName || 'downloaded-file',
          percentage,
          downloaded: downloadedSize,
          total: totalSize
        })
      }
    })
    
    // Pipe el stream de respuesta a través del stream de progreso y luego al writer
    responseStream.pipe(progressStream).pipe(writer)
    
    return new Promise((resolve, reject) => {
      // Timeout de seguridad (30 minutos máximo)
      const timeout = setTimeout(() => {
        log.error('Timeout en descarga de archivo')
        if (writer && !writer.destroyed) writer.destroy()
        if (progressStream && !progressStream.destroyed) progressStream.destroy()
        if (responseStream && !responseStream.destroyed) responseStream.destroy()
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            fileName: fileName || 'downloaded-file',
            percentage: 0,
            error: 'Timeout en la descarga'
          })
        }
        reject({ success: false, error: 'Timeout en la descarga' })
      }, 30 * 60 * 1000)
      
      writer.on('finish', () => {
        clearTimeout(timeout)
        // Enviar evento de finalización
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            fileName: fileName || 'downloaded-file',
            percentage: 100,
            downloaded: totalSize || downloadedSize,
            total: totalSize || downloadedSize
          })
        }
        
        // En Linux, mostrar notificación de descarga completada
        if (process.platform === 'linux') {
          try {
            const displayName = path.basename(filePath)
            new Notification({
              title: 'Descarga completada',
              body: `${displayName}\nGuardado en: ${path.dirname(filePath)}`,
              silent: false
            }).show()
          } catch (notifError) {
            log.warn('No se pudo mostrar notificación de completado:', notifError)
          }
        }
        
        resolve({ success: true })
      })
      
      writer.on('error', (e) => {
        clearTimeout(timeout)
        log.error('Error en writer:', e)
        // Limpiar streams
        if (progressStream && !progressStream.destroyed) progressStream.destroy()
        if (responseStream && !responseStream.destroyed) responseStream.destroy()
        // Enviar evento de error
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            fileName: fileName || 'downloaded-file',
            percentage: 0,
            error: e.message || 'Error al escribir archivo'
          })
        }
        reject({ success: false, error: e.message || 'Error al escribir archivo' })
      })
      
      // Manejar cierre del stream de respuesta
      responseStream.on('end', () => {
        // El stream terminó, esperar a que el writer termine
      })
    })
  } catch (e) {
    log.error('Error en download-file:', e)
    // Limpiar recursos en caso de error
    try {
      if (writer && !writer.destroyed) writer.destroy()
      if (progressStream && !progressStream.destroyed) progressStream.destroy()
      if (responseStream && !responseStream.destroyed) responseStream.destroy()
    } catch (cleanupError) {
      log.error('Error limpiando recursos:', cleanupError)
    }
    
    // Enviar evento de error en caso de excepción
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        fileName: fileName || 'downloaded-file',
        percentage: 0,
        error: e.message || 'Error desconocido'
      })
    }
    return { success: false, error: e.message || 'Error desconocido' }
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

// SQL Editor IPC handlers
ipcMain.handle('sql-execute-query', async (_, query) => {
  try {
    const result = db.executeQuery(query)
    return { success: true, result }
  } catch (error) {
    return { success: false, error: error.message || 'Error al ejecutar consulta' }
  }
})

ipcMain.handle('sql-list-tables', async () => {
  try {
    const tables = db.listTables()
    return { success: true, tables }
  } catch (error) {
    return { success: false, tables: [], error: error.message }
  }
})

ipcMain.handle('sql-get-table-info', async (_, tableName) => {
  try {
    const info = db.getTableInfo(tableName)
    return { success: true, info }
  } catch (error) {
    return { success: false, info: null, error: error.message }
  }
})

ipcMain.on('sql-execute-query', (event, query) => {
  try {
    const result = db.executeQuery(query)
    event.sender.send('query-result', result)
  } catch (error) {
    event.sender.send('query-error', error.message || 'Error al ejecutar consulta')
  }
})

ipcMain.on('sql-list-tables', (event) => {
  try {
    const tables = db.listTables()
    event.sender.send('tables-list', tables)
  } catch (error) {
    event.sender.send('tables-list', [])
  }
})

ipcMain.on('sql-get-table-info', (event, tableName) => {
  try {
    const info = db.getTableInfo(tableName)
    event.sender.send('table-info', info)
  } catch (error) {
    event.sender.send('table-info', null)
  }
})

ipcMain.on('window-minimize', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.minimize()
    }
  } catch (e) {
    // Ignore
  }
})

ipcMain.on('window-close', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.close()
    }
  } catch (e) {
    // Ignore
  }
})

// Función para abrir el editor SQL
function openSQLEditor() {
  try {
    const sqlWindow = new BrowserWindow({
      width: 1200,
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
        sandbox: false,
        devTools: !app.isPackaged
      }
    })
    
    try {
      childWindows.add(sqlWindow)
      sqlWindow.on('closed', () => {
        try { childWindows.delete(sqlWindow) } catch {}
      })
    } catch {}
    
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    
    // Centrar la ventana
    const x = Math.round(wa.x + (wa.width - 1200) / 2)
    const y = Math.round(wa.y + (wa.height - 800) / 2)
    sqlWindow.setBounds({ x, y, width: 1200, height: 800 })
    
    // Ruta del editor SQL
    const editorPath = app.isPackaged
      ? path.join(app.getAppPath(), 'viewer', 'sql-editor.html')
      : path.join(__dirname, 'viewer', 'sql-editor.html')
    
    sqlWindow.loadFile(editorPath)
    
    // Los eventos de cerrar/minimizar se manejan a través de IPC
    
    return sqlWindow
  } catch (err) {
    console.error('[MAIN] Error abriendo editor SQL', err)
    return null
  }
}
