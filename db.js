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
    
    // Si la base de datos está corrupta, intentar recuperarse eliminándola y creando una nueva
    if (e.message && e.message.includes('malformed')) {
        console.warn('DB corruption detected. Recreating database...')
        try {
            if (fs.existsSync(dbFilePath)) {
                // Backup corrupted file just in case
                const backupPath = dbFilePath + '.corrupted.' + Date.now()
                fs.copyFileSync(dbFilePath, backupPath)
                console.log('Corrupted DB backed up to:', backupPath)
                fs.unlinkSync(dbFilePath)
            }
        } catch (cleanupErr) {
            console.error('Failed to cleanup corrupted DB:', cleanupErr)
        }
    }

    // Fallback
    try {
        db = new SQL.Database()
        createTables()
        persist() // Save the fresh DB immediately
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
      LastSync DATETIME,
      CreatedAt DATETIME,
      UpdatedAt DATETIME
    );
  `)

  // Migrations for Devices table
  try {
      const info = db.exec("PRAGMA table_info(Devices)")[0].values;
      const hasCol = info.some(col => col[1] === 'LastSync');
      if (!hasCol) {
          db.run("ALTER TABLE Devices ADD COLUMN LastSync DATETIME")
      }
  } catch (e) {
      console.error('Migration error for LastSync:', e)
  }

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

  // Migration: Add StartMinimized column
  try {
      const info = db.exec("PRAGMA table_info(AppSettings)")[0].values;
      const hasCol = info.some(col => col[1] === 'StartMinimized');
      if (!hasCol) {
          db.run("ALTER TABLE AppSettings ADD COLUMN StartMinimized BOOLEAN DEFAULT 0")
      }
  } catch (e) {
      console.error('Migration error for StartMinimized:', e)
  }

  // Add Meta column to ClipboardItem for conflict resolution
  try {
      const info = db.exec("PRAGMA table_info(ClipboardItem)")[0].values;
      const hasCol = info.some(col => col[1] === 'Meta');
      if (!hasCol) {
          db.run("ALTER TABLE ClipboardItem ADD COLUMN Meta TEXT")
          console.log('[DB] Added Meta column to ClipboardItem')
      }
  } catch (e) {
      console.error('Migration error for Meta column:', e)
  }

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

  // Índice full-text para búsqueda rápida (FTS4)
  ensureFtsIndex()
}

// --- Full-Text Search (FTS4) ---
// El build de sql.js instalado compila FTS3/FTS4 (no FTS5). Usamos FTS4 con el
// tokenizer unicode61 (remove_diacritics=1): búsqueda por palabra/prefijo,
// insensible a mayúsculas y tildes. Indexamos SOLO items de texto no eliminados
// (las imágenes guardan base64 de varios MB y no aportan texto buscable).
//
// La tabla virtual usa el rowid de ClipboardItem como docid, de modo que los
// triggers pueden mantenerla sincronizada de forma barata (DELETE/INSERT por docid)
// sin importar por qué ruta del código se modifique ClipboardItem.
function ensureFtsIndex() {
  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ClipboardItem_fts USING fts4(
        Value,
        tokenize=unicode61 "remove_diacritics=1"
      );
    `)

    // Triggers de sincronización ClipboardItem -> ClipboardItem_fts
    db.run(`
      CREATE TRIGGER IF NOT EXISTS clipboard_fts_ai AFTER INSERT ON ClipboardItem
      WHEN new.Type = 'text' AND new.IsDeleted = 0
      BEGIN
        INSERT INTO ClipboardItem_fts(docid, Value) VALUES (new.rowid, new.Value);
      END;
    `)
    db.run(`
      CREATE TRIGGER IF NOT EXISTS clipboard_fts_ad AFTER DELETE ON ClipboardItem
      BEGIN
        DELETE FROM ClipboardItem_fts WHERE docid = old.rowid;
      END;
    `)
    db.run(`
      CREATE TRIGGER IF NOT EXISTS clipboard_fts_au AFTER UPDATE ON ClipboardItem
      BEGIN
        DELETE FROM ClipboardItem_fts WHERE docid = old.rowid;
        INSERT INTO ClipboardItem_fts(docid, Value)
          SELECT new.rowid, new.Value
          WHERE new.Type = 'text' AND new.IsDeleted = 0;
      END;
    `)

    // Backfill / auto-reparación: si el índice está vacío o desincronizado
    // (primera vez, o tras un VACUUM que reasigne rowids) lo reconstruimos.
    const ftsCount = db.exec("SELECT count(*) FROM ClipboardItem_fts")[0].values[0][0]
    const itemCount = db.exec("SELECT count(*) FROM ClipboardItem WHERE Type = 'text' AND IsDeleted = 0")[0].values[0][0]
    if (ftsCount !== itemCount) {
      db.run("DELETE FROM ClipboardItem_fts")
      db.run(`
        INSERT INTO ClipboardItem_fts(docid, Value)
        SELECT rowid, Value FROM ClipboardItem WHERE Type = 'text' AND IsDeleted = 0;
      `)
      console.log(`[DB] FTS index rebuilt (${itemCount} text items indexed)`)
    }
  } catch (e) {
    console.error('[DB] Error setting up FTS index:', e)
  }
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

