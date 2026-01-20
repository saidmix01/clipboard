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
  MIGRATION_START: 'MIGRATION_START',
  SHUTDOWN: 'SHUTDOWN',
  RELOAD_DATABASE: 'RELOAD_DATABASE',
  
  // Mensajes del daemon al main process
  SYNC_PROGRESS: 'SYNC_PROGRESS',
  SYNC_ERROR: 'SYNC_ERROR',
  SYNC_DONE: 'SYNC_DONE',
  MIGRATION_DONE: 'MIGRATION_DONE',
  MIGRATION_ERROR: 'MIGRATION_ERROR',
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
let migrationInProgress = false
let migrationCompleted = false

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
    console.error('[DAEMON] Schema error:', error)
  }
}

function persistDatabase() {
  if (!db || !dbFilePath) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (error) {
    console.error('[DAEMON] Persist error:', error)
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
    console.log('[DAEMON] Database reloaded from file (main process changes visible)')
    return true
  } catch (error) {
    console.error('[DAEMON] Reload database error:', error)
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
    console.error('[DAEMON] getDevice error:', error)
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
    console.error('[DAEMON] getDeviceByClientId error:', error)
    return null
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
    console.error('[DAEMON] saveDevice error:', error)
    return false
  }
}

function updateDeviceLastSyncAt(lastSyncAt) {
  if (!db) return false
  try {
    const stmt = db.prepare('UPDATE devices SET lastSyncAt=? WHERE id=(SELECT id FROM devices LIMIT 1)')
    stmt.bind([lastSyncAt])
    stmt.step()
    stmt.free()
    persistDatabase()
    return true
  } catch (error) {
    console.error('[DAEMON] updateDeviceLastSyncAt error:', error)
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
      
      // Log para debugging: items con remote_id que solo cambiaron el favorite
      if (itemData.remote_id) {
        console.log(`[DAEMON] Found pending item with remote_id (favorite update): uuid=${itemData.uuid}, remote_id=${itemData.remote_id}, favorite=${itemData.favorite}`)
      }
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
        console.error('[DAEMON] Could not get all pending items:', e.message)
      }
    }
    
    return rows
  } catch (error) {
    console.error('[DAEMON] getPendingItems error:', error)
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
    console.error('[DAEMON] markItemCompleted error:', error)
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
      const hasPendingChanges = r.pending === 1 || r.pending === '1' || r.pending === true
      
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
    console.error('[DAEMON] updateItemFromServer error:', error)
    return false
  }
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
    console.error('[DAEMON] setConfig error:', error)
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
            console.log('[DAEMON] Token refreshed, notifying main process')
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
    console.error('[DAEMON] refreshToken error:', error)
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
    
    console.log('[DAEMON-HTTP] POST /devices payload:', payload)
    const res = await axiosInstance.post('/devices', payload)
    console.log('[DAEMON-HTTP] POST /devices status:', res.status)
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
    console.error('[DAEMON] ensureDeviceRegistered error:', error)
    throw error
  }
}

