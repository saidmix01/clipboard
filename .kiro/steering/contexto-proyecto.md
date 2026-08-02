# CopyFy++ — Contexto Completo del Proyecto

## ¿Qué es CopyFy++?

Gestor de portapapeles con sincronización en la nube. App de escritorio Electron que:
- Captura automáticamente texto, imágenes y archivos del portapapeles del sistema
- Persiste todo localmente en SQLite (sql.js) en `userData`
- Sincroniza con un backend REST Node.js/PostgreSQL desplegado en `https://copyfy.webcolsoluciones.com.co`
- Soporta múltiples dispositivos por usuario
- Interfaz React embebida dentro de Electron

---

## Arquitectura General

```
clipboard/                    ← Proyecto Electron (Desktop App)
├── main.ts / main.js         ← Main process: ventanas, IPC handlers, clipboard watcher
├── preload.ts / preload.js   ← Puente seguro contextBridge → expone window.electronAPI
├── db.js                     ← DB SQLite local con sql.js (NO mejor-sqlite3)
├── autolaunch.js             ← Configurar inicio automático
├── backend/
│   ├── BackendDaemon.ts      ← Singleton: Axios con auth, refresh token, IPC handlers
│   ├── SyncEngine.ts         ← Sincronización bidireccional horaria (PUSH/PULL/Conflictos)
│   ├── SyncQueue.ts          ← Cola persistente de operaciones de sync (en memoria + DB)
│   ├── ConflictResolver.ts   ← Estrategia Last-Write-Wins por timestamp
│   └── NetworkMonitor.ts     ← Detecta online/offline cada 30s via net.request a Google
├── frontend/                 ← App React 19 + Vite + TypeScript
│   └── src/
│       ├── App.tsx           ← Componente raíz: estado global, fetch de datos, modales
│       ├── main.tsx          ← Entry point: routing por ?mode= (app/ocr/code/notification)
│       ├── Login.tsx         ← Modal de login/registro (fetch directo a API_BASE)
│       ├── UserModal.tsx     ← Modal de perfil de usuario
│       ├── config.ts         ← API_BASE = 'https://copyfy.webcolsoluciones.com.co'
│       ├── types.ts          ← HistoryItem, FilterType
│       ├── api/backend.ts    ← backendRequest() via IPC → BackendDaemon.request()
│       └── components/
│           ├── AppShell.tsx
│           ├── TopBar.tsx
│           ├── Dock.tsx       ← Tabs: text | image | favorite | documents
│           ├── Card.tsx       ← Item del historial (memo, detecta código/imagen/texto)
│           ├── HistoryList.tsx ← Lista con infinite scroll
│           ├── FileList.tsx   ← Lista de archivos subidos
│           ├── SettingsMenu.tsx ← Configuración + sincronización manual
│           ├── DeviceSelectionModal.tsx ← Seleccionar dispositivo activo
│           ├── DeviceRegistrationModal.tsx
│           ├── LazyImage.tsx  ← Carga lazy de imágenes locales
│           ├── OCRWindow.tsx / OCRModal.tsx
│           ├── CodeWindow.tsx
│           └── NotificationWindow.tsx ← Ventana pequeña para captura imagen/archivo
└── viewer/                   ← Ventanas auxiliares HTML standalone (code-editor, sql-editor)

backend-copyfy/               ← Backend REST Node.js + Express + Sequelize + PostgreSQL
└── src/
    ├── app.js                ← Express config, rutas montadas
    ├── server.js             ← Arranque, Sequelize.authenticate, cron jobs
    ├── config/config.js      ← Variables de entorno
    ├── models/               ← Sequelize models (User, Device, ClipboardItem, Session, File, etc.)
    ├── controllers/          ← Lógica de negocio por entidad
    ├── routes/               ← Express routers
    ├── migrations/           ← Sequelize CLI migrations
    └── services/             ← auth, crypto, quota, sync, email, cron, storage
```

---

## Base de Datos Local SQLite (db.js)

Usa `sql.js` (WebAssembly), NO `better-sqlite3`. La DB se persiste manualmente a disco con `fs.writeFileSync`.

