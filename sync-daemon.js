#!/usr/bin/env node

/**
 * SYNC DAEMON - Proceso Node independiente para sincronización
 * 
 * Arquitectura:
 * - 100% Node.js (sin Electron APIs)
 * - Maneja SQLite, HTTP, sync, devices, versionado
 * - Genera UUID localmente
 * - Local-first (fuente de la verdad)
 * - Tolerante a offline
 * - Nunca bloquea la UI
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const axios = require('axios')
const initSqlJs = require('sql.js')

// ============================================================================
// TIPOS Y CONSTANTES
// ============================================================================

const MESSAGE_TYPES = {
  // Mensajes del main process al daemon
  SYNC_START: 'SYNC_START',
  SYNC_CANCEL: 'SYNC_CANCEL',
  SET_CONFIG: 'SET_CONFIG',
  SHUTDOWN: 'SHUTDOWN',
  RELOAD_DATABASE: 'RELOAD_DATABASE',
  
  // Mensajes del daemon al main process
  SYNC_PROGRESS: 'SYNC_PROGRESS',
  SYNC_ERROR: 'SYNC_ERROR',
  SYNC_DONE: 'SYNC_DONE',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  READY: 'READY'
}

// ============================================================================
// ESTADO DEL DAEMON
// ============================================================================

let db = null
let SQL = null
let dbFilePath = null
let config = {
  backendUrl: null,
  authToken: null,
  userDataPath: null
}
let syncInProgress = false
let syncCanceled = false

// ============================================================================
// INICIALIZACIÓN DE SQLite
// ============================================================================

async function initDatabase(userDataPath) {
  try {
    dbFilePath = path.join(userDataPath, 'copyfy.sqlite')
    
    if (!SQL) {
      const locateFile = (file) => {
        try {
          // En desarrollo: node_modules
          return require.resolve('sql.js/dist/' + file)
        } catch {
          // En producción: puede estar en app.asar.unpacked
          const unpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file)
          if (fs.existsSync(unpacked)) return unpacked
          // Fallback: __dirname
          return path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
        }
      }
      SQL = await initSqlJs({ locateFile })
    }
    
    if (fs.existsSync(dbFilePath)) {
      const buf = fs.readFileSync(dbFilePath)
      db = new SQL.Database(new Uint8Array(buf))
    } else {
      db = new SQL.Database()
    }
    
    // Asegurar esquema básico
    ensureSchema()
    
    sendMessage(MESSAGE_TYPES.READY, { message: 'Database initialized' })
  } catch (error) {
    sendMessage(MESSAGE_TYPES.SYNC_ERROR, { 
      error: `Database initialization failed: ${error.message}` 
    })
    process.exit(1)
  }
}

function ensureSchema() {
  if (!db) return
  
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        device TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
        updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
        version INTEGER NOT NULL DEFAULT 1,
        is_synced INTEGER NOT NULL DEFAULT 0,
        client_item_id TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        remote_id TEXT,
        pending INTEGER DEFAULT 1,
        device_id TEXT,
        uuid TEXT,
        type TEXT DEFAULT 'text'
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastSyncAt TEXT,
        migrated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_history_device_value ON history(device, value);
      CREATE INDEX IF NOT EXISTS idx_history_device_created ON history(device, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_device_synced ON history(device, is_synced);
      CREATE INDEX IF NOT EXISTS idx_history_device_deleted ON history(device, is_deleted);
      CREATE INDEX IF NOT EXISTS idx_history_device_pending ON history(device, pending);
    `)
  } catch (error) {
    // Schema error
  }
}

function persistDatabase() {
  if (!db || !dbFilePath) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (error) {
    // Persist error
  }
}

function reloadDatabase() {
  if (!dbFilePath || !fs.existsSync(dbFilePath)) return false
  try {
    // IMPORTANTE: NO guardar cambios del daemon antes de recargar
    // porque podríamos sobrescribir cambios del main process
    // Solo recargar desde el archivo para ver los cambios del main process
    
    // Recargar desde el archivo (sin guardar cambios pendientes del daemon)
    const buf = fs.readFileSync(dbFilePath)
    db = new SQL.Database(new Uint8Array(buf))
    ensureSchema()
    return true
  } catch (error) {
    return false
  }
}

// ============================================================================
// FUNCIONES DE BASE DE DATOS
// ============================================================================

function getDevice() {
  if (!db) return null
  try {
    // Try to add migrated column if it doesn't exist
    try {
      db.run('ALTER TABLE devices ADD COLUMN migrated INTEGER NOT NULL DEFAULT 0')
    } catch (e) {
      // Column already exists, ignore
    }
    
    const stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices ORDER BY createdAt DESC LIMIT 1')
    let result = null
    if (stmt.step()) {
      const r = stmt.getAsObject()
      result = {
        id: String(r.id || ''),
        userId: String(r.userId || ''),
        clientId: String(r.clientId || ''),
        name: String(r.name || ''),
        createdAt: String(r.createdAt || ''),
        lastSyncAt: r.lastSyncAt ? String(r.lastSyncAt) : null,
        migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
      }
    }
    stmt.free()
    return result
  } catch (error) {
    return null
  }
}

function getDeviceByClientId(clientId) {
  if (!db) return null
  try {
    // Try to add migrated column if it doesn't exist
    try {
      db.run('ALTER TABLE devices ADD COLUMN migrated INTEGER NOT NULL DEFAULT 0')
    } catch (e) {
      // Column already exists, ignore
    }
    
    const stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices WHERE clientId=? LIMIT 1')
    stmt.bind([clientId])
    let result = null
    if (stmt.step()) {
      const r = stmt.getAsObject()
      // Leer lastSyncAt directamente - si existe, usarlo
      const lastSyncAtValue = r.lastSyncAt ? String(r.lastSyncAt).trim() : null
      
      result = {
        id: String(r.id || ''),
        userId: String(r.userId || ''),
        clientId: String(r.clientId || ''),
        name: String(r.name || ''),
        createdAt: String(r.createdAt || ''),
        lastSyncAt: lastSyncAtValue,
        migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
      }
    }
    stmt.free()
    return result
  } catch (error) {
    return null
  }
}

// Marca un dispositivo como migrado en la tabla `devices` usando su clientId
function markDeviceAsMigrated(clientId) {
  if (!db || !clientId) return false
  try {
    // Asegurarse de que la columna exista (en instalaciones viejas podría no estar)
    try {
      db.run('ALTER TABLE devices ADD COLUMN migrated INTEGER NOT NULL DEFAULT 0')
    } catch (e) {
      // Si ya existe, ignorar el error
    }
    
    const stmt = db.prepare('UPDATE devices SET migrated=1 WHERE clientId=?')
    stmt.bind([clientId])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

function saveDevice(deviceInfo) {
  if (!db) return false
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO devices(id, userId, clientId, name, createdAt, lastSyncAt) VALUES(?, ?, ?, ?, ?, ?)')
    stmt.bind([
      deviceInfo.id || '',
      deviceInfo.userId || '',
      deviceInfo.clientId || '',
      deviceInfo.name || '',
      deviceInfo.createdAt || new Date().toISOString(),
      deviceInfo.lastSyncAt || null
    ])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

function updateDeviceLastSyncAt(deviceId, lastSyncAt) {
  if (!db) return false
  try {
    const stmt = db.prepare('UPDATE devices SET lastSyncAt=? WHERE id=?')
    stmt.bind([lastSyncAt, deviceId])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

// Helper function to ensure UUID exists and is valid
function ensureItemUuid(db, itemId, currentUuid) {
  if (!currentUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentUuid)) {
    const newUuid = crypto.randomUUID()
    try {
      const updateStmt = db.prepare('UPDATE history SET uuid=? WHERE id=?')
      updateStmt.bind([newUuid, itemId])
      updateStmt.step()
      updateStmt.free()
      return newUuid
    } catch {
      return newUuid
    }
  }
  return currentUuid
}

function getPendingItems(device) {
  if (!db) return []
  
  try {
    
    // Try to get items for the specific device first
    let stmt = db.prepare('SELECT id, uuid, value, type, device, device_id, created_at, favorite, remote_id FROM history WHERE device=? AND pending=1 AND is_deleted=0 ORDER BY created_at ASC')
    stmt.bind([device])
    const rows = []
    while (stmt.step()) {
      const r = stmt.getAsObject()
      const itemUuid = ensureItemUuid(db, r.id, r.uuid)
      const itemData = {
        id: r.id,
        uuid: itemUuid,
        value: String(r.value),
        type: String(r.type || 'text'),
        device: String(r.device),
        device_id: r.device_id ? String(r.device_id) : null,
        created_at: String(r.created_at),
        favorite: !!r.favorite,
        remote_id: r.remote_id ? String(r.remote_id) : null
      }
      rows.push(itemData)
    }
    stmt.free()
    
    // If no items found for this specific device, get ALL pending items regardless of device
    // This handles the case where items were saved with a different device name
    if (rows.length === 0) {
      try {
        const allPendingStmt = db.prepare('SELECT id, uuid, value, type, device, device_id, created_at, favorite, remote_id FROM history WHERE pending=1 AND is_deleted=0 ORDER BY created_at ASC')
        while (allPendingStmt.step()) {
          const r = allPendingStmt.getAsObject()
          const itemUuid = ensureItemUuid(db, r.id, r.uuid)
          rows.push({
            id: r.id,
            uuid: itemUuid,
            value: String(r.value),
            type: String(r.type || 'text'),
            device: String(r.device),
            device_id: r.device_id ? String(r.device_id) : null,
            created_at: String(r.created_at),
            favorite: !!r.favorite,
            remote_id: r.remote_id ? String(r.remote_id) : null
          })
        }
        allPendingStmt.free()
      } catch (e) {
        // Could not get all pending items
      }
    }
    
    return rows
  } catch (error) {
    return []
  }
}

function markItemCompleted(uuid) {
  if (!db) return false
  try {
    const stmt = db.prepare('UPDATE history SET pending=0 WHERE uuid=?')
    stmt.bind([uuid])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

function updateItemFromServer(serverItem, device) {
  if (!db) return false
  try {
    const uuid = serverItem.uuid || serverItem.id
    let stmt = db.prepare('SELECT id, favorite, pending FROM history WHERE uuid=? OR remote_id=? LIMIT 1')
    stmt.bind([uuid, serverItem.id])
    let found = false
    if (stmt.step()) {
      const r = stmt.getAsObject()
      found = true
      const currentFavorite = r.favorite ? 1 : 0
      // Verificar pending más robustamente (SQLite puede devolver como número, string o boolean)
      const pendingValue = r.pending
      const hasPendingChanges = pendingValue === 1 || pendingValue === '1' || pendingValue === true || pendingValue === 'true' || (typeof pendingValue === 'number' && pendingValue > 0)
      
      stmt.free()
      
      // Si hay cambios pendientes de sincronizar (pending=1), no sobrescribir el favorite local
      // El estado local tiene prioridad porque aún no se ha sincronizado
      const favoriteToUse = hasPendingChanges ? currentFavorite : (serverItem.favorite ? 1 : 0)
      
      // Si había cambios pendientes, mantener pending=1 hasta que se sincronice
      // Solo marcar pending=0 si no había cambios pendientes
      const newPending = hasPendingChanges ? 1 : 0
      
      stmt = db.prepare('UPDATE history SET value=?, favorite=?, remote_id=?, version=?, updated_at=?, device_id=?, pending=?, type=? WHERE id=?')
      stmt.bind([
        serverItem.value,
        favoriteToUse,
        serverItem.id,
        serverItem.version || 1,
        serverItem.updatedAt || serverItem.createdAt,
        serverItem.deviceId,
        newPending,
        serverItem.type || 'text',
        r.id
      ])
    } else {
      stmt.free()
      const existing = db.prepare('SELECT id FROM history WHERE value=? AND device=? LIMIT 1')
      existing.bind([serverItem.value, device])
      if (!existing.step()) {
        existing.free()
        stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, updated_at, remote_id, uuid, device_id, type, pending, version, client_item_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
        stmt.bind([
          serverItem.value,
          serverItem.favorite ? 1 : 0,
          device,
          serverItem.createdAt,
          serverItem.updatedAt || serverItem.createdAt,
          serverItem.id,
          uuid,
          serverItem.deviceId,
          serverItem.type || 'text',
          serverItem.version || 1,
          crypto.randomUUID()
        ])
      } else {
        existing.free()
        return false
      }
    }
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

function sanitizeDeviceName(name) {
  if (!name || typeof name !== 'string') return 'device'
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64) || 'device'
}

function getConfig(key) {
  if (!db) return null
  try {
    const stmt = db.prepare('SELECT value FROM config WHERE key=?')
    stmt.bind([key])
    let result = null
    if (stmt.step()) {
      const r = stmt.getAsObject()
      result = r.value ? String(r.value) : null
    }
    stmt.free()
    return result
  } catch (error) {
    return null
  }
}

function setConfig(key, value) {
  if (!db) return false
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO config(key, value, updated_at) VALUES(?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'))')
    stmt.bind([key, value])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

// ============================================================================
// HTTP / SYNC
// ============================================================================

function getAxiosInstance() {
  if (!config.authToken || !config.backendUrl) {
    throw new Error('No auth token or backend URL configured')
  }
  
  const instance = axios.create({
    baseURL: config.backendUrl,
    headers: { Authorization: `Bearer ${config.authToken}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 60000
  })
  
  // Interceptor para refresh token
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config
      
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true
        
        try {
          const sessionStr = getConfig('session')
          if (!sessionStr) {
            throw new Error('No session found')
          }
          
          const session = JSON.parse(sessionStr)
          if (!session || !session.refreshToken) {
            throw new Error('No refreshToken in session')
          }
          
          const tokenResult = await refreshToken(session.refreshToken)
          if (tokenResult && tokenResult.token) {
            config.authToken = tokenResult.token
            // Actualizar la sesión en la base de datos con el nuevo token y refreshToken
            const updatedSession = {
              ...session,
              token: tokenResult.token,
              refreshToken: tokenResult.refreshToken || session.refreshToken
            }
            setConfig('session', JSON.stringify(updatedSession))
            
            // Notificar al main process sobre el token refrescado
            sendMessage(MESSAGE_TYPES.TOKEN_REFRESHED, {
              token: tokenResult.token,
              refreshToken: tokenResult.refreshToken || session.refreshToken,
              session: updatedSession
            })
            
            originalRequest.headers.Authorization = `Bearer ${tokenResult.token}`
            return instance(originalRequest)
          }
        } catch (refreshError) {
          sendMessage(MESSAGE_TYPES.SYNC_ERROR, { 
            error: 'Token refresh failed', 
            details: refreshError.message 
          })
        }
      }
      
      return Promise.reject(error)
    }
  )
  
  return instance
}

async function refreshToken(refreshTokenValue) {
  try {
    const url = `${config.backendUrl}/auth/refresh`
    const res = await axios.post(url, { refreshToken: refreshTokenValue }, {
      headers: { 'Content-Type': 'application/json' }
    })
    
    const data = res?.data
    const payload = (data && typeof data === 'object') ? (data.data ?? data) : {}
    const okFlag = (data && typeof data === 'object') ? (data.success ?? data.status ?? res.status === 200) : res.status === 200
    const newToken = payload?.token
    const newRefreshToken = payload?.refreshToken || refreshTokenValue
    
    if (okFlag && newToken) {
      return { token: newToken, refreshToken: newRefreshToken }
    }
    
    throw new Error('Invalid refresh response')
  } catch (error) {
    throw error
  }
}

async function ensureDeviceRegistered() {
  try {
    const savedDevice = getDevice()
    if (savedDevice && savedDevice.id && savedDevice.userId) {
      return savedDevice
    }
    
    const axiosInstance = getAxiosInstance()
    const hostname = require('os').hostname()
    const osName = process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'macOS' : 'Linux')
    
    const payload = {
      clientId: hostname,
      name: hostname,
      metadata: { os: osName }
    }
    
    const res = await axiosInstance.post('/devices', payload)
    const data = res?.data
    const device = (data && data.data && data.data.device)
      ? data.data.device
      : (data && data.device)
        ? data.device
        : (data && typeof data === 'object' && data.id ? data : null)
    
    if (device && device.id) {
      const deviceInfo = {
        id: device.id,
        userId: device.userId || '',
        clientId: device.clientId || hostname,
        name: device.name || hostname,
        createdAt: device.createdAt || new Date().toISOString(),
        lastSyncAt: null
      }
      saveDevice(deviceInfo)
      return deviceInfo
    }
    
    throw new Error('Failed to register device')
  } catch (error) {
    throw error
  }
}

async function pushPendingItems(deviceName, clientId, deviceId) {
  const pendingItems = getPendingItems(deviceName)
  
  if (pendingItems.length === 0) {
    return { successful: 0, failed: 0 }
  }
  
  sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
    percentage: 15,
    message: `Subiendo ${pendingItems.length} items...`,
    stage: 'push'
  })
  
  const axiosInstance = getAxiosInstance()
  const successfulUuids = []
  const failedUuids = []
  const BATCH_SIZE = 100
  
  // Procesar en batches de 100
  for (let batchStart = 0; batchStart < pendingItems.length; batchStart += BATCH_SIZE) {
    if (syncCanceled) {
      break
    }
    
    const batchEnd = Math.min(batchStart + BATCH_SIZE, pendingItems.length)
    const batch = pendingItems.slice(batchStart, batchEnd)
    
    // Procesar todo el batch en paralelo con Promise.all
    const batchPromises = batch.map(async (item) => {
      try {
        // Si el item ya existe en el servidor (tiene remote_id), usar PUT solo para actualizar favorite
        if (item.remote_id) {
          const putPayload = {
            favorite: item.favorite || false
          }
          
          const res = await axiosInstance.put(`/clipboard/${item.remote_id}`, putPayload)
          
          if (res.status === 200 || res.status === 204) {
            markItemCompleted(item.uuid)
            return { success: true, uuid: item.uuid }
          } else {
            return { success: false, uuid: item.uuid }
          }
        }
        
        // Si el item no existe en el servidor, hacer POST con toda la información
        let valueToSend = item.value
        
        // Convertir imágenes locales a data URL
        if (item.value.startsWith('[LOCAL_IMAGE]:')) {
          const localPath = item.value.replace('[LOCAL_IMAGE]:', '')
          if (fs.existsSync(localPath)) {
            const buf = fs.readFileSync(localPath)
            let mime = 'image/png'
            if (localPath.endsWith('.jpg') || localPath.endsWith('.jpeg')) mime = 'image/jpeg'
            else if (localPath.endsWith('.webp')) mime = 'image/webp'
            valueToSend = `data:${mime};base64,${buf.toString('base64')}`
          } else {
            return { success: false, uuid: item.uuid }
          }
        }
        
        const payload = {
          uuid: item.uuid,
          type: item.type || 'text',
          value: valueToSend,
          favorite: item.favorite || false,
          clientId: clientId,
          deviceId: deviceId,
          createdAt: item.created_at || new Date().toISOString()
        }
        
        const res = await axiosInstance.post('/clipboard', payload)
        
        if (res.status === 200 || res.status === 201) {
          // Actualizar remote_id si viene en la respuesta
          const responseData = res.data
          const remoteId = (responseData && responseData.data && responseData.data.id) || 
                          (responseData && responseData.id) ||
                          (responseData && typeof responseData === 'object' && responseData.id ? responseData.id : null)
          
          if (remoteId && db) {
            try {
              const updateStmt = db.prepare('UPDATE history SET remote_id=? WHERE uuid=?')
              updateStmt.bind([remoteId, item.uuid])
              updateStmt.step()
              updateStmt.free()
              persistDatabase()
            } catch (e) {
              // Error updating remote_id
            }
          }
          
          markItemCompleted(item.uuid)
          return { success: true, uuid: item.uuid }
        } else {
          return { success: false, uuid: item.uuid }
        }
      } catch (error) {
        return { success: false, uuid: item.uuid }
      }
    })
    
    // Esperar a que todo el batch termine en paralelo
    const results = await Promise.all(batchPromises)
    results.forEach(result => {
      if (result.success) {
        successfulUuids.push(result.uuid)
      } else {
        failedUuids.push(result.uuid)
      }
    })
    
    // Actualizar progreso después de cada batch (de 15% a 25%)
    const percentage = 15 + Math.round((batchEnd / pendingItems.length) * 10)
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: percentage,
      message: `Subiendo ${batchEnd}/${pendingItems.length} items...`,
      stage: 'push'
    })
    
    // Liberar event loop brevemente entre batches
    if (batchEnd < pendingItems.length) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  
  return { successful: successfulUuids.length, failed: failedUuids.length, successfulUuids }
}

async function pullItems(deviceName, clientId, deviceId, sinceOverride = null) {
  try {
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 30,
      message: 'Descargando items del servidor...',
      stage: 'pull'
    })
    
    const axiosInstance = getAxiosInstance()
    const url = '/clipboard'
    
    // Usar lastSyncAt si existe; si es null/undefined/cadena vacía, no enviar 'since'
    const params = { clientId, deviceId }
    if (sinceOverride && typeof sinceOverride === 'string' && sinceOverride.trim() !== '') {
      params.since = sinceOverride
    }
    
    console.log('[DAEMON-SYNC-PULL] Petición GET:', url)
    console.log('[DAEMON-SYNC-PULL] Parámetros:', JSON.stringify(params, null, 2))
    
    const res = await axiosInstance.get(url, { params })
    
    const data = res?.data
    const items = (data && typeof data === 'object' && data.data?.items)
      ? data.data.items
      : (Array.isArray(data?.data) ? data.data : [])
    
    const mappedItems = Array.isArray(items)
      ? items.map(it => ({
          id: it.id,
          uuid: it.uuid || it.id,
          deviceId: it.deviceId,
          clientId: it.clientId,
          type: it.type || 'text',
          value: String(it.value || ''),
          favorite: !!it.favorite,
          version: it.version || 1,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt || it.createdAt
        }))
      : []
    
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 40,
      message: `Procesando ${mappedItems.length} items...`,
      stage: 'pull'
    })
    
    // Procesar items en batches de 100 con Promise.all
    const BATCH_SIZE = 100
    let updated = 0
    let inserted = 0
    
    // Procesar en batches de 100
    for (let batchStart = 0; batchStart < mappedItems.length; batchStart += BATCH_SIZE) {
      if (syncCanceled) {
        break
      }
      
      const batchEnd = Math.min(batchStart + BATCH_SIZE, mappedItems.length)
      const batch = mappedItems.slice(batchStart, batchEnd)
      
      // Procesar todo el batch en paralelo con Promise.all
      const batchPromises = batch.map(async (item) => {
        const beforeCount = db ? countActive(deviceName) : 0
        updateItemFromServer(item, deviceName)
        const afterCount = db ? countActive(deviceName) : 0
        
        return {
          inserted: afterCount > beforeCount,
          updated: afterCount <= beforeCount
        }
      })
      
      // Esperar a que todo el batch termine en paralelo
      const results = await Promise.all(batchPromises)
      results.forEach(result => {
        if (result.inserted) {
          inserted++
        } else {
          updated++
        }
      })
      
      // Actualizar progreso después de cada batch (de 40% a 80%)
      const percentage = 40 + Math.round((batchEnd / mappedItems.length) * 40)
      sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
        percentage: percentage,
        message: `Procesando ${batchEnd}/${mappedItems.length} items...`,
        stage: 'pull'
      })
      
      // Liberar event loop brevemente entre batches
      if (batchEnd < mappedItems.length) {
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    
    console.log('[DAEMON-SYNC-PULL] Descargados:', mappedItems.length, 'insertados:', inserted, 'actualizados:', updated)
    
    return { received: mappedItems.length, inserted, updated }
  } catch (error) {
    throw error
  }
}

function countActive(device) {
  if (!db) return 0
  try {
    const stmt = db.prepare('SELECT COUNT(1) AS c FROM history WHERE device=? AND is_deleted=0')
    stmt.bind([device])
    let c = 0
    if (stmt.step()) {
      const r = stmt.getAsObject()
      c = Number(r.c || 0)
    }
    stmt.free()
    return c
  } catch {
    return 0
  }
}

function clearAll() {
  if (!db) return false
  try {
    const stmt = db.prepare('DELETE FROM history')
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}

function clearDeviceHistory(device) {
  if (!db) return false
  try {
    const stmt = db.prepare('DELETE FROM history WHERE device=?')
    stmt.bind([device])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    return false
  }
}


// ============================================================================
// FLUJO DE SYNC PRINCIPAL
// ============================================================================

async function performSync(deviceName) {
  if (syncInProgress) {
    return
  }
  
  syncInProgress = true
  syncCanceled = false
  
  try {
    // Enviar mensaje inicial INMEDIATAMENTE para que el frontend muestre el loading
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 0,
      message: 'Iniciando sincronización...',
      stage: 'start'
    })
    
    // Pequeño delay para asegurar que el mensaje se procese
    await new Promise(resolve => setImmediate(resolve))
    
    // 1. Refresh token si es necesario (se hace automáticamente en getAxiosInstance)
    
    // 2. Validar sesión
    if (!config.authToken || !config.backendUrl) {
      throw new Error('No auth token or backend URL configured')
    }
    
    // 3. Asegurar dispositivo registrado
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 10,
      message: 'Registrando dispositivo...',
      stage: 'device'
    })
    
    // IMPORTANTE: Recargar la base de datos ANTES de buscar el dispositivo
    // Esto es CRÍTICO porque el main process puede haber actualizado el lastSyncAt
    // y necesitamos ver esos cambios antes de buscar el dispositivo
    console.log('[DAEMON-SYNC] Recargando base de datos antes de buscar dispositivo inicial...')
    const reloadResult = reloadDatabase()
    console.log('[DAEMON-SYNC] Base de datos recargada:', reloadResult ? 'Éxito' : 'Falló')
    
    // Primero intentar obtener el dispositivo por clientId (deviceName)
    let device = getDeviceByClientId(deviceName)
    console.log('[DAEMON-SYNC] Dispositivo inicial encontrado por clientId:', device ? 'Sí' : 'No')
    if (device) {
      console.log('[DAEMON-SYNC] Dispositivo inicial - id:', device.id, 'clientId:', device.clientId, 'lastSyncAt:', device.lastSyncAt)
    } else {
      console.log('[DAEMON-SYNC] Dispositivo NO encontrado por clientId:', deviceName)
    }
    
    // Si no se encuentra por clientId, intentar buscar por name
    if (!device || !device.id) {
      if (!db) return
      try {
        const stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices WHERE name=? LIMIT 1')
        stmt.bind([deviceName])
        if (stmt.step()) {
          const r = stmt.getAsObject()
          console.log('[DAEMON-SYNC] Dispositivo encontrado por name - lastSyncAt (raw):', r.lastSyncAt)
          
          // Leer lastSyncAt correctamente
          let lastSyncAtValue = null
          if (r.lastSyncAt != null && r.lastSyncAt !== undefined) {
            const lastSyncStr = String(r.lastSyncAt).trim()
            if (lastSyncStr && lastSyncStr !== 'null' && lastSyncStr !== 'undefined') {
              lastSyncAtValue = lastSyncStr
            }
          }
          
          device = {
            id: String(r.id || ''),
            userId: String(r.userId || ''),
            clientId: String(r.clientId || ''),
            name: String(r.name || ''),
            createdAt: String(r.createdAt || ''),
            lastSyncAt: lastSyncAtValue,
            migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
          }
          console.log('[DAEMON-SYNC] Dispositivo encontrado por name - lastSyncAt (procesado):', device.lastSyncAt)
        }
        stmt.free()
      } catch (error) {
        console.log('[DAEMON-SYNC] Error buscando por name:', error.message)
      }
    }
    
    console.log('[DAEMON-SYNC] Buscando dispositivo:', deviceName)
    console.log('[DAEMON-SYNC] Dispositivo encontrado en DB local:', device ? 'Sí' : 'No')
    if (device) {
      console.log('[DAEMON-SYNC] Dispositivo encontrado - clientId:', device.clientId, 'name:', device.name, 'lastSyncAt:', device.lastSyncAt)
    }
    
    // Guardar el lastSyncAt existente si el dispositivo ya está en la DB local
    let existingLastSyncAt = null
    if (device && device.lastSyncAt) {
      existingLastSyncAt = device.lastSyncAt
      console.log('[DAEMON-SYNC] lastSyncAt existente preservado:', existingLastSyncAt)
    }
    
    // Si no se encuentra, intentar registrar/obtener el dispositivo con el deviceName especificado
    if (!device || !device.id) {
      // Intentar obtener el dispositivo del backend usando el deviceName
      try {
        const axiosInstance = getAxiosInstance()
        const res = await axiosInstance.get('/devices')
        const data = res?.data
        const container = (data && typeof data === 'object' ? (data.data ?? data) : {})
        const list = Array.isArray(container) ? container : (Array.isArray(container.items) ? container.items : [])
        
        // Buscar el dispositivo en la lista del backend
        const foundDevice = Array.isArray(list) ? list.find(d => {
          const dClientId = d.clientId || d.client_id || d.name || ''
          return sanitizeDeviceName(dClientId) === deviceName || sanitizeDeviceName(d.name) === deviceName
        }) : null
        
        if (foundDevice && foundDevice.id) {
          // Guardar el dispositivo encontrado en la DB local
          // Preservar el lastSyncAt existente si existe, sino usar el del backend
          const lastSyncAtToUse = existingLastSyncAt || foundDevice.lastSyncAt || foundDevice.last_sync_at || null
          const deviceInfo = {
            id: foundDevice.id,
            userId: foundDevice.userId || foundDevice.user_id || '',
            clientId: foundDevice.clientId || foundDevice.client_id || deviceName,
            name: foundDevice.name || deviceName,
            createdAt: foundDevice.createdAt || foundDevice.created_at || new Date().toISOString(),
            lastSyncAt: lastSyncAtToUse
          }
          saveDevice(deviceInfo)
          device = deviceInfo
        } else {
          // Si no se encuentra en el backend, registrar uno nuevo con el deviceName especificado
          const hostname = require('os').hostname()
          const osName = process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'macOS' : 'Linux')
          const payload = {
            clientId: deviceName, // Usar el deviceName que se pasó, no el hostname
            name: deviceName,
            metadata: { os: osName }
          }
          const res2 = await axiosInstance.post('/devices', payload)
          const data2 = res2?.data
          const newDevice = (data2 && data2.data && data2.data.device)
            ? data2.data.device
            : (data2 && data2.device)
              ? data2.device
              : (data2 && typeof data2 === 'object' && data2.id ? data2 : null)
          
          if (newDevice && newDevice.id) {
            // Preservar el lastSyncAt existente si existe
            const deviceInfo = {
              id: newDevice.id,
              userId: newDevice.userId || '',
              clientId: newDevice.clientId || deviceName,
              name: newDevice.name || deviceName,
              createdAt: newDevice.createdAt || new Date().toISOString(),
              lastSyncAt: existingLastSyncAt || null
            }
            saveDevice(deviceInfo)
            device = deviceInfo
          } else {
            throw new Error('Failed to register device')
          }
        }
      } catch (error) {
        // Si falla, intentar con ensureDeviceRegistered como fallback
        device = await ensureDeviceRegistered()
        if (!device || !device.id) {
          throw new Error('Device registration failed')
        }
        // Preservar el lastSyncAt existente si existe
        if (existingLastSyncAt && device) {
          device.lastSyncAt = existingLastSyncAt
          saveDevice(device)
        }
      }
    }
    
    const clientId = device.clientId || deviceName
    const deviceId = device.id // UUID del dispositivo
    
    // Usar el clientId del dispositivo para guardar los items (puede ser diferente al deviceName)
    const targetDeviceName = clientId || deviceName
    
    // IMPORTANTE: Recargar la base de datos nuevamente después de obtener el dispositivo
    // para asegurar que tenemos el lastSyncAt más reciente (puede haber sido actualizado por el main process)
    // Esto es CRÍTICO porque el main process puede haber actualizado el lastSyncAt después del último sync
    console.log('[DAEMON-SYNC] Recargando base de datos nuevamente antes de buscar dispositivo refrescado...')
    reloadDatabase()
    console.log('[DAEMON-SYNC] Base de datos recargada nuevamente')
    
    // IMPORTANTE: Buscar el dispositivo por deviceId directamente, ya que es el identificador más confiable
    // El deviceId es único y no cambia, mientras que clientId puede variar
    let refreshedDevice = null
    if (db && deviceId) {
      try {
        const stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices WHERE id=? LIMIT 1')
        stmt.bind([deviceId])
        if (stmt.step()) {
          const r = stmt.getAsObject()
          
          // Leer lastSyncAt - verificar todos los casos posibles
          let lastSyncAtValue = null
          if (r.lastSyncAt !== null && r.lastSyncAt !== undefined) {
            const lastSyncStr = String(r.lastSyncAt).trim()
            if (lastSyncStr && lastSyncStr !== 'null' && lastSyncStr !== 'undefined' && lastSyncStr !== '') {
              lastSyncAtValue = lastSyncStr
            }
          }
          
          refreshedDevice = {
            id: String(r.id || ''),
            userId: String(r.userId || ''),
            clientId: String(r.clientId || ''),
            name: String(r.name || ''),
            createdAt: String(r.createdAt || ''),
            lastSyncAt: lastSyncAtValue,
            migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
          }
          
          console.log('[DAEMON-SYNC] Dispositivo refrescado encontrado por deviceId - lastSyncAt:', refreshedDevice.lastSyncAt)
        } else {
          console.log('[DAEMON-SYNC] Dispositivo NO encontrado por deviceId:', deviceId)
        }
        stmt.free()
      } catch (error) {
        console.log('[DAEMON-SYNC] Error buscando por deviceId:', error.message)
      }
    }
    
    // Si no se encuentra por deviceId, intentar por clientId
    if (!refreshedDevice || !refreshedDevice.id) {
      console.log('[DAEMON-SYNC] Buscando dispositivo por clientId:', clientId)
      refreshedDevice = getDeviceByClientId(clientId)
      if (refreshedDevice) {
        console.log('[DAEMON-SYNC] Dispositivo encontrado por clientId - lastSyncAt:', refreshedDevice.lastSyncAt)
      } else {
        console.log('[DAEMON-SYNC] Dispositivo NO encontrado por clientId')
      }
    }
    
    // Si aún no se encuentra, intentar buscar por name
    if (!refreshedDevice || !refreshedDevice.id) {
      if (db) {
        try {
          const stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices WHERE name=? LIMIT 1')
          stmt.bind([deviceName])
          if (stmt.step()) {
            const r = stmt.getAsObject()
            // Leer lastSyncAt - si existe y no es null/undefined, usarlo directamente
            const lastSyncAtValue = (r.lastSyncAt != null && r.lastSyncAt !== undefined && String(r.lastSyncAt).trim() !== '') 
              ? String(r.lastSyncAt).trim() 
              : null
            
            refreshedDevice = {
              id: String(r.id || ''),
              userId: String(r.userId || ''),
              clientId: String(r.clientId || ''),
              name: String(r.name || ''),
              createdAt: String(r.createdAt || ''),
              lastSyncAt: lastSyncAtValue,
              migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
            }
          }
          stmt.free()
        } catch (error) {
          // Error buscando
        }
      }
    }
    
    // Usar el dispositivo refrescado si está disponible, sino usar el original
    const finalDevice = refreshedDevice || device
    
    // Determinar desde cuándo sincronizar:
    // - Si device.lastSyncAt existe, se envía como 'since'
    // - Si es null/undefined/vacío, no se envía 'since' (full sync)
    const lastSyncAt = finalDevice && finalDevice.lastSyncAt ? String(finalDevice.lastSyncAt).trim() : null
    
    console.log('[DAEMON-SYNC] lastSyncAt a enviar:', lastSyncAt)
    
    console.log('[DAEMON-SYNC] Parámetros de sync:')
    console.log('[DAEMON-SYNC]   - deviceName (original):', deviceName)
    console.log('[DAEMON-SYNC]   - targetDeviceName (usado):', targetDeviceName)
    console.log('[DAEMON-SYNC]   - clientId:', clientId)
    console.log('[DAEMON-SYNC]   - deviceId:', deviceId)
    console.log('[DAEMON-SYNC]   - finalDevice.lastSyncAt:', finalDevice.lastSyncAt)
    console.log('[DAEMON-SYNC]   - lastSyncAt a enviar como since:', lastSyncAt)
    
    // 4. Pull (Full en primera ejecución, incremental con lastSyncAt en las siguientes)
    const pullResult = await pullItems(targetDeviceName, clientId, deviceId, lastSyncAt)
    
    // 5. Push (desde local → remoto)
    // IMPORTANTE: Buscar items pendientes por TODOS los devices posibles
    // porque puede haber items guardados con diferentes nombres de device
    // Intentar push con el targetDeviceName primero
    let pushResult = await pushPendingItems(targetDeviceName, clientId, deviceId)
    
    // Si no hay items pendientes, intentar con el deviceName original
    if (pushResult.successful === 0 && pushResult.failed === 0) {
      pushResult = await pushPendingItems(deviceName, clientId, deviceId)
    }
    
    // Si aún no hay items, buscar TODOS los items pendientes sin filtrar por device
    if (pushResult.successful === 0 && pushResult.failed === 0) {
      try {
        const allPendingStmt = db.prepare('SELECT DISTINCT device FROM history WHERE pending=1 AND is_deleted=0')
        const devicesWithPending = []
        while (allPendingStmt.step()) {
          const r = allPendingStmt.getAsObject()
          devicesWithPending.push(String(r.device))
        }
        allPendingStmt.free()
        
        // Push items de cada device que tenga items pendientes
        for (const pendingDevice of devicesWithPending) {
          const devicePushResult = await pushPendingItems(pendingDevice, clientId, deviceId)
          pushResult.successful += devicePushResult.successful
          pushResult.failed += devicePushResult.failed
        }
      } catch (e) {
        // Error pushing all pending items
      }
    }
    
    console.log('[DAEMON-SYNC] Subidos:', pushResult.successful, 'fallidos:', pushResult.failed)
    
    // 6. Resolver conflictos por version (ya se hace en updateItemFromServer)
    
    // 7. Guardar lastSyncAt
    const lastSyncAtNow = new Date().toISOString()
    console.log('[DAEMON-SYNC] Guardando lastSyncAt:', lastSyncAtNow, 'para deviceId:', deviceId)
    const updateResult = updateDeviceLastSyncAt(deviceId, lastSyncAtNow)
    console.log('[DAEMON-SYNC] Resultado de guardar lastSyncAt:', updateResult)
    
    // Verificar que se guardó correctamente
    if (db) {
      try {
        const verifyStmt = db.prepare('SELECT lastSyncAt FROM devices WHERE id=?')
        verifyStmt.bind([deviceId])
        if (verifyStmt.step()) {
          const r = verifyStmt.getAsObject()
          console.log('[DAEMON-SYNC] lastSyncAt verificado después de guardar:', r.lastSyncAt)
        }
        verifyStmt.free()
      } catch (e) {
        console.log('[DAEMON-SYNC] Error verificando lastSyncAt:', e.message)
      }
    }
    
    sendMessage(MESSAGE_TYPES.SYNC_DONE, {
      percentage: 100,
      message: 'Sincronización completada',
      pushResult,
      pullResult,
      stage: 'done'
    })
    
  } catch (error) {
    sendMessage(MESSAGE_TYPES.SYNC_ERROR, {
      error: error.message,
      details: error.stack
    })
  } finally {
    syncInProgress = false
    syncCanceled = false
  }
}

// ============================================================================
// COMUNICACIÓN CON MAIN PROCESS
// ============================================================================

function sendMessage(type, payload = {}) {
  if (process.send) {
    process.send({ type, ...payload })
  }
}

process.on('message', async (msg) => {
  try {
    switch (msg.type) {
      case 'INIT':
        await initDatabase(msg.userDataPath)
        break
        
      case MESSAGE_TYPES.SET_CONFIG:
        config = { ...config, ...msg.config }
        
        // Si se pasa una sesión en el config, guardarla en la base de datos
        if (msg.config?.session) {
          try {
            const sessionData = typeof msg.config.session === 'string' 
              ? JSON.parse(msg.config.session) 
              : msg.config.session
            setConfig('session', JSON.stringify(sessionData))
          } catch (e) {
            // Error saving session
          }
        }
        
        // Si no hay authToken en el config pero hay sesión en la DB, cargarla
        if (!config.authToken && db) {
          try {
            const sessionStr = getConfig('session')
            if (sessionStr) {
              const session = JSON.parse(sessionStr)
              if (session?.token) {
                config.authToken = session.token
              }
            }
          } catch (e) {
            // Error loading session
          }
        }
        break
        
      case MESSAGE_TYPES.SYNC_START:
        if (msg.deviceName) {
          await performSync(msg.deviceName)
        }
        break
        
      case MESSAGE_TYPES.SYNC_CANCEL:
        syncCanceled = true
        break
        
      case MESSAGE_TYPES.SHUTDOWN:
        if (db) {
          persistDatabase()
        }
        process.exit(0)
        break
        
      case MESSAGE_TYPES.RELOAD_DATABASE:
        reloadDatabase()
        break
        
      default:
        // Unknown message type
    }
  } catch (error) {
    sendMessage(MESSAGE_TYPES.SYNC_ERROR, {
      error: error.message,
      details: error.stack
    })
  }
})

// Enviar señal de que el daemon está listo
process.once('SIGUSR2', () => {
  sendMessage(MESSAGE_TYPES.READY, { message: 'Daemon ready' })
})

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  sendMessage(MESSAGE_TYPES.SYNC_ERROR, {
    error: error.message,
    details: error.stack
  })
})

process.on('unhandledRejection', (reason) => {
  sendMessage(MESSAGE_TYPES.SYNC_ERROR, {
    error: 'Unhandled rejection',
    details: String(reason)
  })
})

// Señal de ready inicial (si ya tenemos la ruta)
if (process.argv[2]) {
  initDatabase(process.argv[2]).catch(console.error)
}