function insertItem(value, type = 'text', deviceId = null, options = {}) {
  try {
    if (!db) {
        console.warn('DB not initialized in insertItem')
        return null
    }
    const now = new Date().toISOString()
    const createdAt = options.createdAt || now
    const updatedAt = options.updatedAt || now
    
    // Resolve deviceId if not provided
    if (!deviceId) {
        deviceId = ensureLocalDevice()
    }
    
    // Si no es una inserción forzada (con ID específico), intentar deduplicar por contenido
    if (!options.id) {
        // Deduplicación por (Value, Type, DeviceId) ignorando eliminados
        const check = db.prepare(`
          SELECT Id, CreatedAt FROM ClipboardItem
          WHERE Value = ? AND Type = ? AND DeviceId = ? AND IsDeleted = 0
          LIMIT 1
        `)
        check.bind([value || '', type || 'text', deviceId])
        if (check.step()) {
          const existing = check.getAsObject()
          check.free()
          const upd = db.prepare(`UPDATE ClipboardItem SET UpdatedAt = ? WHERE Id = ?`)
          upd.bind([updatedAt, existing.Id])
          upd.step()
          upd.free()
          persist()
          return { id: existing.Id, value, type, createdAt: existing.CreatedAt }
        }
        check.free()
    }
    
    // Insertar nuevo
    const id = options.id || crypto.randomUUID()
    
    // Verificar si ya existe por ID para evitar errores de PK (si viene de sync)
    if (options.id) {
        const checkId = db.prepare("SELECT Id FROM ClipboardItem WHERE Id = ?")
        checkId.bind([id])
        if (checkId.step()) {
            checkId.free()
            // Ya existe, actualizamos timestamps y contenido si es necesario
            // Esto actúa como un "upsert" simple para sync
            const upd = db.prepare(`UPDATE ClipboardItem SET Value = ?, Type = ?, UpdatedAt = ? WHERE Id = ?`)
            upd.bind([value || '', type || 'text', updatedAt, id])
            upd.step()
            upd.free()
            persist()
            return { id, value, type, createdAt }
        }
        checkId.free()
    }

    const stmt = db.prepare(`
      INSERT INTO ClipboardItem (Id, Value, Type, IsFavorite, CreatedAt, UpdatedAt, IsDeleted, Pending, DeviceId, Version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `)
    // Pending logic:
    // If it's a forced insert (options.id exists, e.g. from remote sync), pending should be 0 (false)
    // If it's a new local copy (options.id undefined), pending should be 1 (true) to trigger sync
    const pendingStatus = options.id ? 0 : 1;
    
    stmt.bind([
        id, 
        value || '', 
        type || 'text', 
        options.favorite ? 1 : 0, 
        createdAt, 
        updatedAt, 
        options.isDeleted ? 1 : 0, 
        pendingStatus, 
        deviceId
    ])
    stmt.step()
    stmt.free()
    persist()
    return { id, value, type, createdAt }
  } catch (e) {
    console.error('Error inserting item:', e)
    return null
  }
}