async function pushPendingItems(deviceName, clientId, deviceId) {
  const pendingItems = getPendingItems(deviceName)
  
  if (pendingItems.length === 0) {
    return { successful: 0, failed: 0 }
  }
  
  sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
    percentage: 10,
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
          
          console.log(`[DAEMON-SYNC-PUSH] Updating favorite for existing item: remote_id=${item.remote_id}, favorite=${putPayload.favorite}, uuid=${item.uuid}`)
          
          const res = await axiosInstance.put(`/clipboard/${item.remote_id}`, putPayload)
          
          if (res.status === 200 || res.status === 204) {
            console.log(`[DAEMON-SYNC-PUSH] ✅ Favorite updated successfully for item ${item.uuid}`)
            markItemCompleted(item.uuid)
            return { success: true, uuid: item.uuid }
          } else {
            console.warn(`[DAEMON-SYNC-PUSH] Item ${item.uuid} PUT failed with status: ${res.status}`)
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
            console.warn(`[DAEMON-SYNC-PUSH] Local image not found: ${localPath} for item ${item.uuid}`)
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
              console.error(`[DAEMON-SYNC-PUSH] Error updating remote_id for ${item.uuid}:`, e.message)
            }
          }
          
          markItemCompleted(item.uuid)
          return { success: true, uuid: item.uuid }
        } else {
          console.warn(`[DAEMON-SYNC-PUSH] Item ${item.uuid} POST failed with status: ${res.status}`)
          return { success: false, uuid: item.uuid }
        }
      } catch (error) {
        console.error(`[DAEMON-SYNC-PUSH] Error pushing item ${item.uuid}:`, {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          stack: error.stack
        })
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
    
    // Actualizar progreso después de cada batch
    const percentage = 10 + Math.round((batchEnd / pendingItems.length) * 40)
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

async function pullItems(deviceName, clientId, deviceId) {
  console.log('[DAEMON-SYNC-PULL] ==========================================')
  console.log('[DAEMON-SYNC-PULL] Starting pull for device:', deviceName)
  console.log('[DAEMON-SYNC-PULL] clientId:', clientId, 'deviceId:', deviceId)
  console.log('[DAEMON-SYNC-PULL] ==========================================')
  
  try {
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 50,
      message: 'Descargando items del servidor...',
      stage: 'pull'
    })
    
    const axiosInstance = getAxiosInstance()
    const url = '/clipboard'
    
    // Usar 'since' para sincronizar solo cambios del día de hoy (si no es la primera vez)
    // Obtener la fecha de inicio del día de hoy en formato ISO
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const since = today.toISOString()
    
    const params = { clientId, deviceId, since }
    
    console.log('[DAEMON-HTTP] GET /clipboard params:', params)
    const res = await axiosInstance.get(url, { params })
    console.log('[DAEMON-HTTP] GET /clipboard status:', res.status)
    
    const data = res?.data
    console.log('[DAEMON-SYNC-PULL] Response data structure:', {
      success: data?.success,
      hasData: !!data?.data,
      hasItems: !!data?.data?.items,
      itemsIsArray: Array.isArray(data?.data?.items),
      itemsLength: Array.isArray(data?.data?.items) ? data.data.items.length : 'N/A'
    })
    
    const items = (data && typeof data === 'object' && data.data?.items)
      ? data.data.items
      : (Array.isArray(data?.data) ? data.data : [])
    
    console.log('[DAEMON-SYNC-PULL] Extracted items from response:', items.length)
    
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
    
    console.log('[DAEMON-SYNC-PULL] Mapped items:', mappedItems.length)
    
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 60,
      message: `Procesando ${mappedItems.length} items...`,
      stage: 'pull'
    })
    
    // Procesar items en batches de 100 con Promise.all
    const BATCH_SIZE = 100
    let updated = 0
    let inserted = 0
    
    console.log('[DAEMON-SYNC-PULL] Processing', mappedItems.length, 'items in batches of', BATCH_SIZE, 'with Promise.all')
    
    // Procesar en batches de 100
    for (let batchStart = 0; batchStart < mappedItems.length; batchStart += BATCH_SIZE) {
      if (syncCanceled) {
        console.log('[DAEMON-SYNC-PULL] Sync canceled, stopping pull')
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
      
      // Actualizar progreso después de cada batch
      const percentage = 60 + Math.round((batchEnd / mappedItems.length) * 30)
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
    
    console.log('[DAEMON-SYNC-PULL] Pull completed:', {
      received: mappedItems.length,
      inserted,
      updated
    })
    
    return { received: mappedItems.length, inserted, updated }
  } catch (error) {
    console.error('[DAEMON-SYNC-PULL] Pull error:', error)
    console.error('[DAEMON-SYNC-PULL] Error stack:', error.stack)
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
    console.error('[DAEMON] clearAll error:', error)
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
    console.error('[DAEMON] clearDeviceHistory error:', error)
    return false
  }
}

// ============================================================================
// MIGRACIÓN - Clear local history and reload from server
// ============================================================================

