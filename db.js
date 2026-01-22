const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const initSqlJs = require('sql.js')
let SQL = null
let db = null
let dbFilePath = null

async function init(app) {
  const dir = app.getPath('userData')
  dbFilePath = path.join(dir, 'copyfy.sqlite')
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
  try {
    if (fs.existsSync(dbFilePath)) {
      const buf = fs.readFileSync(dbFilePath)
      db = new SQL.Database(new Uint8Array(buf))
    } else {
      db = new SQL.Database()
    }
  } catch {
    db = new SQL.Database()
  }
  
  // Primero crear la tabla config si no existe para poder verificar la bandera
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );
  `)
  
  // Verificar si ya se ejecutó el reset del esquema
  let schemaResetCompleted = false
  try {
    const checkStmt = db.prepare('SELECT value FROM config WHERE key=?')
    checkStmt.bind(['schema_reset_completed'])
    if (checkStmt.step()) {
      const r = checkStmt.getAsObject()
      schemaResetCompleted = r.value === 'true'
    }
    checkStmt.free()
  } catch (e) {
    // Si hay error, asumir que no se ha ejecutado
    schemaResetCompleted = false
  }
  
  // Si no se ha ejecutado el reset, borrar SOLO las tablas de historial y dispositivos
  if (!schemaResetCompleted) {
    try {
      console.log('[DB] Ejecutando reset del esquema - esto solo debería pasar UNA VEZ')
      console.log('[DB] Solo se borrarán las tablas: history, guest_history, devices')
      
      // Verificar cuántos dispositivos hay antes de borrar
      try {
        const countStmt = db.prepare('SELECT COUNT(*) as count FROM devices')
        if (countStmt.step()) {
          const r = countStmt.getAsObject()
          const deviceCount = Number(r.count || 0)
          console.log('[DB] Dispositivos que se van a borrar:', deviceCount)
        }
        countStmt.free()
      } catch (e) {
        // Ignore
      }
      
      // IMPORTANTE: Solo borrar las tablas de historial y dispositivos
      // NO borrar config ni otras tablas que puedan existir
      db.run('DROP TABLE IF EXISTS history')
      db.run('DROP TABLE IF EXISTS guest_history')
      db.run('DROP TABLE IF EXISTS devices')
      
      // Borrar solo los índices relacionados con las tablas que borramos
      db.run('DROP INDEX IF EXISTS idx_history_device_value')
      db.run('DROP INDEX IF EXISTS idx_history_device_created')
      db.run('DROP INDEX IF EXISTS idx_history_device_favorite')
      db.run('DROP INDEX IF EXISTS idx_history_device_synced')
      db.run('DROP INDEX IF EXISTS idx_history_device_deleted')
      db.run('DROP INDEX IF EXISTS idx_guest_device_value')
      db.run('DROP INDEX IF EXISTS idx_guest_device_created')
      db.run('DROP INDEX IF EXISTS idx_guest_device_deleted')
      
      // Recrear todas las tablas con el esquema completo actualizado
      db.run(`
        CREATE TABLE history (
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
        CREATE TABLE guest_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          value TEXT NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0,
          device TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
          is_deleted INTEGER NOT NULL DEFAULT 0,
          remote_id TEXT
        );
        CREATE TABLE devices (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          clientId TEXT NOT NULL,
          name TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          lastSyncAt TEXT,
          migrated INTEGER NOT NULL DEFAULT 0
        );
      `)
      
      // Crear índices
      db.run(`
        CREATE UNIQUE INDEX idx_history_device_value ON history(device, value);
        CREATE INDEX idx_history_device_created ON history(device, created_at DESC);
        CREATE INDEX idx_history_device_favorite ON history(device, favorite);
        CREATE INDEX idx_history_device_synced ON history(device, is_synced);
        CREATE INDEX idx_history_device_deleted ON history(device, is_deleted);
        CREATE UNIQUE INDEX idx_guest_device_value ON guest_history(device, value);
        CREATE INDEX idx_guest_device_created ON guest_history(device, created_at DESC);
        CREATE INDEX idx_guest_device_deleted ON guest_history(device, is_deleted);
      `)
      
      // Guardar la bandera indicando que el reset ya se ejecutó
      const flagStmt = db.prepare('INSERT OR REPLACE INTO config(key, value, updated_at) VALUES(?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'))')
      flagStmt.bind(['schema_reset_completed', 'true'])
      flagStmt.step()
      flagStmt.free()
      
      // IMPORTANTE: Persistir cambios inmediatamente ANTES de continuar
      // Esto asegura que la bandera se guarde y no se borren las tablas en el próximo inicio
      persist()
      
      // Verificar que la bandera se guardó correctamente
      try {
        const verifyStmt = db.prepare('SELECT value FROM config WHERE key=?')
        verifyStmt.bind(['schema_reset_completed'])
        if (verifyStmt.step()) {
          const r = verifyStmt.getAsObject()
          if (r.value !== 'true') {
            console.error('[DB] ERROR: La bandera schema_reset_completed no se guardó correctamente')
          }
        }
        verifyStmt.free()
      } catch (e) {
        console.error('[DB] ERROR verificando bandera:', e)
      }
    } catch (e) {
      // Si hay error en el reset, continuar con el flujo normal
      // pero no marcar como completado para que se intente de nuevo
    }
  }
  
  // Continuar con el esquema normal (por si acaso falta algo)
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
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS guest_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      device TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_device_value ON guest_history(device, value);
    CREATE INDEX IF NOT EXISTS idx_guest_device_created ON guest_history(device, created_at DESC);
  `)
  try {
    const tableInfo = db.exec("PRAGMA table_info(history)")
    const existingColumns = new Set()
    if (tableInfo.length > 0 && tableInfo[0].values) {
      tableInfo[0].values.forEach(v => existingColumns.add(v[1]))
    }

    const migrations = [
      { col: 'remote_id', sql: "ALTER TABLE history ADD COLUMN remote_id TEXT" },
      { col: 'updated_at', sql: "ALTER TABLE history ADD COLUMN updated_at DATETIME" },
      { col: 'version', sql: "ALTER TABLE history ADD COLUMN version INTEGER DEFAULT 1" },
      { col: 'is_synced', sql: "ALTER TABLE history ADD COLUMN is_synced INTEGER DEFAULT 0" },
      { col: 'client_item_id', sql: "ALTER TABLE history ADD COLUMN client_item_id TEXT" },
      { col: 'is_deleted', sql: "ALTER TABLE history ADD COLUMN is_deleted INTEGER DEFAULT 0" },
      { col: 'pending', sql: "ALTER TABLE history ADD COLUMN pending INTEGER DEFAULT 1" },
      { col: 'device_id', sql: "ALTER TABLE history ADD COLUMN device_id TEXT" },
      { col: 'uuid', sql: "ALTER TABLE history ADD COLUMN uuid TEXT" },
      { col: 'type', sql: "ALTER TABLE history ADD COLUMN type TEXT DEFAULT 'text'" }
    ]

    for (const m of migrations) {
      if (!existingColumns.has(m.col)) {
        try {
          db.run(m.sql)
          // Populate updated_at if added
          if (m.col === 'updated_at') {
             try { db.run("UPDATE history SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE updated_at IS NULL") } catch {}
          }
        } catch (e) {
          // Migration failed
        }
      }
    }

    // Migrations for devices table
    try {
      const devicesTableInfo = db.exec("PRAGMA table_info(devices)")
      const devicesExistingColumns = new Set()
      if (devicesTableInfo.length > 0 && devicesTableInfo[0].values) {
        devicesTableInfo[0].values.forEach(v => devicesExistingColumns.add(v[1]))
      }

      const devicesMigrations = [
        { col: 'userId', sql: "ALTER TABLE devices ADD COLUMN userId TEXT" },
        { col: 'clientId', sql: "ALTER TABLE devices ADD COLUMN clientId TEXT" },
        { col: 'name', sql: "ALTER TABLE devices ADD COLUMN name TEXT" },
        { col: 'createdAt', sql: "ALTER TABLE devices ADD COLUMN createdAt TEXT" },
        { col: 'lastSyncAt', sql: "ALTER TABLE devices ADD COLUMN lastSyncAt TEXT" },
        { col: 'migrated', sql: "ALTER TABLE devices ADD COLUMN migrated INTEGER NOT NULL DEFAULT 0" }
      ]

      for (const m of devicesMigrations) {
        if (!devicesExistingColumns.has(m.col)) {
          try {
            db.run(m.sql)
            // Added column
          } catch (e) {
            // Failed to add column
          }
        }
      }
    } catch (e) {
      // Table might not exist yet, that's okay
    }

    // Verificación final de columnas críticas y reparación de emergencia
    try {
      const finalTableInfo = db.exec("PRAGMA table_info(history)")
      const finalColumns = new Set()
      if (finalTableInfo.length > 0 && finalTableInfo[0].values) {
        finalTableInfo[0].values.forEach(v => finalColumns.add(v[1]))
      }
      
      const criticalMigrations = [
        { col: 'updated_at', sql: "ALTER TABLE history ADD COLUMN updated_at DATETIME" },
        { col: 'is_synced', sql: "ALTER TABLE history ADD COLUMN is_synced INTEGER DEFAULT 0" },
        { col: 'version', sql: "ALTER TABLE history ADD COLUMN version INTEGER DEFAULT 1" },
        { col: 'remote_id', sql: "ALTER TABLE history ADD COLUMN remote_id TEXT" },
        { col: 'client_item_id', sql: "ALTER TABLE history ADD COLUMN client_item_id TEXT" },
        { col: 'is_deleted', sql: "ALTER TABLE history ADD COLUMN is_deleted INTEGER DEFAULT 0" },
        { col: 'pending', sql: "ALTER TABLE history ADD COLUMN pending INTEGER DEFAULT 1" },
        { col: 'device_id', sql: "ALTER TABLE history ADD COLUMN device_id TEXT" },
        { col: 'uuid', sql: "ALTER TABLE history ADD COLUMN uuid TEXT" },
        { col: 'type', sql: "ALTER TABLE history ADD COLUMN type TEXT DEFAULT 'text'" }
      ]

      for (const cm of criticalMigrations) {
        if (!finalColumns.has(cm.col)) {
           try { 
             db.run(cm.sql) 
             if (cm.col === 'updated_at') {
                try { db.run("UPDATE history SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE updated_at IS NULL") } catch {}
             }
           } catch(e) { }
        }
      }
    } catch(e) {
      // Error en verificación final de esquema
    }

    // Create indices after migrations to ensure columns exist
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_history_device_value ON history(device, value);
      CREATE INDEX IF NOT EXISTS idx_history_device_created ON history(device, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_device_favorite ON history(device, favorite);
      CREATE INDEX IF NOT EXISTS idx_history_device_synced ON history(device, is_synced);
      CREATE INDEX IF NOT EXISTS idx_history_device_deleted ON history(device, is_deleted);
    `)
  } catch (e) {
    // Migration check failed
  }
  
  try { db.run("ALTER TABLE guest_history ADD COLUMN remote_id TEXT") } catch (e) { /* ignore if exists */ }
  try { db.run("ALTER TABLE guest_history ADD COLUMN is_deleted INTEGER DEFAULT 0") } catch (e) { /* ignore if exists */ }
  try { db.run("CREATE INDEX IF NOT EXISTS idx_guest_device_deleted ON guest_history(device, is_deleted)") } catch (e) {}

  // Verify schema
  try {
    const tableInfo = db.exec("PRAGMA table_info(history)")
    if (tableInfo.length > 0 && tableInfo[0].values) {
      const cols = tableInfo[0].values.map(v => v[1])
    }
  } catch (e) { }

  // Ensure all items have a client_item_id
  try {
    const rows = db.exec("SELECT id FROM history WHERE client_item_id IS NULL")
    if (rows.length > 0 && rows[0].values) {
      for (const r of rows[0].values) {
        db.run("UPDATE history SET client_item_id=? WHERE id=?", [crypto.randomUUID(), r[0]])
      }
    }
  } catch (e) {
    // Failed to backfill client_item_id
  }

  persist()
}

function getAll(device) {
  try {
    const stmt = db.prepare('SELECT id, value, favorite, remote_id, client_item_id, version, updated_at, is_synced FROM history WHERE device=? AND is_deleted=0 ORDER BY created_at DESC, id DESC')
    const rows = []
    stmt.bind([device])
    while (stmt.step()) {
      const r = stmt.getAsObject()
      rows.push({ 
        id: String(r.id), 
        value: String(r.value), 
        favorite: !!r.favorite, 
        remote_id: r.remote_id ? String(r.remote_id) : null,
        client_item_id: r.client_item_id ? String(r.client_item_id) : null,
        version: r.version,
        updated_at: r.updated_at,
        is_synced: !!r.is_synced
      })
    }
    stmt.free()
    return rows
  } catch (e) {
    if (e.message && e.message.includes('no such column')) {
      try {
        const stmt = db.prepare('SELECT id, value, favorite, remote_id FROM history WHERE device=? ORDER BY created_at DESC, id DESC')
        const rows = []
        stmt.bind([device])
        while (stmt.step()) {
          const r = stmt.getAsObject()
          rows.push({ 
            id: String(r.id), 
            value: String(r.value), 
            favorite: !!r.favorite, 
            remote_id: r.remote_id ? String(r.remote_id) : null,
            client_item_id: null,
            version: 1,
            updated_at: null,
            is_synced: false
          })
        }
        stmt.free()
        return rows
      } catch (e2) {
        return []
      }
    }
    return []
  }
}

function insert(device, value, remoteId = null, type = 'text', deviceId = null) {
  // Generate local UUID for the item
  const uuid = crypto.randomUUID()
  
  // Determine item type based on value if not provided
  let itemType = type
  if (!itemType) {
    if (value.startsWith('data:image') || value.startsWith('[LOCAL_IMAGE]:')) {
      itemType = 'image'
    } else {
      itemType = 'text'
    }
  }
  
  // Get device_id from devices table if not provided
  let finalDeviceId = deviceId
  if (!finalDeviceId) {
    const savedDevice = getDevice()
    if (savedDevice && savedDevice.id) {
      finalDeviceId = savedDevice.id
    }
  }
  
  // If exists, update timestamp and version. If new, insert.
  const existing = db.prepare('SELECT id, version, client_item_id FROM history WHERE device=? AND value=?')
  existing.bind([device, value])
  if (existing.step()) {
    const r = existing.getAsObject()
    const newVer = (r.version || 0) + 1
    let stmt
    try {
        // Update existing: mark as pending again (needs to be pushed to server), update timestamp
        stmt = db.prepare('UPDATE history SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), updated_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), version=?, pending=1, remote_id=coalesce(?, remote_id), device_id=coalesce(?, device_id), type=? WHERE id=?')
        stmt.bind([newVer, remoteId, finalDeviceId, itemType, r.id])
    } catch (e) {
        // Fallback for legacy schema
        try {
          stmt = db.prepare('UPDATE history SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), pending=1, remote_id=coalesce(?, remote_id), device_id=coalesce(?, device_id), type=? WHERE id=?')
          stmt.bind([remoteId, finalDeviceId, itemType, r.id])
        } catch (e2) {
          stmt = db.prepare('UPDATE history SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), remote_id=coalesce(?, remote_id) WHERE id=?')
          stmt.bind([remoteId, r.id])
          stmt.step()
          stmt.free()
          // Try to update pending if column exists
          try {
            const updatePending = db.prepare('UPDATE history SET pending=1 WHERE id=?')
            updatePending.bind([r.id])
            updatePending.step()
            updatePending.free()
          } catch (e3) {
            // Could not set pending=1
          }
          persist()
          return
        }
    }
    stmt.step()
    stmt.free()
  } else {
    let stmt
    try {
        // Insert new: pending=1, generate UUID, include device_id and type
        stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, updated_at, remote_id, client_item_id, version, is_synced, pending, device_id, uuid, type) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), ?, ?, 1, 0, 1, ?, ?, ?)')
        stmt.bind([value, 0, device, remoteId, uuid, finalDeviceId, uuid, itemType])
    } catch(e) {
        // Fallback - try with pending column
        try {
          stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, updated_at, remote_id, client_item_id, version, is_synced, pending) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), ?, ?, 1, 0, 1)')
          stmt.bind([value, 0, device, remoteId, uuid])
        } catch(e2) {
          // Legacy fallback - try to add pending after insert
          stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, remote_id) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), ?)')
          stmt.bind([value, 0, device, remoteId])
          stmt.step()
          stmt.free()
          // Try to update pending if column exists
          try {
            const updatePending = db.prepare('UPDATE history SET pending=1 WHERE device=? AND value=? AND remote_id=?')
            updatePending.bind([device, value, remoteId])
            updatePending.step()
            updatePending.free()
          } catch (e3) {
            // Could not set pending=1
          }
          persist()
          return
        }
    }
    stmt.step()
    stmt.free()
  }
  existing.free()
  persist()
}

function setFavorite(device, value, fav) {
  const existing = db.prepare('SELECT id, version FROM history WHERE device=? AND value=?')
  existing.bind([device, value])
  if (existing.step()) {
    const r = existing.getAsObject()
    const newVer = (r.version || 0) + 1
    let stmt
    try {
      // Mark as pending when favorite changes (needs to be pushed to server)
      stmt = db.prepare('UPDATE history SET favorite=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), version=?, is_synced=0, pending=1 WHERE id=?')
      stmt.bind([fav ? 1 : 0, newVer, r.id])
    } catch (e) {
      // Fallback if pending column doesn't exist
      try {
        stmt = db.prepare('UPDATE history SET favorite=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), version=?, is_synced=0 WHERE id=?')
        stmt.bind([fav ? 1 : 0, newVer, r.id])
      } catch (e2) {
        // Legacy fallback
        stmt = db.prepare('UPDATE history SET favorite=?, is_synced=0 WHERE id=?')
        stmt.bind([fav ? 1 : 0, r.id])
      }
    }
    stmt.step()
    stmt.free()
  }
  existing.free()
  persist()
}

function getDirtyItems(device) {
  try {
    const stmt = db.prepare('SELECT id, value, favorite, remote_id, client_item_id, version, updated_at FROM history WHERE device=? AND is_synced=0 AND is_deleted=0')
    const rows = []
    stmt.bind([device])
    while (stmt.step()) {
      const r = stmt.getAsObject()
      rows.push({
        db_id: r.id,
        id: r.remote_id, // server id if exists
        clientId: r.client_item_id, // client unique id
        value: r.value,
        favorite: !!r.favorite,
        version: r.version,
        updatedAt: r.updated_at
      })
    }
    stmt.free()
    return rows
  } catch (e) {
    return []
  }
}

function markSynced(device, clientItemIds) {
  if (!Array.isArray(clientItemIds) || clientItemIds.length === 0) return
  const placeholders = clientItemIds.map(() => '?').join(',')
  const stmt = db.prepare(`UPDATE history SET is_synced=1 WHERE device=? AND client_item_id IN (${placeholders})`)
  stmt.bind([device, ...clientItemIds])
  stmt.step()
  stmt.free()
  persist()
}

function clear(device) {
  const stmt = db.prepare('DELETE FROM history WHERE device=?')
  stmt.bind([device])
  stmt.step()
  stmt.free()
  persist()
}

function clearAll() {
  const stmt = db.prepare('DELETE FROM history')
  stmt.step()
  stmt.free()
  persist()
}

function updateFromConflict(device, serverItem) {
  // serverItem: { id (server-uuid), clientId (client-uuid), value, favorite, version, updatedAt }
  // Update local item with server data and set is_synced=1
  // We match by client_item_id if possible, or value?
  // The strategy says "server wins".
  
  if (!serverItem.clientId) return // Need client id to match
  
  try {
    const stmt = db.prepare(`
      UPDATE history 
      SET value=?, favorite=?, remote_id=?, version=?, updated_at=?, is_synced=1 
      WHERE device=? AND client_item_id=?
    `)
    stmt.bind([
      serverItem.value, 
      serverItem.favorite ? 1 : 0, 
      serverItem.id, 
      serverItem.version, 
      serverItem.updatedAt, 
      device, 
      serverItem.clientId
    ])
    stmt.step()
    stmt.free()
    persist()
  } catch (e) {
    // Try fallback without is_synced/version if schema is old
    try {
      const stmt = db.prepare(`
        UPDATE history 
        SET value=?, favorite=?, remote_id=?, updated_at=?
        WHERE device=? AND client_item_id=?
      `)
      stmt.bind([
        serverItem.value, 
        serverItem.favorite ? 1 : 0, 
        serverItem.id, 
        serverItem.updatedAt, 
        device, 
        serverItem.clientId
      ])
      stmt.step()
      stmt.free()
      persist()
    } catch (e2) {
      // updateFromConflict fallback failed
    }
  }
}

function updateRemoteId(device, clientItemId, remoteId) {
  const stmt = db.prepare('UPDATE history SET remote_id=? WHERE device=? AND client_item_id=?')
  stmt.bind([remoteId, device, clientItemId])
  stmt.step()
  stmt.free()
  persist()
}

function importItems(device, items) {
  const insertStmt = db.prepare('INSERT OR IGNORE INTO history(value, favorite, device, created_at) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'))')
  const updateStmt = db.prepare('UPDATE history SET remote_id=?, favorite=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), is_synced=1 WHERE device=? AND value=?')
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.value !== 'string') continue
    const fav = it.favorite ? 1 : 0
    insertStmt.bind([it.value, fav, device])
    insertStmt.step()
    insertStmt.reset()
    const rid = it.id ? String(it.id) : null
    updateStmt.bind([rid, fav, device, it.value])
    updateStmt.step()
    updateStmt.reset()
  }
  insertStmt.free()
  updateStmt.free()
  persist()
}

function trimToLimit(device, limit) {
  const n = Math.max(1, Number(limit || 50))
  const sql = `UPDATE history SET is_deleted=1 WHERE device=? AND is_deleted=0 AND id NOT IN (SELECT id FROM history WHERE device=? AND is_deleted=0 ORDER BY created_at DESC LIMIT ?)`
  const stmt = db.prepare(sql)
  stmt.bind([device, device, n])
  stmt.step()
  stmt.free()
  persist()
}

function insertGuest(device, value) {
  const stmt = db.prepare('INSERT INTO guest_history(value, favorite, device, created_at) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\')) ON CONFLICT(device, value) DO UPDATE SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\')')
  stmt.bind([value, 0, device])
  stmt.step()
  stmt.free()
  persist()
}

function getAllGuest(device) {
  const stmt = db.prepare('SELECT value, favorite FROM guest_history WHERE device=? AND is_deleted=0 ORDER BY created_at DESC, id DESC')
  const rows = []
  stmt.bind([device])
  while (stmt.step()) {
    const r = stmt.getAsObject()
    rows.push({ value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return rows
}

function clearGuest(device) {
  const stmt = db.prepare('DELETE FROM guest_history WHERE device=?')
  stmt.bind([device])
  stmt.step()
  stmt.free()
  persist()
}

function trimGuestToLimit(device, limit) {
  const n = Math.max(1, Number(limit || 50))
  const sql = `UPDATE guest_history SET is_deleted=1 WHERE device=? AND is_deleted=0 AND id NOT IN (SELECT id FROM guest_history WHERE device=? AND is_deleted=0 ORDER BY created_at DESC LIMIT ?)`
  const stmt = db.prepare(sql)
  stmt.bind([device, device, n])
  stmt.step()
  stmt.free()
  persist()
}

function searchGuest(device, query, filter) {
  const where = ['device=?']
  const params = [device]
  const q = String(query || '').trim()
  if (q.length > 0) {
    where.push('value LIKE ?')
    params.push('%' + q + '%')
    where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  }
  const f = String(filter || 'all')
  if (f === 'image') where.push("(value LIKE 'data:image%' OR value LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'text') where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  where.push('is_deleted=0')
  const sql = `SELECT value, favorite FROM guest_history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({ value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return out
}

// Función de búsqueda paginada para guest - retorna items paginados con value completo
function searchGuestPaginated(device, query, filter, page = 0, limit = 20) {
  const where = ['device=?']
  const params = [device]
  const q = String(query || '').trim()
  if (q.length > 0) {
    where.push('value LIKE ?')
    params.push('%' + q + '%')
    where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  }
  const f = String(filter || 'all')
  if (f === 'image') where.push("(value LIKE 'data:image%' OR value LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'text') where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  where.push('is_deleted=0')
  
  const offset = Math.max(0, Number(page || 0)) * Math.max(1, Math.min(100, Number(limit || 20)))
  const pageLimit = Math.max(1, Math.min(100, Number(limit || 20)))
  
  // Retornar items con value completo pero paginado (solo 20 items por página)
  const sql = `SELECT id, value, favorite, created_at FROM guest_history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  const stmt = db.prepare(sql)
  stmt.bind([...params, pageLimit, offset])
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({
      id: String(r.id),
      value: String(r.value),
      favorite: !!r.favorite,
      created_at: String(r.created_at || '')
    })
  }
  stmt.free()
  return out
}

function getRecentGuest(device, filter, limit) {
  const f = String(filter || 'all')
  const where = ['device=?']
  if (f === 'image') where.push("(value LIKE 'data:image%' OR value LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'text') where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  const n = Math.max(1, Math.min(1000, Number(limit || 50)))
  where.push('is_deleted=0')
  const sql = `SELECT value, favorite FROM guest_history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${n}`
  const stmt = db.prepare(sql)
  stmt.bind([device])
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({ value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return out
}
function search(device, query, filter) {
  const where = ['device=?']
  const params = [device]
  const q = String(query || '').trim()
  if (q.length > 0) {
    where.push('value LIKE ?')
    params.push('%' + q + '%')
    where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  }
  const f = String(filter || 'all')
  if (f === 'image') where.push("(value LIKE 'data:image%' OR value LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'text') where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'favorite') where.push('favorite=1')
  where.push('is_deleted=0')
  const sql = `SELECT value, favorite FROM history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({ value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return out
}

// Función de búsqueda paginada para usuarios autenticados - retorna items paginados con value completo
function searchPaginated(device, query, filter, page = 0, limit = 20) {
  const where = ['device=?']
  const params = [device]
  const q = String(query || '').trim()
  if (q.length > 0) {
    where.push('value LIKE ?')
    params.push('%' + q + '%')
    where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  }
  const f = String(filter || 'all')
  if (f === 'image') where.push("(value LIKE 'data:image%' OR value LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'text') where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'favorite') where.push('favorite=1')
  where.push('is_deleted=0')
  
  const offset = Math.max(0, Number(page || 0)) * Math.max(1, Math.min(100, Number(limit || 20)))
  const pageLimit = Math.max(1, Math.min(100, Number(limit || 20)))
  
  // Retornar items con value completo pero paginado (solo 20 items por página)
  const sql = `SELECT id, value, favorite, created_at FROM history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  const stmt = db.prepare(sql)
  stmt.bind([...params, pageLimit, offset])
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({
      id: String(r.id),
      value: String(r.value),
      favorite: !!r.favorite,
      created_at: String(r.created_at || '')
    })
  }
  stmt.free()
  return out
}

function persist() {
  if (!dbFilePath || !db) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (e) {
    // Persist error
  }
}

function reloadDatabase() {
  if (!dbFilePath || !SQL) return false
  try {
    if (fs.existsSync(dbFilePath)) {
      // Recargar desde el archivo (sql.js no requiere cerrar explícitamente)
      // Simplemente crear una nueva instancia que reemplazará la anterior
      const buf = fs.readFileSync(dbFilePath)
      db = new SQL.Database(new Uint8Array(buf))
      return true
    }
  } catch (e) {
    // Reload error - si falla, la instancia anterior sigue activa
  }
  return false
}

function sanitize(name) {
  const s = String(name || '').trim()
  return s.replace(/[<>:"/\\|?*]/g, '').slice(0, 64) || 'device'
}

function getRecent(device, filter, limit) {
  const f = String(filter || 'all')
  const where = ['device=?']
  if (f === 'image') where.push("(value LIKE 'data:image%' OR value LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'text') where.push("(value NOT LIKE 'data:image%' AND value NOT LIKE '[LOCAL_IMAGE]:%')")
  else if (f === 'favorite') where.push('favorite=1')
  const n = Math.max(1, Math.min(1000, Number(limit || 50)))
  where.push('is_deleted=0')
  const sql = `SELECT id, value, favorite FROM history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${n}`
  const stmt = db.prepare(sql)
  stmt.bind([device])
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({ id: String(r.id), value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return out
}

function getByValues(device, values) {
  const arr = Array.isArray(values) ? values.filter(v => typeof v === 'string' && v.length > 0) : []
  if (arr.length === 0) return []
  const placeholders = arr.map(() => '?').join(',')
  const sql = `SELECT id, value, favorite FROM history WHERE device=? AND is_deleted=0 AND value IN (${placeholders})`
  const stmt = db.prepare(sql)
  stmt.bind([device, ...arr])
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({ id: String(r.id), value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return out
}

function getNotIn(device, values) {
  const arr = Array.isArray(values) ? values.filter(v => typeof v === 'string' && v.length > 0) : []
  if (arr.length === 0) return []
  const placeholders = arr.map(() => '?').join(',')
  const sql = `SELECT id, value, favorite FROM history WHERE device=? AND is_deleted=0 AND value NOT IN (${placeholders})`
  const stmt = db.prepare(sql)
  stmt.bind([device, ...arr])
  const out = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    out.push({ id: String(r.id), value: String(r.value), favorite: !!r.favorite })
  }
  stmt.free()
  return out
}

function deleteById(id) {
  // Try deleting from both tables since we only have the ID and want to be sure
  const stmt1 = db.prepare('DELETE FROM history WHERE id=?')
  stmt1.bind([id])
  stmt1.step()
  stmt1.free()
  
  const stmt2 = db.prepare('DELETE FROM guest_history WHERE id=?')
  stmt2.bind([id])
  stmt2.step()
  stmt2.free()
  
  persist()
}

function getById(id) {
  const stmt = db.prepare('SELECT id, value, favorite, remote_id FROM history WHERE id=? AND is_deleted=0')
  stmt.bind([id])
  let res = null
  if (stmt.step()) {
    const r = stmt.getAsObject()
    res = { id: String(r.id), value: String(r.value), favorite: !!r.favorite, remote_id: r.remote_id ? String(r.remote_id) : null }
  }
  stmt.free()
  return res
}

function updateRemoteIdByValue(device, value, remoteId) {
  const stmt = db.prepare('UPDATE history SET remote_id=? WHERE device=? AND value=?')
  stmt.bind([remoteId, device, value])
  stmt.step()
  stmt.free()
  persist()
}

function countActive(device) {
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
  } catch (e) {
    return 0
  }
}

function countGuestActive(device) {
  try {
    const stmt = db.prepare('SELECT COUNT(1) AS c FROM guest_history WHERE device=? AND is_deleted=0')
    stmt.bind([device])
    let c = 0
    if (stmt.step()) {
      const r = stmt.getAsObject()
      c = Number(r.c || 0)
    }
    stmt.free()
    return c
  } catch (e) {
    return 0
  }
}

function deleteNotInRemote(device, remoteValues) {
  const values = Array.isArray(remoteValues) ? remoteValues.filter(v => typeof v === 'string') : []
  if (values.length === 0) {
    const stmt = db.prepare('DELETE FROM history WHERE device=? AND is_deleted=0 AND remote_id IS NOT NULL')
    stmt.bind([device])
    stmt.step()
    stmt.free()
    persist()
    return
  }
  const placeholders = values.map(() => '?').join(',')
  const sql = `DELETE FROM history WHERE device=? AND is_deleted=0 AND remote_id IS NOT NULL AND value NOT IN (${placeholders})`
  const stmt = db.prepare(sql)
  stmt.bind([device, ...values])
  stmt.step()
  stmt.free()
  persist()
}

// Funciones para manejar configuración
function getConfig(key) {
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
  } catch (e) {
    return null
  }
}

function setConfig(key, value) {
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO config(key, value, updated_at) VALUES(?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'))')
    stmt.bind([key, value])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

function removeConfig(key) {
  try {
    const stmt = db.prepare('DELETE FROM config WHERE key=?')
    stmt.bind([key])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

function getAllConfig() {
  try {
    const stmt = db.prepare('SELECT key, value FROM config')
    const result = {}
    while (stmt.step()) {
      const r = stmt.getAsObject()
      result[String(r.key)] = String(r.value)
    }
    stmt.free()
    return result
  } catch (e) {
    return {}
  }
}

function getLegacyImages(device) {
  try {
    const stmt = db.prepare("SELECT id, value FROM history WHERE device=? AND value LIKE 'data:image%' AND is_deleted=0")
    stmt.bind([device])
    const rows = []
    while (stmt.step()) {
      const r = stmt.getAsObject()
      rows.push({ id: r.id, value: r.value })
    }
    stmt.free()
    return rows
  } catch (e) {
    return []
  }
}

function updateValue(id, newValue) {
  try {
    const stmt = db.prepare("UPDATE history SET value=? WHERE id=?")
    stmt.bind([newValue, id])
    stmt.step()
    stmt.free()
    persist()
  } catch (e) {}
}

function updateImagesBulk(updates) {
  try {
    const stmt = db.prepare("UPDATE history SET value=? WHERE id=?")
    db.run("BEGIN TRANSACTION")
    for (const u of updates) {
       stmt.bind([u.path, u.id])
       stmt.step()
       stmt.reset()
    }
    db.run("COMMIT")
    stmt.free()
    persist()
  } catch (e) {
    // updateImagesBulk failed
  }
}

// Device management functions
function saveDevice(deviceInfo) {
  try {
    // deviceInfo: { id, userId, clientId, name, createdAt, lastSyncAt }
    
    // First, check the actual table structure
    let hasSnakeCase = false
    try {
      const tableInfo = db.exec("PRAGMA table_info(devices)")
      if (tableInfo.length > 0 && tableInfo[0].values) {
        const columns = tableInfo[0].values.map(v => ({ name: v[1], type: v[2], notnull: v[3] }))
        hasSnakeCase = tableInfo[0].values.some(v => v[1] === 'user_id')
      }
    } catch (e) {
      // Could not check table structure
    }
    
    // lastSyncAt es un valor 100% local del cliente.
    // Regla:
    // - Si deviceInfo trae lastSyncAt explícitamente, usar ese valor (o null para limpiar).
    // - Si NO trae la propiedad lastSyncAt, conservar el valor ya existente en la DB.
    let finalLastSyncAt = null
    const hasLastSyncProp = Object.prototype.hasOwnProperty.call(deviceInfo, 'lastSyncAt')
    if (hasLastSyncProp) {
      const v = deviceInfo.lastSyncAt
      if (v && v !== 'null' && v !== 'undefined' && v !== '') {
        finalLastSyncAt = String(v)
      } else {
        finalLastSyncAt = null
      }
    } else if (deviceInfo.id) {
      // No se pasó lastSyncAt: intentar conservar el valor actual de la fila
      try {
        const checkStmt = db.prepare('SELECT lastSyncAt FROM devices WHERE id=?')
        checkStmt.bind([String(deviceInfo.id)])
        if (checkStmt.step()) {
          const r = checkStmt.getAsObject()
          if (r.lastSyncAt && r.lastSyncAt !== 'null' && String(r.lastSyncAt) !== 'null') {
            finalLastSyncAt = String(r.lastSyncAt)
          }
        }
        checkStmt.free()
      } catch (e) {
        // Ignore
      }
    }
    
    // Ensure we don't save 'null' strings - convert undefined/null to null or empty string appropriately
    // Required fields (userId, clientId, name, createdAt) must have values, not null
    const cleanDeviceInfo = {
      id: deviceInfo.id ? String(deviceInfo.id) : null,
      userId: deviceInfo.userId && deviceInfo.userId !== 'null' && deviceInfo.userId !== 'undefined' ? String(deviceInfo.userId) : (deviceInfo.userId === '' ? '' : ''),
      clientId: deviceInfo.clientId && deviceInfo.clientId !== 'null' && deviceInfo.clientId !== 'undefined' ? String(deviceInfo.clientId) : (deviceInfo.clientId === '' ? '' : ''),
      name: deviceInfo.name && deviceInfo.name !== 'null' && deviceInfo.name !== 'undefined' ? String(deviceInfo.name) : (deviceInfo.name === '' ? '' : ''),
      createdAt: deviceInfo.createdAt && deviceInfo.createdAt !== 'null' && deviceInfo.createdAt !== 'undefined' ? String(deviceInfo.createdAt) : (deviceInfo.createdAt === '' ? '' : new Date().toISOString()),
      lastSyncAt: finalLastSyncAt
    }
    
    // Preservar el estado de migrated si existe, o usar el valor proporcionado
    const migrated = deviceInfo.migrated !== undefined ? (deviceInfo.migrated ? 1 : 0) : null
    
    // Table has BOTH user_id (snake_case, NOT NULL) and userId (camelCase, nullable)
    // We need to use user_id and client_id for the required columns
    let stmt
    if (hasSnakeCase) {
      // Use snake_case columns (user_id, client_id) for required fields
      // Si migrated es null, obtener el valor actual de la DB
      let currentMigrated = 0
      if (migrated === null && cleanDeviceInfo.id) {
        try {
          const checkStmt = db.prepare('SELECT migrated FROM devices WHERE id=?')
          checkStmt.bind([cleanDeviceInfo.id])
          if (checkStmt.step()) {
            const r = checkStmt.getAsObject()
            currentMigrated = r.migrated ? (r.migrated === 1 ? 1 : 0) : 0
          }
          checkStmt.free()
        } catch (e) {
          // Ignore
        }
      }
      const finalMigrated = migrated !== null ? migrated : currentMigrated
      stmt = db.prepare('INSERT OR REPLACE INTO devices(id, user_id, client_id, name, created_at, userId, clientId, createdAt, lastSyncAt, migrated) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      stmt.bind([
        cleanDeviceInfo.id,
        cleanDeviceInfo.userId || '',  // user_id - NOT NULL
        cleanDeviceInfo.clientId || '', // client_id
        cleanDeviceInfo.name || '',     // name - NOT NULL
        cleanDeviceInfo.createdAt || new Date().toISOString(), // created_at - NOT NULL
        cleanDeviceInfo.userId || '',   // userId (camelCase, nullable)
        cleanDeviceInfo.clientId || '', // clientId (camelCase, nullable)
        cleanDeviceInfo.createdAt || new Date().toISOString(), // createdAt (camelCase, nullable)
        cleanDeviceInfo.lastSyncAt,     // lastSyncAt
        finalMigrated                    // migrated
      ])
    } else {
      // Use camelCase columns only
      // Si migrated es null, obtener el valor actual de la DB
      let currentMigrated = 0
      if (migrated === null && cleanDeviceInfo.id) {
        try {
          const checkStmt = db.prepare('SELECT migrated FROM devices WHERE id=?')
          checkStmt.bind([cleanDeviceInfo.id])
          if (checkStmt.step()) {
            const r = checkStmt.getAsObject()
            currentMigrated = r.migrated ? (r.migrated === 1 ? 1 : 0) : 0
          }
          checkStmt.free()
        } catch (e) {
          // Ignore
        }
      }
      const finalMigrated = migrated !== null ? migrated : currentMigrated
      stmt = db.prepare('INSERT OR REPLACE INTO devices(id, userId, clientId, name, createdAt, lastSyncAt, migrated) VALUES(?, ?, ?, ?, ?, ?, ?)')
      stmt.bind([
        cleanDeviceInfo.id,
        cleanDeviceInfo.userId,
        cleanDeviceInfo.clientId,
        cleanDeviceInfo.name,
        cleanDeviceInfo.createdAt,
        cleanDeviceInfo.lastSyncAt,
        finalMigrated
      ])
    }
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

function getDevice() {
  try {
    // First check if snake_case columns exist (user_id, client_id, created_at)
    let hasSnakeCase = false
    try {
      const tableInfo = db.exec("PRAGMA table_info(devices)")
      if (tableInfo.length > 0 && tableInfo[0].values) {
        hasSnakeCase = tableInfo[0].values.some(v => v[1] === 'user_id')
      }
    } catch (e) {
      // Ignore
    }
    
    let stmt
    let result = null
    
    if (hasSnakeCase) {
      // Read from snake_case columns - prefer device with non-null user_id, otherwise get first one
      // Order by user_id DESC to get non-null first, then by created_at DESC for the most recent
      stmt = db.prepare(`
        SELECT id, user_id, client_id, name, created_at, userId, clientId, createdAt, lastSyncAt 
        FROM devices 
        ORDER BY 
          CASE WHEN user_id IS NOT NULL AND user_id != '' THEN 1 ELSE 0 END DESC,
          created_at DESC
        LIMIT 1
      `)
    } else {
      // Read from camelCase columns - prefer device with non-null userId, otherwise get first one
      stmt = db.prepare(`
        SELECT id, userId, clientId, name, createdAt, lastSyncAt 
        FROM devices 
        ORDER BY 
          CASE WHEN userId IS NOT NULL AND userId != '' THEN 1 ELSE 0 END DESC,
          createdAt DESC
        LIMIT 1
      `)
    }
    
    if (stmt.step()) {
      const r = stmt.getAsObject()
      // Handle null values correctly - don't convert null to string 'null'
      // Prefer snake_case values, fallback to camelCase if snake_case is null/empty
      result = {
        id: r.id ? String(r.id) : null,
        userId: (hasSnakeCase && r.user_id) 
          ? (r.user_id !== 'null' && String(r.user_id) !== 'null' ? String(r.user_id) : null)
          : (r.userId && r.userId !== 'null' && String(r.userId) !== 'null' ? String(r.userId) : null),
        clientId: (hasSnakeCase && r.client_id)
          ? (r.client_id !== 'null' && String(r.client_id) !== 'null' ? String(r.client_id) : null)
          : (r.clientId && r.clientId !== 'null' && String(r.clientId) !== 'null' ? String(r.clientId) : null),
        name: r.name ? String(r.name) : null,
        createdAt: (hasSnakeCase && r.created_at)
          ? (r.created_at !== 'null' && String(r.created_at) !== 'null' ? String(r.created_at) : null)
          : (r.createdAt && r.createdAt !== 'null' && String(r.createdAt) !== 'null' ? String(r.createdAt) : null),
        lastSyncAt: r.lastSyncAt && r.lastSyncAt !== 'null' && String(r.lastSyncAt) !== 'null' ? String(r.lastSyncAt) : null
      }
    }
    stmt.free()
    return result
  } catch (e) {
    return null
  }
}

function updateDeviceLastSyncAt(lastSyncAt) {
  try {
    const stmt = db.prepare('UPDATE devices SET lastSyncAt=? WHERE id=(SELECT id FROM devices LIMIT 1)')
    stmt.bind([lastSyncAt])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

function getDeviceByClientId(clientId) {
  try {
    // First check if snake_case columns exist (user_id, client_id, created_at)
    let hasSnakeCase = false
    try {
      const tableInfo = db.exec("PRAGMA table_info(devices)")
      if (tableInfo.length > 0 && tableInfo[0].values) {
        hasSnakeCase = tableInfo[0].values.some(v => v[1] === 'client_id')
      }
    } catch (e) {
      // Ignore
    }
    
    let stmt
    let result = null
    
    if (hasSnakeCase) {
      stmt = db.prepare('SELECT id, user_id, client_id, name, created_at, userId, clientId, createdAt, lastSyncAt, migrated FROM devices WHERE client_id=? OR clientId=? LIMIT 1')
      stmt.bind([clientId, clientId])
    } else {
      stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices WHERE clientId=? LIMIT 1')
      stmt.bind([clientId])
    }
    
    if (stmt.step()) {
      const r = stmt.getAsObject()
      result = {
        id: r.id ? String(r.id) : null,
        userId: (hasSnakeCase && r.user_id) 
          ? (r.user_id !== 'null' && String(r.user_id) !== 'null' ? String(r.user_id) : null)
          : (r.userId && r.userId !== 'null' && String(r.userId) !== 'null' ? String(r.userId) : null),
        clientId: (hasSnakeCase && r.client_id)
          ? (r.client_id !== 'null' && String(r.client_id) !== 'null' ? String(r.client_id) : null)
          : (r.clientId && r.clientId !== 'null' && String(r.clientId) !== 'null' ? String(r.clientId) : null),
        name: r.name ? String(r.name) : null,
        createdAt: (hasSnakeCase && r.created_at)
          ? (r.created_at !== 'null' && String(r.created_at) !== 'null' ? String(r.created_at) : null)
          : (r.createdAt && r.createdAt !== 'null' && String(r.createdAt) !== 'null' ? String(r.createdAt) : null),
        lastSyncAt: r.lastSyncAt && r.lastSyncAt !== 'null' && String(r.lastSyncAt) !== 'null' ? String(r.lastSyncAt) : null,
        migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
      }
    }
    stmt.free()
    return result
  } catch (e) {
    return null
  }
}

function getAllDevices() {
  try {
    let hasSnakeCase = false
    try {
      const tableInfo = db.exec("PRAGMA table_info(devices)")
      if (tableInfo.length > 0 && tableInfo[0].values) {
        hasSnakeCase = tableInfo[0].values.some(v => v[1] === 'user_id')
      }
    } catch (e) {
      // Ignore
    }
    
    let stmt
    if (hasSnakeCase) {
      stmt = db.prepare('SELECT id, user_id, client_id, name, created_at, userId, clientId, createdAt, lastSyncAt, migrated FROM devices ORDER BY created_at DESC')
    } else {
      stmt = db.prepare('SELECT id, userId, clientId, name, createdAt, lastSyncAt, migrated FROM devices ORDER BY createdAt DESC')
    }
    
    const devices = []
    while (stmt.step()) {
      const r = stmt.getAsObject()
      devices.push({
        id: r.id ? String(r.id) : null,
        userId: (hasSnakeCase && r.user_id) 
          ? (r.user_id !== 'null' && String(r.user_id) !== 'null' ? String(r.user_id) : null)
          : (r.userId && r.userId !== 'null' && String(r.userId) !== 'null' ? String(r.userId) : null),
        clientId: (hasSnakeCase && r.client_id)
          ? (r.client_id !== 'null' && String(r.client_id) !== 'null' ? String(r.client_id) : null)
          : (r.clientId && r.clientId !== 'null' && String(r.clientId) !== 'null' ? String(r.clientId) : null),
        name: r.name ? String(r.name) : null,
        createdAt: (hasSnakeCase && r.created_at)
          ? (r.created_at !== 'null' && String(r.created_at) !== 'null' ? String(r.created_at) : null)
          : (r.createdAt && r.createdAt !== 'null' && String(r.createdAt) !== 'null' ? String(r.createdAt) : null),
        lastSyncAt: r.lastSyncAt && r.lastSyncAt !== 'null' && String(r.lastSyncAt) !== 'null' ? String(r.lastSyncAt) : null,
        migrated: r.migrated ? (r.migrated === 1 || r.migrated === '1' || r.migrated === true) : false
      })
    }
    stmt.free()
    return devices
  } catch (e) {
    return []
  }
}

function markDeviceAsMigrated(clientId) {
  try {
    let hasSnakeCase = false
    try {
      const tableInfo = db.exec("PRAGMA table_info(devices)")
      if (tableInfo.length > 0 && tableInfo[0].values) {
        hasSnakeCase = tableInfo[0].values.some(v => v[1] === 'client_id')
      }
    } catch (e) {
      // Ignore
    }
    
    let stmt
    if (hasSnakeCase) {
      stmt = db.prepare('UPDATE devices SET migrated=1 WHERE client_id=? OR clientId=?')
      stmt.bind([clientId, clientId])
    } else {
      stmt = db.prepare('UPDATE devices SET migrated=1 WHERE clientId=?')
      stmt.bind([clientId])
    }
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

// Get pending items that need to be pushed to backend
function getPendingItems() {
  try {
    const stmt = db.prepare('SELECT id, uuid, value, type, device, device_id, created_at FROM history WHERE pending=1 AND is_deleted=0 ORDER BY created_at ASC')
    const rows = []
    while (stmt.step()) {
      const r = stmt.getAsObject()
      // Generate UUID if item doesn't have one (UUID must be valid UUID format, not numeric ID)
      let itemUuid = r.uuid
      if (!itemUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemUuid)) {
        // Generate new UUID and update the database
        itemUuid = crypto.randomUUID()
        try {
          const updateStmt = db.prepare('UPDATE history SET uuid=? WHERE id=?')
          updateStmt.bind([itemUuid, r.id])
          updateStmt.step()
          updateStmt.free()
          persist()
        } catch (updateErr) {
          // Failed to update UUID
        }
      }
      rows.push({
        id: r.id,
        uuid: itemUuid,
        value: String(r.value),
        type: String(r.type || 'text'),
        device: String(r.device),
        device_id: r.device_id ? String(r.device_id) : null,
        created_at: String(r.created_at)
      })
    }
    stmt.free()
    return rows
  } catch (e) {
    return []
  }
}

// Mark item as completed (pending=0) after successful push
function markItemCompleted(uuid) {
  try {
    const stmt = db.prepare('UPDATE history SET pending=0 WHERE uuid=?')
    stmt.bind([uuid])
    stmt.step()
    stmt.free()
    persist()
    return true
  } catch (e) {
    return false
  }
}

// Update item with server data (from pull)
function updateItemFromServer(serverItem, device) {
  try {
    // serverItem: { id, uuid, deviceId, clientId, type, value, favorite, version, createdAt, updatedAt }
    // Try to find by uuid first, then by remote_id, then by value
    let stmt = db.prepare('SELECT id FROM history WHERE uuid=? OR remote_id=? LIMIT 1')
    const uuid = serverItem.uuid || serverItem.id
    stmt.bind([uuid, serverItem.id])
    let found = false
    if (stmt.step()) {
      const r = stmt.getAsObject()
      found = true
      // Update existing
      stmt.free()
      try {
        stmt = db.prepare('UPDATE history SET value=?, favorite=?, remote_id=?, version=?, updated_at=?, device_id=?, pending=0, type=? WHERE id=?')
        stmt.bind([
          serverItem.value,
          serverItem.favorite ? 1 : 0,
          serverItem.id,
          serverItem.version || 1,
          serverItem.updatedAt || serverItem.createdAt,
          serverItem.deviceId,
          serverItem.type || 'text',
          r.id
        ])
      } catch (e) {
        // Fallback
        stmt = db.prepare('UPDATE history SET value=?, favorite=?, remote_id=? WHERE id=?')
        stmt.bind([
          serverItem.value,
          serverItem.favorite ? 1 : 0,
          serverItem.id,
          r.id
        ])
      }
      stmt.step()
      stmt.free()
    } else {
      stmt.free()
      // Insert new if not found
      const existing = db.prepare('SELECT id FROM history WHERE value=? AND device=? LIMIT 1')
      existing.bind([serverItem.value, device])
      if (!existing.step()) {
        existing.free()
        // Insert new item from server
        try {
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
        } catch (e) {
          // Fallback
          stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, remote_id) VALUES(?, ?, ?, ?, ?)')
          stmt.bind([
            serverItem.value,
            serverItem.favorite ? 1 : 0,
            device,
            serverItem.createdAt,
            serverItem.id
          ])
        }
        stmt.step()
        stmt.free()
      } else {
        existing.free()
      }
    }
    persist()
    return true
  } catch (e) {
    return false
  }
}

// SQL Editor functions
function executeQuery(query) {
  try {
    if (!db) {
      throw new Error('Base de datos no inicializada')
    }
    
    const trimmedQuery = String(query || '').trim()
    if (!trimmedQuery) {
      throw new Error('Consulta SQL vacía')
    }
    
    // Separar múltiples queries por punto y coma y ejecutar solo la primera
    const queries = trimmedQuery.split(';').map(q => q.trim()).filter(q => q.length > 0)
    if (queries.length === 0) {
      throw new Error('Consulta SQL vacía')
    }
    
    const firstQuery = queries[0]
    const upperQuery = firstQuery.toUpperCase().trim()
    
    // Detectar tipo de query
    if (upperQuery.startsWith('SELECT') || upperQuery.startsWith('PRAGMA')) {
      // Query SELECT o PRAGMA - retornar resultados
      const result = db.exec(firstQuery)
      if (result.length === 0) {
        return { columns: [], rows: [] }
      }
      
      const firstResult = result[0]
      const columns = firstResult.columns || []
      const values = firstResult.values || []
      
      // Convertir a array de objetos
      const rows = values.map(row => {
        const obj = {}
        columns.forEach((col, index) => {
          let value = row[index]
          // Convertir valores especiales
          if (value === null || value === undefined) {
            value = null
          } else if (typeof value === 'number') {
            value = value
          } else {
            value = String(value)
          }
          obj[col] = value
        })
        return obj
      })
      
      return { columns, rows }
    } else if (upperQuery.startsWith('INSERT') || upperQuery.startsWith('UPDATE') || upperQuery.startsWith('DELETE')) {
      // Query de modificación - ejecutar y obtener filas afectadas
      // Para INSERT, UPDATE, DELETE necesitamos contar manualmente o usar stmt.getRowsModified()
      // SQL.js no tiene getRowsModified directamente, así que hacemos un workaround
      
      let rowsAffected = 0
      try {
        // Preparar statement para poder obtener información
        const stmt = db.prepare(firstQuery)
        stmt.step()
        
        // Para INSERT: contar registros después
        if (upperQuery.startsWith('INSERT')) {
          // Intentar obtener el ID del último insert
          try {
            const lastIdResult = db.exec('SELECT last_insert_rowid()')
            if (lastIdResult.length > 0 && lastIdResult[0].values && lastIdResult[0].values.length > 0) {
              rowsAffected = 1
            }
          } catch (e) {
            rowsAffected = 1 // Asumir 1 fila insertada
          }
        } else {
          // Para UPDATE/DELETE, asumir 1 fila afectada (SQL.js no provee mejor manera)
          rowsAffected = 1
        }
        
        stmt.free()
      } catch (e) {
        // Si falla la preparación, usar run directamente
        db.run(firstQuery)
        rowsAffected = 1
      }
      
      persist()
      return { rowsAffected, message: 'Consulta ejecutada exitosamente' }
    } else {
      // Otras queries (CREATE, DROP, ALTER, etc.)
      db.run(firstQuery)
      persist()
      return { message: 'Consulta ejecutada exitosamente' }
    }
  } catch (e) {
    throw new Error(e.message || 'Error al ejecutar consulta SQL')
  }
}

function listTables() {
  try {
    if (!db) {
      return []
    }
    
    // Obtener todas las tablas usando sqlite_master
    const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    
    if (result.length === 0 || !result[0].values) {
      return []
    }
    
    const tables = []
    for (const row of result[0].values) {
      const tableName = String(row[0])
      
      // Obtener conteo de filas
      let rowCount = 0
      try {
        const countResult = db.exec(`SELECT COUNT(*) as count FROM ${tableName}`)
        if (countResult.length > 0 && countResult[0].values && countResult[0].values.length > 0) {
          rowCount = Number(countResult[0].values[0][0]) || 0
        }
      } catch (e) {
        // Ignorar errores al contar filas
      }
      
      tables.push({
        name: tableName,
        rowCount: rowCount
      })
    }
    
    return tables
  } catch (e) {
    return []
  }
}

function getTableInfo(tableName) {
  try {
    if (!db || !tableName) {
      return null
    }
    
    // Obtener información de columnas usando PRAGMA table_info
    const result = db.exec(`PRAGMA table_info(${tableName})`)
    
    if (result.length === 0 || !result[0].values) {
      return null
    }
    
    const columns = []
    const values = result[0].values
    const columnNames = result[0].columns || ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk']
    let primaryKey = null
    
    values.forEach(row => {
      const col = {}
      columnNames.forEach((name, index) => {
        col[name] = row[index]
      })
      // Detectar clave primaria
      if (col.pk === 1 || col.pk === '1' || col.pk === true) {
        primaryKey = col.name
      }
      columns.push(col)
    })
    
    // Si no se encontró clave primaria, intentar con el primer campo llamado 'id'
    if (!primaryKey) {
      const idColumn = columns.find(col => col.name && col.name.toLowerCase() === 'id')
      if (idColumn) {
        primaryKey = idColumn.name
      } else if (columns.length > 0) {
        // Fallback: usar el primer campo
        primaryKey = columns[0].name
      }
    }
    
    // Obtener conteo de filas
    let rowCount = 0
    try {
      const countResult = db.exec(`SELECT COUNT(*) as count FROM ${tableName}`)
      if (countResult.length > 0 && countResult[0].values && countResult[0].values.length > 0) {
        rowCount = Number(countResult[0].values[0][0]) || 0
      }
    } catch (e) {
      // Ignorar errores
    }
    
    return {
      name: tableName,
      columns: columns,
      columnCount: columns.length,
      rowCount: rowCount,
      primaryKey: primaryKey
    }
  } catch (e) {
    return null
  }
}

module.exports = { init, getAll, insert, setFavorite, clear, clearAll, importItems, search, searchPaginated, getRecent, getByValues, getNotIn, trimToLimit, insertGuest, getAllGuest, clearGuest, trimGuestToLimit, searchGuest, searchGuestPaginated, getRecentGuest, deleteById, getById, updateRemoteIdByValue, getDirtyItems, markSynced, updateFromConflict, updateRemoteId, countActive, countGuestActive, deleteNotInRemote, getConfig, setConfig, removeConfig, getAllConfig, getLegacyImages, updateValue, updateImagesBulk, saveDevice, getDevice, getDeviceByClientId, getAllDevices, updateDeviceLastSyncAt, getPendingItems, markItemCompleted, updateItemFromServer, markDeviceAsMigrated, executeQuery, listTables, getTableInfo, reloadDatabase }