function getItems(limit = 20, offset = 0, filter = {}) {
  try {
    // Si la DB no está inicializada correctamente, devolver array vacío para evitar crash
    if (!db) {
        console.warn('DB not initialized in getItems')
        return []
    }

    const searching = !!(filter.search && String(filter.search).trim())

    let query
    const params = []

    if (searching) {
      // Búsqueda restringida a items de texto: las imágenes guardan data URIs
      // base64 de varios MB y no tienen texto buscable, escanearlas dispararía
      // la RAM en el proceso main (sql.js es síncrono).
      const raw = String(filter.search).trim()

      // Convertimos el término en una consulta FTS por prefijos: cada palabra
      // (letras/números Unicode) se busca como prefijo. Ej: "fac pen" -> "fac* pen*".
      const tokens = raw.match(/[\p{L}\p{N}]+/gu) || []
      const ftsQuery = tokens.map(t => t + '*').join(' ')

      // Decidimos FTS vs LIKE de forma determinista según si el índice tiene
      // coincidencias para el término completo. Así todas las páginas (offsets)
      // de una misma búsqueda usan el mismo modo y la paginación es consistente.
      let useFts = false
      if (ftsQuery) {
        try {
          const cstmt = db.prepare("SELECT count(*) AS n FROM ClipboardItem_fts WHERE ClipboardItem_fts MATCH ?")
          cstmt.bind([ftsQuery])
          cstmt.step()
          useFts = (cstmt.getAsObject().n || 0) > 0
          cstmt.free()
        } catch (e) {
          console.error('[DB] FTS count failed, falling back to LIKE:', e)
          useFts = false
        }
      }

      if (useFts) {
        // Camino rápido: índice full-text (palabra/prefijo, sin tildes/mayúsculas).
        query = `SELECT c.Id, c.Value, c.Type, c.IsFavorite, c.CreatedAt, c.IsDeleted, c.DeviceId
                 FROM ClipboardItem c
                 JOIN ClipboardItem_fts f ON f.docid = c.rowid
                 WHERE c.IsDeleted = 0 AND c.Type = 'text' AND ClipboardItem_fts MATCH ?`
        params.push(ftsQuery)
        if (filter.favorite) query += " AND c.IsFavorite = 1"
        if (filter.deviceId) { query += " AND c.DeviceId = ?"; params.push(filter.deviceId) }
        query += " ORDER BY c.CreatedAt DESC LIMIT ? OFFSET ?"
      } else {
        // Red de seguridad: substring literal (LIKE) para términos que el índice
        // por palabra/prefijo no cubre (ej. trozo en medio de una palabra).
        query = "SELECT Id, Value, Type, IsFavorite, CreatedAt, IsDeleted, DeviceId FROM ClipboardItem WHERE IsDeleted = 0 AND Type = 'text' AND Value LIKE ?"
        params.push(`%${raw}%`)
        if (filter.favorite) query += " AND IsFavorite = 1"
        if (filter.deviceId) { query += " AND DeviceId = ?"; params.push(filter.deviceId) }
        query += " ORDER BY CreatedAt DESC LIMIT ? OFFSET ?"
      }
      params.push(limit, offset)
    } else {
      // Sin búsqueda: listado normal. Seleccionamos solo las columnas necesarias
      // (evitamos traer Meta u otras columnas pesadas no usadas en normalizeItem).
      query = "SELECT Id, Value, Type, IsFavorite, CreatedAt, IsDeleted, DeviceId FROM ClipboardItem WHERE IsDeleted = 0"

      if (filter.favorite) {
        query += " AND IsFavorite = 1"
      }
      if (filter.type) {
        query += " AND Type = ?"
        params.push(filter.type)
      }
      if (filter.deviceId) {
        query += " AND DeviceId = ?"
        params.push(filter.deviceId)
      }

      query += " ORDER BY CreatedAt DESC LIMIT ? OFFSET ?"
      params.push(limit, offset)
    }

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
    const stmt = db.prepare("UPDATE ClipboardItem SET IsFavorite = ?, UpdatedAt = ?, Pending = 1 WHERE Id = ?")
    stmt.bind([isFavorite ? 1 : 0, now, id])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    console.error('Error setting favorite:', e)
    return false
  }
}

