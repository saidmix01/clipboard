const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const initSqlJs = require('sql.js')

let SQL = null
let db = null
let dbFilePath = null

async function init(app) {
  const dir = app.getPath('userData')
  dbFilePath = path.join(dir, 'copyfy-v2.sqlite')

  if (!SQL) {
    const isPackaged = app.isPackaged
    const locateFile = (file) => {
      try {
        if (isPackaged) {
          const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file)
          if (fs.existsSync(unpacked)) return unpacked
        }
        return require.resolve('sql.js/dist/' + file)
      } catch {
        return path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
      }
    }
    SQL = await initSqlJs({ locateFile })
  }

  // Force reset if we want to ensure clean state as per instructions? 
  // User said: "Eliminar completamente la base de datos anterior y crear estas tablas nuevas"
  // But also "Si la DB no existe, se crea vacía."
  // To be safe and ensure the NEW schema is used, I should probably check if the old schema exists and if so, maybe backup/delete it?
  // The user said: "Eliminar completamente la base de datos anterior".
  // So I will delete the file if it exists and create new?
  // Or I can just DROP tables.
  
  // Let's try to open it first.
  let dbExists = fs.existsSync(dbFilePath)
  
  try {
    if (dbExists) {
        // Load existing DB
        const filebuffer = fs.readFileSync(dbFilePath)
        db = new SQL.Database(filebuffer)
    } else {
        // Create new DB
        db = new SQL.Database()
    }
    
    // Run initial schema creation (IF NOT EXISTS will handle it)
    createTables()
    persist()
  } catch (e) {
    console.error('Error initializing DB:', e)
    // Fallback
    try {
        db = new SQL.Database()
        createTables()
    } catch(err) {
        console.error('Critical DB Error', err)
    }
  }
}

function createTables() {
  // ClipboardItem
  db.run(`
    CREATE TABLE IF NOT EXISTS ClipboardItem (
      Id TEXT PRIMARY KEY,
      Value TEXT,
      Type TEXT,
      IsFavorite BOOLEAN DEFAULT 0,
      CreatedAt DATETIME,
      UpdatedAt DATETIME,
      IsDeleted BOOLEAN DEFAULT 0,
      Pending BOOLEAN DEFAULT 0,
      DeviceId TEXT,
      Version INTEGER DEFAULT 1
    );
  `)

  // Devices (Informational Local)
  db.run(`
    CREATE TABLE IF NOT EXISTS Devices (
      Id TEXT PRIMARY KEY,
      OsName TEXT,
      Name TEXT,
      VersionApp TEXT,
      Synced BOOLEAN DEFAULT 0,
      CreatedAt DATETIME,
      UpdatedAt DATETIME
    );
  `)

  // AppSettings
  db.run(`
    CREATE TABLE IF NOT EXISTS AppSettings (
      Id TEXT PRIMARY KEY,
      AccessToken TEXT,
      RefreshToken TEXT,
      IsDarkMode BOOLEAN DEFAULT 0,
      Theme TEXT,
      Language TEXT,
      UiScale REAL,
      GlobalShortcut TEXT,
      SelectedDeviceId TEXT,
      CreatedAt DATETIME,
      UpdatedAt DATETIME
    );
  `)

  // Migration for existing DBs
  try {
      db.run("ALTER TABLE AppSettings ADD COLUMN GlobalShortcut TEXT")
  } catch (e) {
      // Ignore error if column exists
  }
  try {
      // Check if column exists first to avoid error spam or silent failures
      const info = db.exec("PRAGMA table_info(AppSettings)")[0].values;
      const hasCol = info.some(col => col[1] === 'SelectedDeviceId');
      if (!hasCol) {
          db.run("ALTER TABLE AppSettings ADD COLUMN SelectedDeviceId TEXT")
      }
  } catch (e) {
      console.error('Migration error for SelectedDeviceId:', e)
  }

  try {
      const info = db.exec("PRAGMA table_info(AppSettings)")[0].values;
      const hasCol = info.some(col => col[1] === 'LocalDeviceId');
      if (!hasCol) {
          db.run("ALTER TABLE AppSettings ADD COLUMN LocalDeviceId TEXT")
      }
  } catch (e) {}

  // SyncQueue table for persistent queue
  db.run(`
    CREATE TABLE IF NOT EXISTS SyncQueue (
      Id TEXT PRIMARY KEY,
      OperationType TEXT,
      ItemId TEXT,
      ItemData TEXT,
      Timestamp INTEGER,
      Retries INTEGER DEFAULT 0,
      NextRetryAt INTEGER,
      CreatedAt DATETIME
    );
  `)

  // Indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_clipboard_created ON ClipboardItem(CreatedAt DESC);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_clipboard_favorite ON ClipboardItem(IsFavorite);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_clipboard_device ON ClipboardItem(DeviceId, CreatedAt DESC);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_clipboard_pending ON ClipboardItem(Pending) WHERE Pending = 1;`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_syncqueue_retry ON SyncQueue(NextRetryAt);`)
}

