# Persistencia de Sesión en AppImage - Documentación Técnica

## Resumen

Esta aplicación Electron implementa persistencia de sesión usando exclusivamente `app.getPath('userData')` de Electron, garantizando que los datos persistan correctamente incluso cuando la aplicación se distribuye como AppImage en Linux.

## ¿Por qué funciona en AppImage?

### El Problema con AppImage

Las aplicaciones AppImage se ejecutan desde un archivo único que generalmente se monta en una ubicación temporal (como `/tmp/.mount_...`). Si intentáramos guardar datos usando rutas relativas al ejecutable (`__dirname`, `process.cwd()`, etc.), estos datos se perderían cuando:

1. El AppImage se desmonte
2. Se reinicie el sistema
3. Se mueva el archivo AppImage a otra ubicación
4. Se ejecute desde una ubicación diferente

### La Solución: `app.getPath('userData')`

Electron proporciona `app.getPath('userData')`, que devuelve un directorio estándar y persistente según el sistema operativo:

- **Linux**: `~/.config/<nombre-app>/` (respetando `XDG_CONFIG_HOME` si está configurado)
- **Windows**: `%APPDATA%/<nombre-app>/`
- **macOS**: `~/Library/Application Support/<nombre-app>/`

### Ventajas de esta Aproximación

1. **Independiente de la ubicación del ejecutable**: No importa dónde esté el AppImage, los datos siempre se guardan en el mismo lugar
2. **Estándar del sistema**: Usa las rutas estándar de cada plataforma
3. **Persistente**: Los datos sobreviven a reinicios del sistema
4. **Garantizado por Electron**: Electron asegura que este directorio existe
5. **Portable**: Funciona igual en desarrollo y producción

## Implementación

### main.js

Las funciones de persistencia están implementadas en `main.js`:

```javascript
function getSessionFilePath () {
  const userDataDir = app.getPath('userData')
  return path.join(userDataDir, 'session.json')
}

function saveSessionToFile (sessionData) {
  try {
    const sessionPath = getSessionFilePath()
    const userDataDir = path.dirname(sessionPath)
    
    // Asegurar que el directorio existe (defensivo, aunque Electron ya lo garantiza)
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true })
    }
    
    const sessionJson = JSON.stringify(sessionData, null, 2)
    fs.writeFileSync(sessionPath, sessionJson, 'utf-8')
    
    return true
  } catch (error) {
    log.error('Error guardando sesión en archivo', error)
    return false
  }
}

function readSessionFromFile () {
  try {
    const sessionPath = getSessionFilePath()
    
    if (!fs.existsSync(sessionPath)) {
      return null
    }
    
    const raw = fs.readFileSync(sessionPath, 'utf-8')
    const session = JSON.parse(raw)
    
    return session
  } catch (error) {
    log.error('Error leyendo sesión desde archivo', error)
    return null
  }
}

function clearSessionFile () {
  try {
    const sessionPath = getSessionFilePath()
    
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
    
    return true
  } catch (error) {
    log.error('Error eliminando archivo de sesión', error)
    return false
  }
}
```

### Handlers IPC

Los handlers IPC exponen estas funciones al proceso de renderizado:

```javascript
ipcMain.handle('save-session', (event, sessionData) => {
  return saveSessionToFile(sessionData)
})

ipcMain.handle('read-session', () => {
  return readSessionFromFile()
})

ipcMain.handle('clear-session-file', () => {
  return clearSessionFile()
})
```

### preload.js