function deleteItem(id) {
  try {
    const stmt = db.prepare("UPDATE ClipboardItem SET IsDeleted = 1, Pending = 1 WHERE Id = ?")
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
    if (settings.StartMinimized !== undefined) { fields.push("StartMinimized = ?"); values.push(settings.StartMinimized ? 1 : 0); }
    
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

function getDeviceLastSync(deviceId) {
    try {
        const stmt = db.prepare("SELECT LastSync FROM Devices WHERE Id = ?")
        stmt.bind([deviceId])
        if (stmt.step()) {
            const row = stmt.getAsObject()
            stmt.free()
            return row.LastSync
        }
        stmt.free()
        return null
    } catch (e) {
        console.error('Error getting last sync:', e)
        return null
    }
}

function updateDeviceLastSync(deviceId, timestamp) {
    try {
        const stmt = db.prepare("UPDATE Devices SET LastSync = ?, UpdatedAt = ? WHERE Id = ?")
        stmt.bind([timestamp, new Date().toISOString(), deviceId])
        stmt.step()
        stmt.free()
        persist()
        return true
    } catch (e) {
        console.error('Error updating last sync:', e)
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
    updatedAt: row.UpdatedAt,
    isDeleted: !!row.IsDeleted,
    pending: row.Pending || 0,
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
        localDeviceId: getVal('LocalDeviceId'),
        startMinimized: !!getVal('StartMinimized')
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

function getPendingItems(deviceId = null) {
  try {
    let query = "SELECT * FROM ClipboardItem WHERE Pending = 1"
    const params = []
    
    if (deviceId) {
      query += " AND DeviceId = ?"
      params.push(deviceId)
    }
    
    query += " ORDER BY CreatedAt ASC"
    
    const stmt = db.prepare(query)
    stmt.bind(params)
    
    const items = []
    while (stmt.step()) {
      items.push(normalizeItem(stmt.getAsObject()))
    }
    stmt.free()
    return items
  } catch (e) {
    console.error('Error getting pending items:', e)
    return []
  }
}

function getItem(id) {
  try {
    const stmt = db.prepare("SELECT * FROM ClipboardItem WHERE Id = ?")
    stmt.bind([id])
    if (stmt.step()) {
      const item = normalizeItem(stmt.getAsObject())
      stmt.free()
      return item
    }
    stmt.free()
    return null
  } catch (e) {
    console.error('Error getting item:', e)
    return null
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

function markItemForSync(itemId) {
  try {
    const stmt = db.prepare("UPDATE ClipboardItem SET Pending = 1 WHERE Id = ?")
    stmt.bind([itemId])
    stmt.step()
    stmt.free()
    persist()
  } catch (e) {
    console.error('Error marking item for sync:', e)
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
      item.value || '', // Ensure value is not undefined
      item.type || 'text', // Ensure type is not undefined
      item.favorite ? 1 : 0,
      item.updatedAt || now, // Use provided updatedAt or now
      item.version || 1,
      item.deviceId || null, // Allow null deviceId
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
  getItem,
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
  getDeviceLastSync,
  updateDeviceLastSync,
  ensureLocalDevice,
  // Sync operations
  saveSyncQueue,
  getPendingSyncOperations,
  getPendingItems,
  markItemAsSynced,
  markItemForSync,
  updateItem,
  markAsConflicted,
  getConflictedItems,
  clearConflict
}
