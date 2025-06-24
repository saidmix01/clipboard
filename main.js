const {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen
} = require('electron')
const path = require('path')

let mainWindow
const history = []

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    transparent: false,
    backgroundColor: '#FFFFFF',
    alwaysOnTop: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'frontend', 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false, // opcional
      nodeIntegration: false // muy importante
    }
  })

  mainWindow.loadURL('http://localhost:5173')

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
    setInterval(() => {
      const current = clipboard.readText()
      if (current && current !== lastText) {
        lastText = current
        if (!history.includes(current)) {
          history.unshift(current)
          if (history.length > 20) history.pop()
          mainWindow.webContents.send('clipboard-update', history)
        }
      }
    }, 1000)
  }

  pollClipboard()

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    const mousePos = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(mousePos)

    const windowWidth = 400
    const windowHeight = 500

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

    mainWindow.setBounds({ x, y, width: windowWidth, height: windowHeight })
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
  const { clipboard } = require('electron');
  clipboard.writeText(text);
});

