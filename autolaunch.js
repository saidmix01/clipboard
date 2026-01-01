
const { app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const log = require('electron-log')

function configureAutoLaunch() {
  // Evitar configurar autostart en desarrollo
  if (!app.isPackaged) return 

  // Windows & macOS
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath
    })
    log.info('AutoLaunch configurado para Win/Mac')
  } 
  // Linux
  else if (process.platform === 'linux') {
    try {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart')
      if (!fs.existsSync(autostartDir)) {
        fs.mkdirSync(autostartDir, { recursive: true })
      }
      const desktopPath = path.join(autostartDir, 'copyfy.desktop')
      // En AppImage, process.execPath es el binario temporal, usar process.env.APPIMAGE
      const execPath = process.env.APPIMAGE || process.execPath
      
      const content = `[Desktop Entry]
Type=Application
Version=1.0
Name=CopyFy++
Comment=Clipboard Manager
Exec="${execPath}"
Icon=copyfy
StartupNotify=false
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
`
      fs.writeFileSync(desktopPath, content, 'utf-8')
      log.info('Linux autostart configurado', { path: desktopPath })
    } catch (e) {
      log.error('Linux autostart error', e)
    }
  }
}

module.exports = { configureAutoLaunch }
