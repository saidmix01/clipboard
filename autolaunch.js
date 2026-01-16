
const { app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const log = require('electron-log')

function configureAutoLaunch() {
  log.info('Configurando AutoLaunch...')

  // Evitar configurar autostart en desarrollo salvo que se fuerce
  if (!app.isPackaged && !process.env.FORCE_AUTOLAUNCH) {
    log.info('AutoLaunch omitido en desarrollo (app no empaquetada)')
    return 
  }

  // Windows & macOS
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      const currentSettings = app.getLoginItemSettings()
      log.info('Estado previo del LoginItem:', currentSettings)

      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: [] // Asegurar sin argumentos extraños
      })
      
      const newSettings = app.getLoginItemSettings()
      log.info('Nuevo estado del LoginItem:', newSettings)

      if (newSettings.openAtLogin) {
        log.info('AutoLaunch configurado correctamente para Win/Mac')
      } else {
        log.warn('AutoLaunch: openAtLogin es false tras configurar. Puede requerir permisos o aprobación del usuario.')
      }
    } catch (error) {
      log.error('Error al configurar AutoLaunch:', error)
    }
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