### Tablas

**ClipboardItem**
```sql
CREATE TABLE ClipboardItem (
  Id TEXT PRIMARY KEY,          -- UUID generado localmente
  Value TEXT,                   -- Contenido (texto, base64, o '[LOCAL_IMAGE]:path')
  Type TEXT,                    -- 'text' | 'image'
  IsFavorite BOOLEAN DEFAULT 0,
  CreatedAt DATETIME,
  UpdatedAt DATETIME,
  IsDeleted BOOLEAN DEFAULT 0,  -- Soft delete
  Pending BOOLEAN DEFAULT 0,    -- 0=sincronizado, 1=pendiente sync, 2=conflicto
  DeviceId TEXT,                -- FK lógica a Devices.Id
  Version INTEGER DEFAULT 1,
  Meta TEXT                     -- JSON temporal para datos de conflicto remoto
);
-- Índices: idx_clipboard_created, idx_clipboard_favorite, idx_clipboard_device, idx_clipboard_pending
```

**Devices**
```sql
CREATE TABLE Devices (
  Id TEXT PRIMARY KEY,          -- UUID
  OsName TEXT,                  -- 'win32' | 'darwin' | 'linux'
  Name TEXT,                    -- Hostname o nombre elegido por usuario
  VersionApp TEXT,
  Synced BOOLEAN DEFAULT 0,
  LastSync DATETIME,
  CreatedAt DATETIME,
  UpdatedAt DATETIME
);
```

**AppSettings** (siempre 1 sola fila)
```sql
CREATE TABLE AppSettings (
  Id TEXT PRIMARY KEY,
  AccessToken TEXT,             -- JWT actual
  RefreshToken TEXT,
  IsDarkMode BOOLEAN DEFAULT 0,
  Theme TEXT,                   -- JSON con colores personalizados
  Language TEXT,
  UiScale REAL,
  GlobalShortcut TEXT,          -- Default: 'Alt+X'
  SelectedDeviceId TEXT,        -- Dispositivo activo seleccionado
  LocalDeviceId TEXT,           -- Dispositivo de esta máquina
  CreatedAt DATETIME,
  UpdatedAt DATETIME
);
```

**SyncQueue**
```sql
CREATE TABLE SyncQueue (
  Id TEXT PRIMARY KEY,
  OperationType TEXT,           -- 'CREATE' | 'UPDATE' | 'DELETE'
  ItemId TEXT,
  ItemData TEXT,                -- JSON del item
  Timestamp INTEGER,
  Retries INTEGER DEFAULT 0,
  NextRetryAt INTEGER,
  CreatedAt DATETIME
);
```

### Funciones clave de db.js
- `init(app)` — Inicializa sql.js, crea tablas, aplica migraciones inline
- `insertItem(value, type, deviceId, options)` — Deduplicación por (Value, Type, DeviceId)
- `getItems(limit, offset, filter)` — Soporta filter.favorite, filter.type, filter.search, filter.deviceId
- `getSettings()` / `updateSettings(settings)` — Case-insensitive con helper `getVal()`
- `registerDevice(deviceInfo)` — Upsert con merge por (Name+OsName) y migración de IDs
- `setActiveDevice(id)` — Escribe SelectedDeviceId en AppSettings
- `ensureLocalDevice()` — Garantiza que siempre haya un dispositivo local
- `markItemAsSynced(id)` / `markAsConflicted(id, remote)` / `clearConflict(id)`
- `persist()` — Síncrono, escribe DB a disco. Llamado después de cada write.
- `normalizeSettings(row)` — Retorna camelCase: `{ id, accessToken, refreshToken, isDarkMode, selectedDeviceId, localDeviceId, ... }`
- `normalizeItem(row)` — Retorna `{ id, value, type, favorite, createdAt, isDeleted, deviceId }`

---

## Backend REST (backend-copyfy)

**Base URL:** `https://copyfy.webcolsoluciones.com.co`

