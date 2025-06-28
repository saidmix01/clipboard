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
const qs = require('qs'); // Asegúrate de tenerlo: npm install qs
const historyPath = path.join(os.homedir(), '.clipboard-history.json')

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

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    alwaysOnTop: true,
    resizable: false, // ✅ importante: no redimensionable
    show: false,
    hasShadow: true, // ✅ sombra opcional
    webPreferences: {
      preload: path.join(__dirname, 'frontend', 'preload.js'),
      contextIsolation: true
    }
  })

  mainWindow.loadURL('http://localhost:5173')
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

    setInterval(() => {
      const image = clipboard.readImage()
      const text = clipboard.readText()

      // --- Si hay nueva imagen ---
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        if (dataUrl !== lastImageDataUrl && !history.includes(dataUrl)) {
          lastImageDataUrl = dataUrl
          history.unshift(dataUrl)
          if (history.length > 200) history.pop()

          // Guardar
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
          return // 🔁 No procesar texto si ya se procesó imagen
        }
      }

      // --- Si hay nuevo texto ---
      if (text && text !== lastText && !text.startsWith('data:image')) {
        lastText = text
        history.unshift(text)
        if (history.length > 200) history.pop()

        // Guardar
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

ipcMain.on('copy-image', (_, dataUrl) => {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    console.log('📋 Imagen copiada al portapapeles')
  } catch (err) {
    console.error('❌ Error al copiar imagen:', err)
  }
})

ipcMain.handle('translate-to-english', async (_, text) => {
  try {
    const params = new URLSearchParams();
    params.append('text', text);
    params.append('source_lang', 'ES');
    params.append('target_lang', 'EN');

    const response = await axios.post('https://api-free.deepl.com/v2/translate', params, {
      headers: {
        'Authorization': 'DeepL-Auth-Key 51c9648c-92ca-47d5-9e3f-7382148e6089:fx', // Reemplaza con tu clave real
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data.translations[0].text;
  } catch (error) {
    console.error('Error en traducción:', error.response?.data || error.message);
    return 'Error de traducción';
  }
});