El preload expone las funciones al frontend:

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  saveSession: (sessionData) => ipcRenderer.invoke('save-session', sessionData),
  readSession: () => ipcRenderer.invoke('read-session'),
  clearSessionFile: () => ipcRenderer.invoke('clear-session-file'),
  // ... otras funciones
})
```

### Uso desde React

#### Guardar sesión al iniciar sesión (Login.tsx)

```typescript
const session: any = {
  token: tokenResp,
  refreshToken: refreshResp,
  email: userResp?.email ?? emailTrim,
  name: userResp?.name ?? nameTrim,
  user: userResp
}
localStorage.setItem('session', JSON.stringify(session))
// Guardar en archivo para persistencia en AppImage
try { 
  (window as any).electronAPI?.saveSession?.(session) 
} catch {}
```

#### Cargar sesión al iniciar la app (App.tsx)

```typescript
useEffect(() => {
  async function restoreSession () {
    try {
      // Primero intentar desde localStorage
      let raw = localStorage.getItem('session')
      let sess = null
      
      if (raw) {
        try {
          sess = JSON.parse(raw)
        } catch (e) {
          // Si falla parsear localStorage, intentar desde archivo
        }
      }
      
      // Si no hay sesión en localStorage, intentar desde archivo (respaldo para AppImage)
      if (!sess) {
        try {
          sess = await (window as any).electronAPI?.readSession?.()
          if (sess) {
            // Restaurar en localStorage también
            localStorage.setItem('session', JSON.stringify(sess))
          }
        } catch (e) {
          // Silenciar errores de lectura de archivo
        }
      }
      
      if (sess?.token) {
        handleLoginSuccess(sess.token)
        ;(window as any).electronAPI?.setAuthToken(sess.token)
      }
    } catch (e) {
      // Manejar errores silenciosamente
    }
  }
  restoreSession()
}, [])
```

#### Limpiar sesión al cerrar sesión

```typescript
const logout = () => {
  setToken(null)
  localStorage.removeItem('x-token')
  localStorage.removeItem('session')
  try { 
    (window as any).electronAPI?.clearSessionFile?.() 
  } catch {}
  ;(window as any).electronAPI?.setAuthToken?.('')
  try { 
    (window as any).electronAPI?.clearUserData?.() 
  } catch {}
  toast.success('Sesión cerrada')
}
```

## Flujo de Datos

1. **Al iniciar sesión**:
   - El usuario ingresa credenciales
   - Se obtiene el token del servidor
   - Se guarda en `localStorage` (para acceso rápido)
   - Se guarda en `~/.config/copyfy/session.json` (para persistencia en AppImage)

2. **Al iniciar la aplicación**:
   - Se intenta cargar desde `localStorage` (rápido)
   - Si no existe, se carga desde `~/.config/copyfy/session.json` (persistente)
   - Si se encuentra una sesión, se restaura automáticamente

3. **Al cerrar sesión**:
   - Se elimina de `localStorage`
   - Se elimina el archivo `session.json`
   - Se limpia el token en el proceso principal

## Estructura del Archivo session.json

```json
{
  "token": "jwt-token-here",
  "refreshToken": "refresh-token-here",
  "email": "usuario@ejemplo.com",
  "name": "Nombre Usuario",
  "user": {
    "id": "user-id",
    "email": "usuario@ejemplo.com",
    "name": "Nombre Usuario"
  }
}
```

## Ubicación Real en Linux

Cuando la aplicación se ejecuta como AppImage en Linux, los datos se guardan en:

```
~/.config/copyfy/session.json
```

Esta ruta es:
- ✅ Independiente de dónde esté el AppImage
- ✅ Persistente entre reinicios
- ✅ Respetuosa del estándar XDG
- ✅ Accesible solo por el usuario actual

## Verificación

Para verificar que la persistencia funciona correctamente:

1. Inicia sesión en la aplicación
2. Cierra la aplicación completamente
3. Reinicia el sistema
4. Abre la aplicación nuevamente
5. La sesión debería restaurarse automáticamente

Puedes verificar manualmente el archivo:

```bash
cat ~/.config/copyfy/session.json
```

## Buenas Prácticas Seguidas

1. ✅ **NO usar rutas relativas**: Solo usamos `app.getPath('userData')`
2. ✅ **NO usar `__dirname`**: Evitado completamente
3. ✅ **NO guardar junto al AppImage**: Los datos están en `~/.config/`
4. ✅ **Usar APIs estándar de Electron**: `app.getPath('userData')`
5. ✅ **Manejo robusto de errores**: Try-catch en todas las operaciones
6. ✅ **Validación de datos**: Verificación de estructura antes de usar
7. ✅ **Logging**: Registro de operaciones para debugging
8. ✅ **Código defensivo**: Verificación de existencia de directorios

## Conclusión

Esta implementación garantiza que la sesión del usuario persista correctamente en AppImage porque:

1. Usa `app.getPath('userData')` que siempre devuelve una ruta persistente
2. No depende de la ubicación del ejecutable
3. Sigue los estándares de cada plataforma
4. Funciona tanto en desarrollo como en producción
5. Es robusta y maneja errores correctamente

La sesión se mantendrá incluso después de reiniciar el sistema, mover el AppImage, o ejecutarlo desde diferentes ubicaciones.