### Rutas principales
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` | Login → `{ success, data: { user, token, refreshToken } }` |
| POST | `/auth/register` | Registro |
| POST | `/auth/refresh` | Refresh token → `{ success, data: { token, refreshToken } }` |
| GET | `/devices` | Listar dispositivos del usuario |
| POST | `/devices` | Crear/actualizar dispositivo |
| GET | `/clipboard?deviceId=&since=` | Listar items → `{ success, data: { items, favorites, serverTime } }` |
| POST | `/clipboard` | Crear item |
| PUT | `/clipboard/:id` | Actualizar item |
| DELETE | `/clipboard/:id` | Eliminar item (hard delete) |
| POST | `/clipboard/favorites/sync` | Sincronizar estado favorito |
| GET | `/users/me` | Perfil del usuario autenticado |
| GET | `/api/files` | Listar archivos |
| POST | `/api/files/upload` | Subir archivo (multipart/form-data) |
| DELETE | `/api/files/:id` | Eliminar archivo |
| GET | `/api/files/:id/download` | Descargar archivo |

### Modelos PostgreSQL (Sequelize)
- **User**: id, email, passwordHash, name, avatarUrl, storageQuotaMb
- **Device**: id, userId, name, clientId, lastSeenAt, metadata (JSONB)
- **ClipboardItem**: id, userId, deviceId, clientId, type (ENUM), value, valueEnc, iv, authTag, encrypted, meta (JSONB), favorite, deleted, version
- **Session**: id, userId, deviceId, refreshToken, expiresAt
- **File**: id, userId, deviceId, originalName, mimeType, size, path
- **Attachment**: id, clipboardItemId, url, mimeType, size

**Importante:** El backend encripta el value con AES (crypto.service). Si `CLIPBOARD_ENC_KEY` está configurado, los items se guardan con `encrypted=true, valueEnc, iv, authTag` y `value=null`.

---

## IPC — Comunicación Electron

### Desde Frontend (window.electronAPI)
```typescript
// Clipboard
getClipboardHistory(opts)     → ipcMain.handle('get-clipboard-history')
deleteHistoryItem(id)         → ipcMain.handle('delete-history-item')
searchHistory(payload)        → ipcMain.handle('search-history')
clearHistory()                → ipcMain.handle('clear-history')
toggleFavorite({id, isFav})   → ipcMain.send('toggle-favorite')
copyText(text)                → ipcMain.send('copy-to-clipboard')
copyImage(dataUrl)            → ipcMain.send('copy-image')
pasteText()                   → ipcMain.send('paste-text')

// Dispositivos (¡INCONSISTENCIA CONOCIDA!)
getCurrentDevice()            → ipcMain.handle('devices:get-active')  // En preload usa 'devices:get-active'
getAllDevices()                → ipcMain.handle('get-all-devices')
setActiveDevice(id)           → ipcMain.handle('devices:set-active')  // En preload usa 'devices:set-active'
registerNewDevice(name)       → ipcMain.handle('register-new-device')

// Config
getConfig(key)                → ipcMain.handle('get-config')
setConfig(key, val)           → ipcMain.handle('set-config')
getPreferences()              → ipcMain.handle('get-preferences')
setPreferences(prefs)         → ipcMain.handle('set-preferences')

// Backend (proxy autenticado)
backend.request(config)       → ipcMain.handle('backend-request')     // Via BackendDaemon.client

// Sync
syncNow()                     → ipcMain.handle('sync:now')
getSyncStats()                → ipcMain.handle('sync:get-stats')

