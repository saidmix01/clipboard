const { screen } = require('electron');
const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain
} = require('electron')
const path = require('path')

let mainWindow
let clipboardHistory = []

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 400,
    frame: false,
    transparent: false, // desactivamos porque Windows no lo renderiza bien
    backgroundColor: '#FFFFFF', // fondo blanco estándar
    alwaysOnTop: false,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'frontend', 'preload.js'),
      contextIsolation: true
    }
  })

  mainWindow.on('close', event => {
    event.preventDefault()
    mainWindow.hide()
  })

  mainWindow.loadURL('http://localhost:5173')
}

app.whenReady().then(() => {
  createWindow()

  let lastText = clipboard.readText()

  setInterval(() => {
    const currentText = clipboard.readText()
    if (
      currentText &&
      currentText !== lastText &&
      !clipboardHistory.includes(currentText)
    ) {
      lastText = currentText
      clipboardHistory.unshift(currentText)
      if (clipboardHistory.length > 50) clipboardHistory.pop() // Limita el historial

      // Enviamos al frontend
      mainWindow.webContents.send('clipboard:update', clipboardHistory)
    }
  }, 1000) // Verifica el portapapeles cada segundo

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    const mousePos = screen.getCursorScreenPoint()

    const windowBounds = mainWindow.getBounds()

    mainWindow.setBounds({
      x: mousePos.x - windowBounds.width / 2,
      y: mousePos.y + 20, // Un poco más abajo del cursor
      width: windowBounds.width,
      height: windowBounds.height
    })

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