async function performMigration(deviceName) {
  console.log('[DAEMON-MIGRATE] ==========================================')
  console.log('[DAEMON-MIGRATE] performMigration called for device:', deviceName)
  console.log('[DAEMON-MIGRATE] ==========================================')
  
  // Verificar si la migración ya se ejecutó (guardado en DB)
  const migrationCompletedInDB = getConfig('migration_completed')
  if (migrationCompletedInDB === 'true') {
    console.log('[DAEMON-MIGRATE] Migration already completed (saved in DB), skipping...')
    migrationCompleted = true
    return
  }
  
  if (migrationInProgress) {
    console.warn('[DAEMON-MIGRATE] Migration already in progress, skipping...')
    return
  }
  
  if (migrationCompleted) {
    console.log('[DAEMON-MIGRATE] Migration already completed (in-memory flag), skipping...')
    return
  }
  
  migrationInProgress = true
  
  try {
    console.log('[DAEMON-MIGRATE] Step 0: Starting migration...')
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 0,
      message: 'Iniciando migración...',
      stage: 'migration'
    })
    
    if (!config.authToken || !config.backendUrl) {
      throw new Error('No auth token or backend URL configured')
    }
    
    console.log('[DAEMON-MIGRATE] Config check OK:', {
      hasAuthToken: !!config.authToken,
      backendUrl: config.backendUrl
    })
    
    // Ensure device is registered
    console.log('[DAEMON-MIGRATE] Step 1: Registering device...')
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 5,
      message: 'Registrando dispositivo...',
      stage: 'migration'
    })
    
    // Primero intentar obtener el dispositivo por clientId (deviceName)
    let device = getDeviceByClientId(deviceName)
    
    // Si no se encuentra, intentar registrar/obtener el dispositivo
    if (!device || !device.id) {
      device = await ensureDeviceRegistered()
      if (!device || !device.id) {
        throw new Error('Device registration failed')
      }
    }
    
    console.log('[DAEMON-MIGRATE] Device registered:', {
      id: device.id,
      clientId: device.clientId,
      name: device.name
    })
    
    const clientId = device.clientId || deviceName
    const deviceId = device.id
    
    // Usar el clientId del dispositivo para guardar los items (puede ser diferente al deviceName)
    const targetDeviceName = clientId || deviceName
    
    // Step 1: Clear local history for the selected device only
    console.log('[DAEMON-MIGRATE] Step 2: Clearing local history for device:', targetDeviceName)
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 10,
      message: 'Limpiando historial del dispositivo...',
      stage: 'migration'
    })
    
    // Clear history only for the selected device (usar clientId si está disponible)
    const cleared = clearDeviceHistory(targetDeviceName)
    console.log('[DAEMON-MIGRATE] Local history cleared for device:', targetDeviceName, 'result:', cleared)
    
    // Step 2: Fetch all items from server
    console.log('[DAEMON-MIGRATE] Step 3: Fetching items from server...')
    console.log('[DAEMON-MIGRATE] Request params:', { clientId, deviceId })
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 20,
      message: 'Descargando items del servidor...',
      stage: 'migration'
    })
    
    const axiosInstance = getAxiosInstance()
    const url = '/clipboard'
    const params = { clientId, deviceId }
    
    console.log('[DAEMON-MIGRATE] GET', url, 'with params:', params)
    const res = await axiosInstance.get(url, { params })
    console.log('[DAEMON-MIGRATE] GET response status:', res.status)
    
    const data = res?.data
    console.log('[DAEMON-MIGRATE] Response data structure:', {
      success: data?.success,
      hasData: !!data?.data,
      hasItems: !!data?.data?.items,
      itemsIsArray: Array.isArray(data?.data?.items),
      itemsLength: Array.isArray(data?.data?.items) ? data.data.items.length : 'N/A'
    })
    
    const items = (data && typeof data === 'object' && data.data?.items)
      ? data.data.items
      : (Array.isArray(data?.data) ? data.data : [])
    
    console.log('[DAEMON-MIGRATE] Extracted items from response:', items.length)
    
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
    
    // Step 3: Save all items to local database (in batches)
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 30,
      message: `Guardando ${mappedItems.length} items...`,
      stage: 'migration'
    })
    
    const BATCH_SIZE = 100
    let saved = 0
    let failed = 0
    
    // Procesar en batches
    for (let batchStart = 0; batchStart < mappedItems.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, mappedItems.length)
      const batch = mappedItems.slice(batchStart, batchEnd)
      
      // Procesar todo el batch en paralelo con Promise.all
      const batchPromises = batch.map(async (item) => {
        try {
          updateItemFromServer(item, targetDeviceName)
          return { success: true }
        } catch (itemError) {
          return { success: false }
        }
      })
      
      // Esperar a que todo el batch termine en paralelo
      const results = await Promise.all(batchPromises)
      results.forEach(result => {
        if (result.success) {
          saved++
        } else {
          failed++
        }
      })
      
      // Actualizar progreso después de cada batch
      const percentage = 30 + Math.round((batchEnd / mappedItems.length) * 60)
      sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
        percentage: percentage,
        message: `Guardando ${batchEnd}/${mappedItems.length} items...`,
        stage: 'migration'
      })
      
      // Liberar event loop brevemente entre batches
      if (batchEnd < mappedItems.length) {
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    
    // Mark device as migrated
    markDeviceAsMigrated(targetDeviceName)
    
    // Mark as completed y guardar en DB
    migrationCompleted = true
    migrationInProgress = false
    setConfig('migration_completed', 'true')
    
    sendMessage(MESSAGE_TYPES.MIGRATION_DONE, {
      percentage: 100,
      message: `Migración completada: ${saved} items guardados`,
      saved,
      failed,
      total: mappedItems.length
    })
    
  } catch (error) {
    migrationInProgress = false
    sendMessage(MESSAGE_TYPES.MIGRATION_ERROR, {
      error: error.message,
      details: error.stack
    })
  }
}