// Archivos
listFiles(params)             → ipcMain.handle('list-files')
uploadFile(path)              → ipcMain.handle('upload-file')
deleteFile(id)                → ipcMain.handle('delete-file')
downloadFile(id, name)        → ipcMain.handle('download-file')
```

### Desde Main a Frontend (eventos push)
```
'clipboard-update'     → Nuevo item capturado o estado cambió
'device:changed'       → Dispositivo activo cambió
'device:sync-completed'→ Sync inicial de dispositivo completado
'devices:sync-start'   → Inicio sync de dispositivos
'devices:sync-complete'→ Fin sync de dispositivos (→ App muestra DeviceSelectionModal)
'sync:stats'           → Estadísticas de sincronización actualizadas
'sync:network-status'  → { online: boolean }
'file-uploaded'        → Archivo subido exitosamente
```

---

## Flujo de Sincronización

1. **SyncEngine.startScheduler()** → sync inicial inmediato + cada hora
2. **PUSH**: `db.getPendingItems(deviceId)` → Para cada item con Pending=1 → PUT /clipboard/:id (fallback POST si 404) → `db.markItemAsSynced(id)`
3. **PULL**: GET /clipboard?deviceId=&since=lastSync (o sin since si es primera vez) → `applyRemoteChange(item)` para cada item
4. **PULL apply**: Si item no existe localmente → `db.insertItem(...)` con Pending=0. Si existe → comparar timestamps → si remoto más nuevo: `db.updateItem()`. Si local más nuevo y Pending=1: marcar conflicto.
5. **Conflictos**: `db.getConflictedItems()` → `ConflictResolver.resolve()` (Last-Write-Wins) → `db.updateItem()` + `db.clearConflict()`
6. **Imágenes PUSH**: `[LOCAL_IMAGE]:path` → leer archivo → convertir a base64 data URI
7. **Imágenes PULL**: data URI → guardar en `userData/synced_images/` → guardar como `[LOCAL_IMAGE]:path`

---

## Bugs Conocidos / Inconsistencias Identificadas

### Bug #1 — IPC mismatch: `getCurrentDevice` y `setActiveDevice` en preload vs main
- **Preload**: `getCurrentDevice()` usa channel `'devices:get-active'`
- **main.ts**: tiene `ipcMain.handle('get-current-device', ...)` (canal diferente)
- **BackendDaemon.setupIPC()**: registra `ipcMain.handle('devices:get-active', ...)` y `ipcMain.handle('devices:set-active', ...)`
- El preload llama `'devices:set-active'` → esto SÍ existe en BackendDaemon
- Pero `ipcMain.handle('set-active-device', ...)` en main.ts NUNCA se usa desde el renderer (preload usa `'devices:set-active'`)

### Bug #2 — `updateSettings` usa `current.id` (minúscula) pero `normalizeSettings` retorna `id`
- `updateSettings`: `values.push(current.id)` → `normalizeSettings` retorna `{ id: getVal('Id'), ... }` → Esto es correcto, `id` en camelCase está bien

### Bug #3 — `HistoryItem.type` falta en `types.ts`
- `types.ts` define `HistoryItem` sin campo `type`
- El main process en `normalizeForIPC` NO incluye `type` en el objeto retornado
- `Card.tsx` usa `item.value.startsWith('data:image')` y `item.imagePath` para detectar imágenes, pero nunca lee `item.type`
- Filtros en `fetchData` de `App.tsx` usan `filter.type = 'image'` correctamente hacia el IPC

### Bug #4 — `onClipboardUpdate` listener no remueve correctamente
- `preload.ts`: `ipcRenderer.on('clipboard-update', (_, data) => callback(data))` sin retornar función de cleanup
- `App.tsx` hace `const off = electronAPI.onClipboardUpdate(...)` y llama `off?.()` en cleanup → pero `off` es `undefined` (el listener nunca se devuelve)
- Resultado: múltiples listeners acumulados al re-montar

### Bug #5 — `DeviceSelectionModal` usa `device.Id` (mayúscula) pero puede fallar
- La DB retorna objetos con campos en PascalCase (tal como los inserta SQLite)
- `normalizeItem` convierte a camelCase, pero `getDevices()` NO normaliza → retorna raw PascalCase
- `DeviceSelectionModal` usa `device.Id`, `device.Name`, `device.OsName`, `device.UpdatedAt` (PascalCase) → consistente con lo que retorna `getDevices()`
- Pero `getActiveDevice()` en BackendDaemon usa `d.Id` también → OK
- Sin embargo, `ipcMain.handle('get-current-device')` hace `devices.find(d => d.Id === settings.selectedDeviceId)` → correcto

### Bug #6 — Login usa `fetch` directo, no el proxy IPC
- `Login.tsx` hace `fetch(API_BASE + endpoint)` directamente desde el renderer
- El renderer NO tiene interceptor de refresh token
- Si el token expira durante la sesión, el login no se renueva automáticamente (pero el login en sí no necesita token)
- Inconsistencia: todas las demás llamadas van por `backendRequest()` que usa IPC → BackendDaemon → Axios con refresh

### Bug #7 — `App.tsx` llama `getCurrentDevice()` pero también `getActiveDevice()` (misma cosa)
- `checkDevice` usa `electronAPI.getActiveDevice()` que en preload llama `'devices:get-active'` → BackendDaemon ✓
- `fetchData` usa `electronAPI.getCurrentDevice()` que en preload también llama `'devices:get-active'` → BackendDaemon ✓
- Son redundantes pero funcionales

### Bug #8 — `main.ts` tiene handlers duplicados para dispositivos
- `ipcMain.handle('get-current-device', ...)` en main.ts → Nunca llamado desde preload
- `ipcMain.handle('set-active-device', ...)` en main.ts → Nunca llamado desde preload (preload usa `'devices:set-active'`)
- BackendDaemon registra `'devices:get-active'` y `'devices:set-active'` → Estos SÍ se usan
- Los handlers en main.ts son código muerto

### Bug #9 — `SyncEngine.pushLocalChanges` no maneja items de tipo imagen con valor vacío
- Si la imagen local fue eliminada del disco antes de sincronizar, `fs.existsSync(localPath)` falla silenciosamente y `valueToSend` queda como la string `[LOCAL_IMAGE]:path`
- El backend recibirá un value inválido

### Bug #10 — `HistoryItem.type` ausente causa que el tab de imágenes no funcione correctamente
- `types.ts`: `HistoryItem = { id?, value, favorite, imagePath?, previewPath?, originalPath? }` → NO tiene `type`
- `normalizeForIPC` en main.ts incluye `type` en el objeto → pero TypeScript no lo conoce, se pierde en runtime typing
- Los filtros del Dock sí funcionan porque van al IPC con `filter.type`, pero si se necesita leer `item.type` en el componente, TypeScript dará error

---

## Cómo Correr el Proyecto

### Electron App (desarrollo)
```powershell
# Terminal 1: Frontend React
cd frontend
npm run dev

