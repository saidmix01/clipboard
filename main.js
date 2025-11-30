const {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  nativeImage
} = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const path = require('path')
const axios = require('axios')
const fs = require('fs')
const os = require('os')
const legacyHistoryPath = path.join(os.homedir(), '.clipboard-history.json')
const { exec, execFile } = require('child_process')

let mainWindow
let history = []

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

// Cargar historial guardado
if (fs.existsSync(legacyHistoryPath)) {
  try {
    const data = fs.readFileSync(legacyHistoryPath, 'utf-8')
    history = normalizeHistory(JSON.parse(data))
    log.info('Historial cargado', { count: history.length })
  } catch (err) {
    log.error('Error al leer historial', err)
  }
}

if (!fs.existsSync(legacyHistoryPath)) {
  try {
    const alt1 = path.join(__dirname, '.clipboard-history.json')
    const alt2 = path.join(__dirname, 'clipboard-history.json')
    const src = [alt1, alt2].find(p => fs.existsSync(p))
    if (src) {
      const data = fs.readFileSync(src, 'utf-8')
      history = normalizeHistory(JSON.parse(data))
      fs.writeFileSync(legacyHistoryPath, JSON.stringify(history, null, 2), 'utf-8')
      log.info('Historial importado', { count: history.length })
    }
  } catch (err) {
    log.error('Error importando historial', err)
  }
}

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
    // Linux: requiere que xdotool esté instalado
    setTimeout(() => {
      exec('xdotool key ctrl+v', err => {
        if (err) {
          log.error('Error ejecutando xdotool', err)
        } else {
          log.info('Pegado automático en Linux')
        }
      })
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
    // Linux: usa xdotool para Ctrl+V
    setTimeout(() => {
      exec('xdotool key ctrl+v', err => {
        if (err) {
          log.error('Error pegando imagen en Linux con xdotool', err)
        } else {
          log.info('Imagen pegada en Linux')
        }
      })
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
    icon: path.join(__dirname, 'public', 'icon.ico'), // Usa .ico en Windows
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
      history = normalizeHistory(history)
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
  })

  // Evitar cierre completo
  mainWindow.on('close', event => {
    event.preventDefault()
    mainWindow.hide()
  })
}

app.whenReady().then(() => {
  createWindow()
  autoUpdater.forceDevUpdateConfig = true
  try {
    const cfg = readDeviceConfigObj()
    if (Array.isArray(cfg.history)) {
      history = normalizeHistory(cfg.history)
      log.info('Historial (device) cargado', { count: history.length })
    } else if (fs.existsSync(legacyHistoryPath)) {
      const data = fs.readFileSync(legacyHistoryPath, 'utf-8')
      const parsed = JSON.parse(data)
      cfg.history = normalizeHistory(parsed)
      writeDeviceConfigObj(cfg)
      history = cfg.history
      log.info('Historial migrado desde legacy')
    }
  } catch (err) {
    log.error('Error al leer historial (device)', err)
  }

  const pollClipboard = () => {
    let lastImageDataUrl = ''

    // Normalizar historial ya cargado y enviar al renderer inmediatamente
    try {
      history = Array.isArray(history) ? normalizeHistory(history) : []
    } catch {
      history = []
    }

    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }

    setInterval(() => {
      const image = clipboard.readImage()
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
          dataUrl === lastImageDataUrl || // repetida
          history.some(
            item => typeof item === 'object' && item.value === dataUrl
          )
        ) {
          return
        }

        lastImageDataUrl = dataUrl
        history.unshift({ value: dataUrl, favorite: false })

        // Eliminar duplicados y ordenar; no recortar a 50 al guardar
        history = history
          .filter(item => item && typeof item.value === 'string')
          .sort((a, b) => Number(b.favorite) - Number(a.favorite))

        if (history.length > 200) history.length = 200

        writeDeviceHistory(history)
        mainWindow.webContents.send('clipboard-update', history)
        return
      }

      // --- Si hay nuevo texto ---
      if (
        typeof text === 'string' &&
        text.trim() !== '' &&
        !history.some(item => item.value === text)
      ) {
        history.unshift({ value: text, favorite: false })

        // Eliminar duplicados de texto
        history = history.filter(
          (item, index, self) =>
            index === self.findIndex(t => t.value === item.value)
        )

        if (history.length > 200) history.length = 200

        writeDeviceHistory(history)

        mainWindow.webContents.send('clipboard-update', history)
      }
    }, 1000)
  }

  pollClipboard()

  globalShortcut.register('Alt+X', () => {
    const display = screen.getPrimaryDisplay()
    const screenWidth = display.workArea.width
    const screenHeight = display.workArea.height

    const windowWidth = 400
    const windowHeight = screenHeight
    const x = screenWidth - windowWidth
    const y = 0

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

app.setLoginItemSettings({
  openAtLogin: true,
  path: process.execPath
})

// Evento para forzar la actualización desde el frontend
ipcMain.on('force-update', () => {
  log.info('🧪 Botón forzó búsqueda de actualización...')
  autoUpdater.checkForUpdates()
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
    writeDeviceHistory(history)
    mainWindow.webContents.send('clipboard-update', history)
    log.info('Historial borrado')
  } catch (err) {
    log.error('Error al borrar historial', err)
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
    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      resizable: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00FFFFFF',
      hasShadow: true,
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    })
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const mainBounds = mainWindow?.getBounds() || { width: 400, x: wa.x + wa.width - 400, y: wa.y, height: wa.height }
    const viewerWidth = Math.max(300, wa.width - mainBounds.width)
    win.setBounds({ x: wa.x, y: wa.y, width: viewerWidth, height: wa.height })
    const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh;color:#ddd;font-family:system-ui}#wrap{position:relative;cursor:crosshair}#img{max-width:95vw;max-height:95vh;border-radius:6px;user-select:none;cursor:crosshair}#sel{position:absolute;border:2px solid #00aaff;background:rgba(0,170,255,0.2);display:none;pointer-events:none}#panel{position:fixed;top:10px;left:10px;background:#222;border:1px solid #333;border-radius:6px;padding:8px;display:flex;gap:8px;align-items:center}button{background:#333;border:1px solid #444;color:#eee;padding:6px 10px;border-radius:4px;cursor:pointer}button:disabled{opacity:.6;cursor:not-allowed}#res{position:fixed;bottom:10px;left:10px;right:10px;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px;max-height:40vh;overflow:auto;white-space:pre-wrap}</style></head><body><div id="panel"><button id="ocr" disabled>OCR selección</button><button id="copy" disabled>Copiar</button><span id="status"></span></div><div id="wrap"><img id="img" src="${dataUrl}"/><div id="sel"></div></div><div id="res" style="display:none"></div><script src="https://unpkg.com/tesseract.js@v4.0.3/dist/tesseract.min.js"></script><script>const img=document.getElementById('img');const sel=document.getElementById('sel');const ocrBtn=document.getElementById('ocr');const copyBtn=document.getElementById('copy');const statusEl=document.getElementById('status');const resEl=document.getElementById('res');let start=null;let rect=null;function px(n){return Math.round(n)+'px'}function setStatus(t){statusEl.textContent=t}function resetSel(){sel.style.display='none';ocrBtn.disabled=true;copyBtn.disabled=true;resEl.style.display='none';resEl.textContent='';rect=null}function within(e){const r=img.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom}window.addEventListener('mousedown',e=>{if(!within(e))return;const r=img.getBoundingClientRect();start={x:e.clientX,y:e.clientY};sel.style.display='block';sel.style.left=px(start.x);sel.style.top=px(start.y);sel.style.width='0px';sel.style.height='0px';setStatus('Seleccionando...')});window.addEventListener('mousemove',e=>{if(!start)return;const x=Math.min(e.clientX,start.x);const y=Math.min(e.clientY,start.y);const w=Math.abs(e.clientX-start.x);const h=Math.abs(e.clientY-start.y);sel.style.left=px(x);sel.style.top=px(y);sel.style.width=px(w);sel.style.height=px(h)});window.addEventListener('mouseup',e=>{if(!start)return;const r=img.getBoundingClientRect();const x=Math.min(e.clientX,start.x);const y=Math.min(e.clientY,start.y);const w=Math.abs(e.clientX-start.x);const h=Math.abs(e.clientY-start.y);start=null;if(w<5||h<5){resetSel();setStatus('');return}rect={x:x-r.left,y:y-r.top,w:w,h:h};ocrBtn.disabled=false;copyBtn.disabled=true;setStatus('Selección lista')});async function cropToCanvas(){const dispW=img.clientWidth;const dispH=img.clientHeight;const natW=img.naturalWidth;const natH=img.naturalHeight;const scaleX=natW/dispW;const scaleY=natH/dispH;const sx=Math.max(0,Math.round(rect.x*scaleX));const sy=Math.max(0,Math.round(rect.y*scaleY));const sw=Math.min(natW-sx,Math.round(rect.w*scaleX));const sh=Math.min(natH-sy,Math.round(rect.h*scaleY));const c=document.createElement('canvas');c.width=sw;c.height=sh;const ctx=c.getContext('2d');ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);return c}async function runOCR(){try{setStatus('Procesando...');const c=await cropToCanvas();const r=await Tesseract.recognize(c,'spa',{logger:m=>{}});resEl.style.display='block';resEl.textContent=r.data.text||'';copyBtn.disabled=!resEl.textContent.trim();setStatus('Listo')}catch(err){resEl.style.display='block';resEl.textContent='Error: '+(err&&err.message||'');copyBtn.disabled=true;setStatus('')}}ocrBtn.addEventListener('click',()=>{if(!rect)return;runOCR()});copyBtn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(resEl.textContent||'');setStatus('Copiado')}catch(e){setStatus('No se pudo copiar')}});img.addEventListener('load',()=>{resetSel();setStatus('')});</script></body></html>`
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    win.webContents.on('did-finish-load', () => {
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
    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      resizable: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00FFFFFF',
      hasShadow: true,
      show: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    })
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    const mainBounds = mainWindow?.getBounds() || { width: 400, x: wa.x + wa.width - 400, y: wa.y, height: wa.height }
    const viewerWidth = Math.max(300, wa.width - mainBounds.width)
    win.setBounds({ x: wa.x, y: wa.y, width: viewerWidth, height: wa.height })
    const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{margin:0;background:transparent}#window{position:fixed;inset:0;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(45,45,45,.85);backdrop-filter:blur(10px);box-shadow:0 8px 24px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}#header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.15);-webkit-app-region:drag;color:#eee}#title{font-size:14px;margin:0}#controls{display:flex;gap:8px;-webkit-app-region:no-drag}#controls button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#3a3a3a;border:1px solid #4a4a4a;color:#eee;border-radius:6px;cursor:pointer;transition:background .2s,border-color .2s,color .2s}#controls button:hover{border-color:#ff8c00;background:rgba(255,140,0,.25);color:#fff}#controls #close{background:#d32f2f;border-color:#b71c1c;color:#fff}#content{flex:1;position:relative;display:flex;flex-direction:column}#toolbar{display:flex;gap:8px;padding:8px;background:rgba(0,0,0,.25);border-bottom:1px solid rgba(255,255,255,.1)}#toolbar button{background:#3a3a3a;border:1px solid #4a4a4a;color:#eee;padding:6px 10px;border-radius:4px;cursor:pointer;transition:background .2s,border-color .2s,color .2s}#toolbar button:hover{border-color:#ff8c00;background:rgba(255,140,0,.25);color:#fff}#code{flex:1;margin:0;padding:12px;overflow:auto;background:transparent;color:#eee;font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.5;white-space:pre}</style></head><body><div id="window"><div id="header"><h5 id="title">📄 Código</h5><div id="controls"><button id="close">✕</button></div></div><div id="content"><div id="toolbar"><button id="copy">Copiar</button></div><pre id="code"></pre></div></div></body></html>`
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    win.webContents.on('did-finish-load', () => {
      const inj = `(()=>{const { clipboard } = require('electron');const code=${JSON.stringify(String(codeText||''))};const pre=document.getElementById('code');pre.textContent=code;const btnClose=document.getElementById('close');const btnCopy=document.getElementById('copy');if(btnClose){btnClose.addEventListener('click',()=>window.close())}if(btnCopy){btnCopy.addEventListener('click',()=>clipboard.writeText(code))}document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){window.close()}});})();`
      win.webContents.executeJavaScript(inj)
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
    writeDeviceHistory(updated)

    // También actualizamos la variable en memoria
    history = updated

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
//let BACKEND_URL = 'https://copyfy.webcolsoluciones.com.co'
let BACKEND_URL = 'http://localhost:3000'
try { BACKEND_URL = require('./config').BACKEND_URL || BACKEND_URL } catch {}
let authToken = null
let deviceId = null
let activeDeviceName = null

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
    const obj = readDeviceConfigObj()
    return normalizeHistory(obj.history || [])
  } catch {
    return []
  }
}

function writeDeviceHistory (hist) {
  try {
    const obj = readDeviceConfigObj()
    obj.history = normalizeHistory(hist)
    writeDeviceConfigObj(obj)
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
    const cfgPath = getDeviceConfigPathByName(rawName)
    if (!fs.existsSync(cfgPath)) return []
    const raw = fs.readFileSync(cfgPath, 'utf-8')
    const obj = JSON.parse(raw)
    return normalizeHistory(obj.history || [])
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
    const list = (data && typeof data === 'object' ? (data.data ?? data) : [])
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
    await syncClipboardHistory()
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
    const devHist = readDeviceHistoryByName(target)
    history = devHist
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }
    return devHist
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

async function saveClipboardRecord (type, value, meta = {}) {
  try {
    const axiosInstance = getAxiosInstance()
    const hostname = os.hostname()
    const id = deviceId || (await ensureDeviceRegistered())
    const payload = { type, value, meta, clientId: hostname, deviceId: id }
    log.info('clipboard save request', { type, deviceId: id })
    await axiosInstance.post('/clipboard', payload)
  } catch (error) {
    log.error('clipboard save error', error?.message || error)
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
    if (!authToken) return
    const axiosInstance = getAxiosInstance()
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

    const localItems = readLocalHistory()

    await ensureDeviceRegistered()

    const hostnameSan = sanitizeDeviceName(os.hostname())
    const activeSan = activeDeviceName ? sanitizeDeviceName(activeDeviceName) : hostnameSan
    const activeIsLocal = activeSan === hostnameSan

    if (activeIsLocal) {
      for (const it of localItems) {
        if (!it || typeof it.value !== 'string') continue
        const isImage = it.value.startsWith('data:image')
        const backend = backendByValue.get(it.value)
        if (!backend) {
          const type = isImage ? 'image' : 'text'
          const meta = isImage ? { format: 'dataURL' } : {}
          await saveClipboardRecord(type, it.value, meta)
        } else if (backend.favorite !== !!it.favorite) {
          await updateClipboardRecord(backend.id, { favorite: !!it.favorite })
        }
      }
    }

    let filtered = backendItems
    if (activeDeviceName) {
      const ident = await resolveDeviceIdentifiers(activeDeviceName)
      filtered = backendItems.filter(be => {
        if (ident.deviceId && be.deviceId) return String(be.deviceId) === String(ident.deviceId)
        if (ident.clientId && be.clientId) return String(be.clientId) === String(ident.clientId)
        return false
      })
    }

    const localValues = new Set(localItems.map(it => it.value))
    for (const be of filtered) {
      if (!localValues.has(be.value)) {
        history.unshift({ value: be.value, favorite: !!be.favorite })
      }
    }
    history = history
      .filter(item => item && typeof item.value === 'string')
      .filter((item, index, self) => index === self.findIndex(t => t.value === item.value))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite))
    if (history.length > 200) history.length = 200
    writeDeviceHistory(history)
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('clipboard-update', history)
    }

    log.info('syncClipboardHistory completo')
  } catch (error) {
    log.error('syncClipboardHistory error', error?.message || error)
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
    log.error('syncFavorites error', { message: error.message })
  }
}

// Dentro de app.whenReady()
setInterval(() => {
  syncFavorites()
}, 60000)

syncFavorites()

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