// ============================================================================
// FLUJO DE SYNC PRINCIPAL
// ============================================================================

async function performSync(deviceName) {
  console.log('[DAEMON-SYNC] ==========================================')
  console.log('[DAEMON-SYNC] performSync called for device:', deviceName)
  console.log('[DAEMON-SYNC] ==========================================')
  
  if (syncInProgress) {
    console.warn('[DAEMON-SYNC] Sync already in progress, skipping...')
    return
  }
  
  syncInProgress = true
  syncCanceled = false
  
  try {
    console.log('[DAEMON-SYNC] Step 0: Starting sync...')
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 0,
      message: 'Iniciando sincronización...',
      stage: 'start'
    })
    
    // 1. Refresh token si es necesario (se hace automáticamente en getAxiosInstance)
    
    // 2. Validar sesión
    if (!config.authToken || !config.backendUrl) {
      throw new Error('No auth token or backend URL configured')
    }
    
    console.log('[DAEMON-SYNC] Config check OK:', {
      hasAuthToken: !!config.authToken,
      backendUrl: config.backendUrl
    })
    
    // 3. Asegurar dispositivo registrado
    console.log('[DAEMON-SYNC] Step 1: Ensuring device registered...')
    sendMessage(MESSAGE_TYPES.SYNC_PROGRESS, {
      percentage: 5,
      message: 'Registrando dispositivo...',
      stage: 'device'
    })
    
    // Primero intentar obtener el dispositivo por clientId (deviceName)
    let device = getDeviceByClientId(deviceName)
    
    // Si no se encuentra, intentar registrar/obtener el dispositivo
    if (!device || !device.id) {
      device = await ensureDeviceRegistered()
      if (!device || !device.id) {
        throw new Error('Device registration failed')
      }
    }
    
    console.log('[DAEMON-SYNC] Device registered:', {
      id: device.id,
      clientId: device.clientId,
      name: device.name
    })
    
    const clientId = device.clientId || deviceName
    const deviceId = device.id // UUID del dispositivo
    
    // Usar el clientId del dispositivo para guardar los items (puede ser diferente al deviceName)
    const targetDeviceName = clientId || deviceName
    
    console.log('[DAEMON-SYNC] Device identifiers:', {
      deviceName,
      clientId,
      deviceId,
      targetDeviceName
    })
    
    // Recargar base de datos antes de hacer pull para ver los cambios más recientes del main process
    // Esto asegura que cualquier cambio local (como favoritos marcados) se preserve
    reloadDatabase()
    
    // 4. Pull (Full en primera ejecución, incremental con since en las siguientes)
    console.log('[DAEMON-SYNC] Step 2: Pulling items from server...')
    const pullResult = await pullItems(targetDeviceName, clientId, deviceId)
    console.log('[DAEMON-SYNC] Pull completed:', pullResult)
    
    // 5. Push (desde local → remoto)
    // IMPORTANTE: Buscar items pendientes por TODOS los devices posibles
    // porque puede haber items guardados con diferentes nombres de device
    console.log('[DAEMON-SYNC] Step 3: Pushing pending items to server...')
    console.log('[DAEMON-SYNC] Calling pushPendingItems with:', {
      deviceName: targetDeviceName,
      clientId,
      deviceId
    })
    
    // Intentar push con el targetDeviceName primero
    let pushResult = await pushPendingItems(targetDeviceName, clientId, deviceId)
    
    // Si no hay items pendientes, intentar con el deviceName original
    if (pushResult.successful === 0 && pushResult.failed === 0) {
      console.log('[DAEMON-SYNC] No pending items found for', targetDeviceName, '- trying with', deviceName)
      pushResult = await pushPendingItems(deviceName, clientId, deviceId)
    }
    
    // Si aún no hay items, buscar TODOS los items pendientes sin filtrar por device
    if (pushResult.successful === 0 && pushResult.failed === 0) {
      console.log('[DAEMON-SYNC] No pending items found for specific device - trying to push ALL pending items...')
      try {
        const allPendingStmt = db.prepare('SELECT DISTINCT device FROM history WHERE pending=1 AND is_deleted=0')
        const devicesWithPending = []
        while (allPendingStmt.step()) {
          const r = allPendingStmt.getAsObject()
          devicesWithPending.push(String(r.device))
        }
        allPendingStmt.free()
        
        console.log('[DAEMON-SYNC] Found devices with pending items:', devicesWithPending)
        
        // Push items de cada device que tenga items pendientes
        for (const pendingDevice of devicesWithPending) {
          console.log('[DAEMON-SYNC] Pushing pending items for device:', pendingDevice)
          const devicePushResult = await pushPendingItems(pendingDevice, clientId, deviceId)
          pushResult.successful += devicePushResult.successful
          pushResult.failed += devicePushResult.failed
        }
      } catch (e) {
        console.error('[DAEMON-SYNC] Error pushing all pending items:', e)
      }
    }
    
    console.log('[DAEMON-SYNC] Push completed:', pushResult)
    
    // 6. Resolver conflictos por version (ya se hace en updateItemFromServer)
    
    // 7. Guardar lastSyncAt
    const lastSyncAt = new Date().toISOString()
    updateDeviceLastSyncAt(lastSyncAt)
    console.log('[DAEMON-SYNC] LastSyncAt updated:', lastSyncAt)
    
    // 8. Emitir estados de progreso final
    console.log('[DAEMON-SYNC] ==========================================')
    console.log('[DAEMON-SYNC] Sync completed successfully:')
    console.log('[DAEMON-SYNC] - Pull: received:', pullResult.received, 'inserted:', pullResult.inserted, 'updated:', pullResult.updated)
    console.log('[DAEMON-SYNC] - Push: successful:', pushResult.successful, 'failed:', pushResult.failed)
    console.log('[DAEMON-SYNC] ==========================================')
    
    sendMessage(MESSAGE_TYPES.SYNC_DONE, {
      percentage: 100,
      message: 'Sincronización completada',
      pushResult,
      pullResult,
      stage: 'done'
    })
    
  } catch (error) {
    console.error('[DAEMON-SYNC] ==========================================')
    console.error('[DAEMON-SYNC] Sync ERROR:', error.message)
    console.error('[DAEMON-SYNC] Stack:', error.stack)
    console.error('[DAEMON-SYNC] ==========================================')
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
    console.log('[DAEMON] Received message:', msg.type, msg.deviceName ? `device: ${msg.deviceName}` : '')
    
    switch (msg.type) {
      case 'INIT':
        console.log('[DAEMON] Initializing database with userDataPath:', msg.userDataPath)
        await initDatabase(msg.userDataPath)
        break
        
      case MESSAGE_TYPES.SET_CONFIG:
        console.log('[DAEMON] Setting config:', {
          hasBackendUrl: !!msg.config?.backendUrl,
          hasAuthToken: !!msg.config?.authToken,
          userDataPath: msg.config?.userDataPath,
          hasSession: !!msg.config?.session
        })
        config = { ...config, ...msg.config }
        
        // Si se pasa una sesión en el config, guardarla en la base de datos
        if (msg.config?.session) {
          try {
            const sessionData = typeof msg.config.session === 'string' 
              ? JSON.parse(msg.config.session) 
              : msg.config.session
            setConfig('session', JSON.stringify(sessionData))
            console.log('[DAEMON] Session saved to database from SET_CONFIG')
          } catch (e) {
            console.error('[DAEMON] Error saving session from SET_CONFIG:', e)
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
                console.log('[DAEMON] Loaded authToken from database session')
              }
            }
          } catch (e) {
            console.error('[DAEMON] Error loading session from database:', e)
          }
        }
        break
        
      case MESSAGE_TYPES.SYNC_START:
        console.log('[DAEMON] ==========================================')
        console.log('[DAEMON] SYNC_START message received')
        console.log('[DAEMON] Device name:', msg.deviceName)
        console.log('[DAEMON] Config state:', {
          hasAuthToken: !!config.authToken,
          hasBackendUrl: !!config.backendUrl,
          backendUrl: config.backendUrl
        })
        console.log('[DAEMON] ==========================================')
        if (msg.deviceName) {
          console.log('[DAEMON] Calling performSync for device:', msg.deviceName)
          await performSync(msg.deviceName)
          console.log('[DAEMON] performSync completed')
        } else {
          console.warn('[DAEMON] SYNC_START received but no deviceName provided')
        }
        break
        
      case MESSAGE_TYPES.MIGRATION_START:
        if (msg.deviceName) {
          await performMigration(msg.deviceName)
        }
        break
        
      case MESSAGE_TYPES.SYNC_CANCEL:
        console.log('[DAEMON] SYNC_CANCEL received')
        syncCanceled = true
        break
        
      case MESSAGE_TYPES.SHUTDOWN:
        console.log('[DAEMON] SHUTDOWN received, persisting database and exiting...')
        if (db) {
          persistDatabase()
        }
        process.exit(0)
        break
        
      case MESSAGE_TYPES.RELOAD_DATABASE:
        console.log('[DAEMON] RELOAD_DATABASE received, reloading from file...')
        reloadDatabase()
        break
        
      default:
        console.warn('[DAEMON] Unknown message type:', msg.type)
    }
  } catch (error) {
    console.error('[DAEMON] Message handler error:', error)
    console.error('[DAEMON] Error stack:', error.stack)
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
  console.error('[DAEMON] Uncaught exception:', error)
  sendMessage(MESSAGE_TYPES.SYNC_ERROR, {
    error: error.message,
    details: error.stack
  })
})

process.on('unhandledRejection', (reason) => {
  console.error('[DAEMON] Unhandled rejection:', reason)
  sendMessage(MESSAGE_TYPES.SYNC_ERROR, {
    error: 'Unhandled rejection',
    details: String(reason)
  })
})

// Señal de ready inicial (si ya tenemos la ruta)
if (process.argv[2]) {
  initDatabase(process.argv[2]).catch(console.error)
}