# Terminal 2: Compilar TypeScript de Electron
npx tsc -p tsconfig.main.json --watch

# Terminal 3: Electron
npm start
# O con concurrently:
npm run dev
```

### Backend Node.js
```powershell
cd backend-copyfy
cp .env.example .env  # Configurar DATABASE_URL, JWT_SECRET, etc.
npm run db:migrate    # Correr migraciones Sequelize
npm run dev           # nodemon src/server.js
```

### Variables de entorno Backend (.env)
```
DATABASE_URL=postgres://user:pass@host:5432/copyfy
JWT_SECRET=secret
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_IN=7d
CLIPBOARD_ENC_KEY=32-byte-hex-key
RESEND_API_KEY=...
PORT=3000
```

---

## Convenciones Clave

- **Campos DB locales**: PascalCase (`Id`, `Value`, `DeviceId`, `IsDeleted`)
- **Objetos normalizados** (normalizeItem/normalizeSettings): camelCase (`id`, `value`, `deviceId`, `isDeleted`)
- **getDevices()** retorna PascalCase sin normalizar → los componentes deben usar `device.Id`, `device.Name`
- **getSettings()** retorna camelCase via `normalizeSettings()` → usar `settings.selectedDeviceId`
- **Todos los items** tienen un `DeviceId` obligatorio para ser guardados (`saveClipboardItem` bloquea si no hay dispositivo activo)
- **Imágenes locales** se guardan como `[LOCAL_IMAGE]:/ruta/absoluta.png` en el campo `Value`
- **Sincronización**: Pending=0 (sincronizado), Pending=1 (pendiente envío), Pending=2 (conflicto)