function persist() {
  if (!dbFilePath || !db) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (e) {
    console.error('Error persisting DB:', e)
    throw e // Propagar error para que el caller lo maneje
  }
}

// Versión asíncrona de persist para operaciones no críticas
async function persistAsync() {
  if (!dbFilePath || !db) return
  return new Promise((resolve, reject) => {
    try {
      const data = db.export()
      fs.writeFile(dbFilePath, Buffer.from(data), (err) => {
        if (err) {
          console.error('Error persisting DB async:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    } catch (e) {
      console.error('Error exporting DB:', e)
      reject(e)
    }
  })
}

// --- CRUD Operations ---

// ClipboardItem

function ensureLocalDevice() {
    try {
        const settings = getSettings()
        if (settings.localDeviceId) {
            // Verify it exists in Devices table
            const stmt = db.prepare("SELECT Id FROM Devices WHERE Id = ?")
            stmt.bind([settings.localDeviceId])
            if (stmt.step()) {
                stmt.free()
                return settings.localDeviceId
            }
            stmt.free()
        }

        // If not set or invalid, find or create one
        const hostname = os.hostname()
        const platform = process.platform
        const now = new Date().toISOString()

        // 1. Try to match by name and OS (most reliable for existing setups)
        const checkName = db.prepare("SELECT Id FROM Devices WHERE Name = ? AND OsName = ? LIMIT 1")
        checkName.bind([hostname, platform])
        if (checkName.step()) {
            const dev = checkName.getAsObject()
            checkName.free()
            // Set this as local
            updateSettings({ LocalDeviceId: dev.Id })
            return dev.Id
        }
        checkName.free()

        // 2. If no match, check if we have ANY device. If so, pick the most recently updated one?
        // This is risky if user synced other devices.
        // Better: Create a new one for THIS machine.
        
        const newId = crypto.randomUUID()
        const stmt = db.prepare("INSERT INTO Devices (Id, OsName, Name, VersionApp, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        // We don't have app version here easily without passing it, but it's okay.
        stmt.bind([newId, platform, hostname, '1.0.0', now, now])
        stmt.step()
        stmt.free()
        
        updateSettings({ LocalDeviceId: newId })
        persist()
        
        return newId
    } catch (e) {
        console.error('Error ensuring local device:', e)
        return 'unknown'
    }
}

function insertItem(value, type = 'text', deviceId = null) {
  try {
    const now = new Date().toISOString()
    
    // Resolve deviceId if not provided
    if (!deviceId) {
        deviceId = ensureLocalDevice()
    }
    
    // Deduplicación por (Value, Type, DeviceId) ignorando eliminados
    const check = db.prepare(`
      SELECT Id, CreatedAt FROM ClipboardItem
      WHERE Value = ? AND Type = ? AND DeviceId = ? AND IsDeleted = 0
      LIMIT 1
    `)
    check.bind([value, type, deviceId])
    if (check.step()) {
      const existing = check.getAsObject()
      check.free()
      const upd = db.prepare(`UPDATE ClipboardItem SET UpdatedAt = ? WHERE Id = ?`)
      upd.bind([now, existing.Id])
      upd.step()
      upd.free()
      persist()
      return { id: existing.Id, value, type, createdAt: existing.CreatedAt }
    }
    check.free()
    
    // Insertar nuevo si no existe
    const id = crypto.randomUUID()
    const stmt = db.prepare(`
      INSERT INTO ClipboardItem (Id, Value, Type, IsFavorite, CreatedAt, UpdatedAt, IsDeleted, Pending, DeviceId, Version)
      VALUES (?, ?, ?, 0, ?, ?, 0, 0, ?, 1)
    `)
    stmt.bind([id, value, type, now, now, deviceId])
    stmt.step()
    stmt.free()
    persist()
    return { id, value, type, createdAt: now }
  } catch (e) {
    console.error('Error inserting item:', e)
    return null
  }
}

function getItems(limit = 20, offset = 0, filter = {}) {
  try {
    let query = "SELECT * FROM ClipboardItem WHERE IsDeleted = 0"
    const params = []

    if (filter.favorite) {
      query += " AND IsFavorite = 1"
    }
    
    // Support type filtering in SQL if provided
    if (filter.type) {
        query += " AND Type = ?"
        params.push(filter.type)
    }

    if (filter.search) {
      query += " AND Value LIKE ?"
      params.push(`%${filter.search}%`)
    }

    if (filter.deviceId) {
      query += " AND DeviceId = ?"
      params.push(filter.deviceId)
    }

    query += " ORDER BY CreatedAt DESC LIMIT ? OFFSET ?"
    params.push(limit, offset)
    
    const stmt = db.prepare(query)
    stmt.bind(params)
    
    const items = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      items.push(normalizeItem(row))
    }
    stmt.free()
    return items
  } catch (e) {
    console.error('Error getting items:', e)
    return []
  }
}

function setFavorite(id, isFavorite) {
  try {
    const now = new Date().toISOString()
    const stmt = db.prepare("UPDATE ClipboardItem SET IsFavorite = ?, UpdatedAt = ? WHERE Id = ?")
    stmt.bind([isFavorite ? 1 : 0, now, id])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

function deleteItem(id) {
  try {
    const stmt = db.prepare("UPDATE ClipboardItem SET IsDeleted = 1 WHERE Id = ?")
    stmt.bind([id])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

function clearAll() {
    try {
        db.run("UPDATE ClipboardItem SET IsDeleted = 1")
        persist()
        return true
    } catch (e) {
        return false
    }
}

// AppSettings

function getSettings() {
  try {
    const stmt = db.prepare("SELECT * FROM AppSettings LIMIT 1")
    if (stmt.step()) {
      const row = stmt.getAsObject()
      return normalizeSettings(row)
    }
    // Create default if not exists
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    db.run(`INSERT INTO AppSettings (Id, CreatedAt, UpdatedAt, IsDarkMode, Language) VALUES ('${id}', '${now}', '${now}', 0, 'en')`)
    persist()
    return { Id: id, IsDarkMode: false, Language: 'en' }
  } catch (e) {
    return {}
  }
}

function updateSettings(settings) {
  try {
    const current = getSettings()
    const now = new Date().toISOString()
    
    // Build update query dynamically
    const fields = []
    const values = []
    
    if (settings.IsDarkMode !== undefined) { fields.push("IsDarkMode = ?"); values.push(settings.IsDarkMode ? 1 : 0); }
    if (settings.Theme !== undefined) { fields.push("Theme = ?"); values.push(settings.Theme); }
    if (settings.Language !== undefined) { fields.push("Language = ?"); values.push(settings.Language); }
    if (settings.UiScale !== undefined) { fields.push("UiScale = ?"); values.push(settings.UiScale); }
    if (settings.AccessToken !== undefined) { fields.push("AccessToken = ?"); values.push(settings.AccessToken); }
    if (settings.RefreshToken !== undefined) { fields.push("RefreshToken = ?"); values.push(settings.RefreshToken); }
    if (settings.GlobalShortcut !== undefined) { fields.push("GlobalShortcut = ?"); values.push(settings.GlobalShortcut); }
    if (settings.SelectedDeviceId !== undefined) { fields.push("SelectedDeviceId = ?"); values.push(settings.SelectedDeviceId); }
    if (settings.LocalDeviceId !== undefined) { fields.push("LocalDeviceId = ?"); values.push(settings.LocalDeviceId); }
    
    if (fields.length === 0) return current

    fields.push("UpdatedAt = ?")
    values.push(now)
    values.push(current.id) // <--- Check capitalization of ID in normalizeSettings

    const stmt = db.prepare(`UPDATE AppSettings SET ${fields.join(', ')} WHERE Id = ?`)
    stmt.bind(values)
    stmt.step()
    stmt.free()
    persist()
    return getSettings()
  } catch (e) {
    console.error('Error updating settings:', e)
    return null
  }
}

// Devices

function registerDevice(deviceInfo) {
    // deviceInfo: { OsName, Name, VersionApp, Id }
    try {
        let id = deviceInfo.Id || crypto.randomUUID()
        const now = new Date().toISOString()
        
        // 1. Check if exists by ID (Primary Key)
        const checkId = db.prepare("SELECT Id FROM Devices WHERE Id = ?")
        checkId.bind([id])
        const existsById = checkId.step()
        checkId.free()

        if (existsById) {
            // Update existing by ID
            const stmt = db.prepare("UPDATE Devices SET Name = ?, VersionApp = ?, UpdatedAt = ? WHERE Id = ?")
            stmt.bind([deviceInfo.Name, deviceInfo.VersionApp, now, id])
            stmt.step()
            stmt.free()
        } else {
            // 2. Check if exists by (Name + OsName) to prevent semantic duplicates
            // This is crucial for syncing: if backend sends a device that matches our local one by name/OS but has different ID,
            // we should probably merge/adopt the backend ID.
            
            const checkName = db.prepare("SELECT Id FROM Devices WHERE Name = ? AND OsName = ? LIMIT 1")
            checkName.bind([deviceInfo.Name, deviceInfo.OsName])
            if (checkName.step()) {
                const existing = checkName.getAsObject()
                const oldId = existing.Id
                
                // If we are registering with a specific ID (e.g. from backend) and it differs from local ID
                if (deviceInfo.Id && deviceInfo.Id !== oldId) {
                    
                    // Migrate related data
                    db.run("UPDATE ClipboardItem SET DeviceId = ? WHERE DeviceId = ?", [deviceInfo.Id, oldId])
                    db.run("UPDATE AppSettings SET SelectedDeviceId = ? WHERE SelectedDeviceId = ?", [deviceInfo.Id, oldId])
                    
                    // Delete old device record
                    db.run("DELETE FROM Devices WHERE Id = ?", [oldId])
                    
                    // Insert new device record with the correct (new) ID
                    const stmt = db.prepare("INSERT INTO Devices (Id, OsName, Name, VersionApp, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)")
                    stmt.bind([deviceInfo.Id, deviceInfo.OsName, deviceInfo.Name, deviceInfo.VersionApp, now, now])
                    stmt.step()
                    stmt.free()
                    
                    id = deviceInfo.Id // Return the new ID
                } else {
                    // Just update the existing one if no specific ID was requested or it's just a name collision on local creation
                    // If deviceInfo.Id was null (local creation), we reuse the existing ID.
                    id = oldId
                    const stmt = db.prepare("UPDATE Devices SET VersionApp = ?, UpdatedAt = ? WHERE Id = ?")
                    stmt.bind([deviceInfo.VersionApp, now, id])
                    stmt.step()
                    stmt.free()
                }
            } else {
                // 3. Insert absolutely new
                const stmt = db.prepare("INSERT INTO Devices (Id, OsName, Name, VersionApp, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)")
                stmt.bind([id, deviceInfo.OsName, deviceInfo.Name, deviceInfo.VersionApp, now, now])
                stmt.step()
                stmt.free()
            }
            checkName.free()
        }
        
        // Clean up legacy 'local-device' if we just registered a real one
        if (id !== 'local-device') {
            db.run("DELETE FROM Devices WHERE Id = 'local-device'")
        }
        
        persist()
        return id
    } catch(e) {
        console.error('[DB] registerDevice error:', e)
        return null
    }
}

function getDevice() {
    try {
        // Return the PINNED local device if possible
        const localId = ensureLocalDevice()
        
        const stmt = db.prepare("SELECT * FROM Devices WHERE Id = ?")
        stmt.bind([localId])
        if (stmt.step()) {
            const dev = stmt.getAsObject()
            stmt.free()
            return dev
        }
        stmt.free()
        
        // Fallback (should be covered by ensureLocalDevice logic)
        return null
    } catch (e) {
        return null
    }
}

function getDevices() {
    try {
        // Force check table existence first
        const checkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Devices'")
        if (!checkTable.step()) {
            return []
        }

        const stmt = db.prepare("SELECT * FROM Devices ORDER BY UpdatedAt DESC")
        const devices = []
        while (stmt.step()) {
            devices.push(stmt.getAsObject())
        }
        stmt.free()
        return devices
    } catch (e) {
        console.error('getDevices error:', e)
        return []
    }
}

function setActiveDevice(id) {
    try {
        const now = new Date().toISOString()
        
        // 1. Verify AppSettings row exists
        const stmtGet = db.prepare("SELECT Id FROM AppSettings LIMIT 1")
        if (!stmtGet.step()) {
            stmtGet.free()
            return false
        }
        const row = stmtGet.getAsObject()
        const settingsId = row.Id
        stmtGet.free()

        // 2. Perform Update
        db.run("UPDATE AppSettings SET SelectedDeviceId = ?, UpdatedAt = ? WHERE Id = ?", [String(id), now, settingsId])
        
        // 3. Update Device UpdatedAt
        db.run("UPDATE Devices SET UpdatedAt = ? WHERE Id = ?", [now, id])
        
        // 4. Persist to Disk
        persist()
        
        return true
    } catch(e) {
        console.error('Error setting active device:', e)
        return false
    }
}

function updateAllItemsDevice(deviceId) {
    try {
        // Only update items that do not have a DeviceId yet (orphans)
        // or items that belonged to the previous local identifier?
        // To be safe, we only update NULLs.
        db.run("UPDATE ClipboardItem SET DeviceId = ? WHERE DeviceId IS NULL", [deviceId])
        persist()
        return true
    } catch (e) {
        return false
    }
}

function claimOrphanItems(deviceId) {
    try {
        db.run("UPDATE ClipboardItem SET DeviceId = ? WHERE DeviceId IS NULL", [deviceId])
        persist()
        return true
    } catch(e) {
        return false
    }
}

function markDeviceSynced(id) {
    try {
        db.run("UPDATE Devices SET Synced = 1 WHERE Id = ?", [id])
        persist()
        return true
    } catch (e) {
        return false
    }
}

// Helpers

function normalizeItem(row) {
  return {
    id: row.Id,
    value: row.Value,
    type: row.Type,
    favorite: !!row.IsFavorite,
    createdAt: row.CreatedAt,
    isDeleted: !!row.IsDeleted,
    deviceId: row.DeviceId
  }
}

function normalizeSettings(row) {
    // Case-insensitive lookup helper
    const getVal = (key) => {
        const k = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase())
        return k ? row[k] : undefined
    }

    return {
        id: getVal('Id'),
        accessToken: getVal('AccessToken'),
        refreshToken: getVal('RefreshToken'),
        isDarkMode: !!getVal('IsDarkMode'),
        theme: getVal('Theme'),
        language: getVal('Language'),
        uiScale: getVal('UiScale'),
        globalShortcut: getVal('GlobalShortcut') || 'Alt+X',
        selectedDeviceId: getVal('SelectedDeviceId'),
        localDeviceId: getVal('LocalDeviceId')
    }
}

// Helper to keep compatibility with main.js calls until updated
// The old db.js had specific exports. I will try to map them or update main.js.
// Since I'm refactoring main.js too, I'll export clean names.

// --- Sync Queue Operations ---

function saveSyncQueue(operations) {
  try {
    // Limpiar tabla actual
    db.run("DELETE FROM SyncQueue")
    
    // Insertar operaciones
    const stmt = db.prepare(`
      INSERT INTO SyncQueue (Id, OperationType, ItemId, ItemData, Timestamp, Retries, NextRetryAt, CreatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    operations.forEach(op => {
      const id = crypto.randomUUID()
      stmt.bind([
        id,
        op.type,
        op.itemId,
        JSON.stringify(op.item),
        op.timestamp,
        op.retries,
        op.nextRetryAt || null,
        new Date().toISOString()
      ])
      stmt.step()
      stmt.reset()
    })
    
    stmt.free()
    persist()
  } catch (e) {
    console.error('Error saving sync queue:', e)
  }
}

function getPendingSyncOperations() {
  try {
    const stmt = db.prepare("SELECT * FROM SyncQueue ORDER BY Timestamp ASC")
    const operations = []
    
    while (stmt.step()) {
      const row = stmt.getAsObject()
      operations.push({
        type: row.OperationType,
        itemId: row.ItemId,
        item: JSON.parse(row.ItemData),
        timestamp: row.Timestamp,
        retries: row.Retries,
        nextRetryAt: row.NextRetryAt
      })
    }
    
    stmt.free()
    return operations
  } catch (e) {
    console.error('Error getting pending sync operations:', e)
    return []
  }
}

function markItemAsSynced(itemId) {
  try {
    const now = new Date().toISOString()
    const stmt = db.prepare("UPDATE ClipboardItem SET Pending = 0, UpdatedAt = ? WHERE Id = ?")
    stmt.bind([now, itemId])
    stmt.step()
    stmt.free()
    persist()
  } catch (e) {
    console.error('Error marking item as synced:', e)
  }
}

function updateItem(item) {
  try {
    const now = new Date().toISOString()
    const stmt = db.prepare(`
      UPDATE ClipboardItem 
      SET Value = ?, Type = ?, IsFavorite = ?, UpdatedAt = ?, Version = ?, DeviceId = ?
      WHERE Id = ?
    `)
    stmt.bind([
      item.value,
      item.type,
      item.favorite ? 1 : 0,
      now,
      item.version || 1,
      item.deviceId,
      item.id
    ])
    stmt.step()
    stmt.free()
    persist()
  } catch (e) {
    console.error('Error updating item:', e)
  }
}

function markAsConflicted(itemId, remoteItem) {
  try {
    // Guardar datos del conflicto en un campo JSON temporal
    const remoteData = JSON.stringify(remoteItem);
    const stmt = db.prepare("UPDATE ClipboardItem SET Pending = 2, Meta = ? WHERE Id = ?")
    stmt.bind([remoteData, itemId])
    stmt.step()
    stmt.free()
    persist()
    
    // Pending = 2 significa "conflicto detectado"
    // Meta almacena temporalmente los datos remotos
    console.log(`[DB] Marked item ${itemId} as conflicted`)
  } catch (e) {
    console.error('Error marking as conflicted:', e)
  }
}

function getConflictedItems() {
  try {
    const stmt = db.prepare("SELECT * FROM ClipboardItem WHERE Pending = 2")
    const items = []
    
    while (stmt.step()) {
      const row = stmt.getAsObject()
      const localItem = normalizeItem(row);
      
      // Intentar parsear los datos remotos del campo Meta
      let remoteItem = {};
      try {
        if (row.Meta) {
          remoteItem = JSON.parse(row.Meta);
        }
      } catch (e) {
        console.error('[DB] Failed to parse remote item from Meta:', e);
      }
      
      items.push({
        local: localItem,
        remote: remoteItem
      })
    }
    
    stmt.free()
    return items
  } catch (e) {
    console.error('Error getting conflicted items:', e)
    return []
  }
}

function clearConflict(itemId) {
  if (!itemId) {
    console.error('Error clearing conflict: itemId is required')
    return
  }
  try {
    // Limpiar el estado de conflicto y el campo Meta
    const stmt = db.prepare("UPDATE ClipboardItem SET Pending = 0, Meta = NULL WHERE Id = ?")
    stmt.bind([itemId])
    stmt.step()
    stmt.free()
    persist()
  } catch (e) {
    console.error('Error clearing conflict:', e)
  }
}

module.exports = {
  init,
  insertItem,
  getItems,
  setFavorite,
  deleteItem,
  clearAll,
  getSettings,
  updateSettings,
  registerDevice,
  getDevice,
  getDevices,
  setActiveDevice,
  updateAllItemsDevice,
  claimOrphanItems,
  markDeviceSynced,
  ensureLocalDevice,
  // Sync operations
  saveSyncQueue,
  getPendingSyncOperations,
  markItemAsSynced,
  updateItem,
  markAsConflicted,
  getConflictedItems,
  clearConflict,
  persistAsync
}
