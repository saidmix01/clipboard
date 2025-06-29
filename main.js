const {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen
} = require('electron')
const path = require('path')
const axios = require('axios')
const fs = require('fs')
const os = require('os')
const historyPath = path.join(os.homedir(), '.clipboard-history.json')
const { exec, execFile } = require('child_process')

let mainWindow
let history = []

// Cargar historial guardado
if (fs.existsSync(historyPath)) {
  try {
    const data = fs.readFileSync(historyPath, 'utf-8')
    history = JSON.parse(data)
    console.log('✅ Historial cargado:', history.length, 'entradas')
  } catch (err) {
    console.error('❌ Error al leer historial:', err)
  }
}

//Pegado de texto

function performPaste (mainWindow) {
  const platform = process.platform
  const isDev = !app.isPackaged

  // ✅ Ocultar ventana para devolver foco a la anterior app
  if (mainWindow && mainWindow.hide) mainWindow.hide()

  console.log(`📌 Plataforma: ${platform}`)
  console.log(`📦 Entorno: ${isDev ? 'desarrollo' : 'producción'}`)

  if (platform === 'win32') {
    const exePath = isDev
      ? path.join(__dirname, 'helpers', 'paste.exe')
      : path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'helpers',
          'paste.exe'
        )

    console.log('📁 Ejecutando:', exePath)

    execFile(exePath, err => {
      if (err) {
        console.error('❌ Error al ejecutar paste.exe:', err)
      } else {
        console.log('✅ paste.exe ejecutado correctamente')
      }
    })
  } else if (platform === 'darwin') {
    // macOS: comando AppleScript
    setTimeout(() => {
      exec(
        `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
        err => {
          if (err) console.error('❌ Error ejecutando osascript:', err)
          else console.log('✅ Comando pegado en macOS')
        }
      )
    }, 300)
  } else if (platform === 'linux') {
    // Linux: requiere que xdotool esté instalado
    setTimeout(() => {
      exec('xdotool key ctrl+v', err => {
        if (err) {
          console.error('❌ Error ejecutando xdotool:', err)
        } else {
          console.log('✅ Pegado automático en Linux')
        }
      })
    }, 300)
  } else {
    console.warn('⚠️ Plataforma no compatible')
  }
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    alwaysOnTop: true,
    resizable: false, // ✅ importante: no redimensionable
    icon: path.join(__dirname, 'public', 'icon.ico'), // Usa .ico en Windows
    show: false,
    hasShadow: true, // ✅ sombra opcional
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false // ✅ este debe ser false si usas contextBridge
    }
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('clipboard-update', history)
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.setContentSize(360, 500) // 👈 ajustado al tamaño real del card
  })

  // Evitar cerrar: solo ocultar
  mainWindow.on('close', event => {
    event.preventDefault()
    mainWindow.hide()
  })
}

app.whenReady().then(() => {
  createWindow()

  const pollClipboard = () => {
    let lastText = clipboard.readText()
    let lastImageDataUrl = ''

    // --- Cargar historial desde disco y eliminar duplicados ---
    if (fs.existsSync(historyPath)) {
      try {
        const data = fs.readFileSync(historyPath, 'utf-8')
        const rawHistory = JSON.parse(data)
        // Eliminar duplicados manteniendo el orden
        history = [...new Set(rawHistory)]
        console.log('✅ Historial cargado:', history.length, 'entradas únicas')
      } catch (err) {
        console.error('❌ Error al leer historial:', err)
      }
    }

    setInterval(() => {
      const image = clipboard.readImage()
      const text = clipboard.readText()

      // --- Si hay nueva imagen ---
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        if (dataUrl !== lastImageDataUrl && !history.includes(dataUrl)) {
          lastImageDataUrl = dataUrl
          history.unshift(dataUrl)
          history = [...new Set(history)]
          if (history.length > 200) history.length = 200

          try {
            fs.writeFileSync(
              historyPath,
              JSON.stringify(history, null, 2),
              'utf-8'
            )
          } catch (err) {
            console.error('❌ Error al guardar historial:', err)
          }

          mainWindow.webContents.send('clipboard-update', history)
          return // ⚠️ No seguir si ya se procesó imagen
        }
      }

      // --- Si hay nuevo texto ---
      if (text && !text.startsWith('data:image') && !history.includes(text)) {
        lastText = text
        history.unshift(text)
        history = [...new Set(history)]
        if (history.length > 200) history.length = 200

        try {
          fs.writeFileSync(
            historyPath,
            JSON.stringify(history, null, 2),
            'utf-8'
          )
        } catch (err) {
          console.error('❌ Error al guardar historial:', err)
        }

        mainWindow.webContents.send('clipboard-update', history)
      }
    }, 1000)
  }

  pollClipboard()

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    const mousePos = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(mousePos)

    const windowWidth = 300
    const windowHeight = 400

    let x = mousePos.x - windowWidth / 2
    let y = mousePos.y + 20

    // Asegurar que no se salga de pantalla horizontalmente
    if (x + windowWidth > display.workArea.x + display.workArea.width) {
      x = display.workArea.x + display.workArea.width - windowWidth
    }
    if (x < display.workArea.x) {
      x = display.workArea.x
    }

    // Si no cabe abajo, mostrar arriba
    if (y + windowHeight > display.workArea.y + display.workArea.height) {
      y = mousePos.y - windowHeight - 20
    }

    mainWindow.setContentSize(400, 500) // o lo que midas exactamente tu card
    mainWindow.setBounds({ x, y, width: 400, height: 500 })

    mainWindow.show()
    mainWindow.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.setLoginItemSettings({
  openAtLogin: true,
  path: process.execPath
})

ipcMain.handle('get-clipboard-history', () => {
  return history
})

ipcMain.handle('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide()
  }
})

ipcMain.on('copy-to-clipboard', (_, text) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
})
//limpiar historial
ipcMain.handle('clear-history', () => {
  history = []

  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8')
    mainWindow.webContents.send('clipboard-update', history)
    console.log('🗑️ Historial borrado')
  } catch (err) {
    console.error('❌ Error al borrar historial:', err)
  }
})

const { nativeImage } = require('electron')
//copiar imagen
ipcMain.on('copy-image', (_, dataUrl) => {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    console.log('📋 Imagen copiada al portapapeles')
  } catch (err) {
    console.error('❌ Error al copiar imagen:', err)
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
