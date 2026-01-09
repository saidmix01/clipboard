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
      { col: 'is_deleted', sql: "ALTER TABLE history ADD COLUMN is_deleted INTEGER DEFAULT 0" }
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
          console.error(`Migration failed for ${m.col}:`, e.message)
        }
      }
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
        { col: 'is_deleted', sql: "ALTER TABLE history ADD COLUMN is_deleted INTEGER DEFAULT 0" }
      ]

      for (const cm of criticalMigrations) {
        if (!finalColumns.has(cm.col)) {
           console.warn(`Columna crítica faltante detectada tardíamente: ${cm.col}. Intentando reparación de emergencia.`)
           try { 
             db.run(cm.sql) 
             if (cm.col === 'updated_at') {
                try { db.run("UPDATE history SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE updated_at IS NULL") } catch {}
             }
           } catch(e) { console.error(`Fallo reparación emergencia ${cm.col}:`, e.message) }
        }
      }
    } catch(e) {
      console.error('Error en verificación final de esquema:', e)
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
    console.error('Migration check failed:', e)
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
  } catch (e) { console.error('Schema verification failed:', e) }

  // Ensure all items have a client_item_id
  try {
    const rows = db.exec("SELECT id FROM history WHERE client_item_id IS NULL")
    if (rows.length > 0 && rows[0].values) {
      for (const r of rows[0].values) {
        db.run("UPDATE history SET client_item_id=? WHERE id=?", [crypto.randomUUID(), r[0]])
      }
    }
  } catch (e) {
    console.error('Failed to backfill client_item_id:', e.message)
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
      console.warn('getAll: Schema mismatch detected, falling back to legacy query')
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
        console.error('getAll legacy fallback failed:', e2)
        return []
      }
    }
    console.error('getAll failed:', e)
    return []
  }
}

function insert(device, value, remoteId = null) {
  // If exists, update timestamp and version. If new, insert.
  const existing = db.prepare('SELECT id, version, client_item_id FROM history WHERE device=? AND value=?')
  existing.bind([device, value])
  if (existing.step()) {
    const r = existing.getAsObject()
    const newVer = (r.version || 0) + 1
    let stmt
    try {
        stmt = db.prepare('UPDATE history SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), updated_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), version=?, is_synced=0, remote_id=coalesce(?, remote_id) WHERE id=?')
        stmt.bind([newVer, remoteId, r.id])
    } catch (e) {
        // Fallback for legacy schema
        stmt = db.prepare('UPDATE history SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), remote_id=coalesce(?, remote_id) WHERE id=?')
        stmt.bind([remoteId, r.id])
    }
    stmt.step()
    stmt.free()
  } else {
    let stmt
    try {
        stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, updated_at, remote_id, client_item_id, version, is_synced) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), ?, ?, 1, 0)')
        stmt.bind([value, 0, device, remoteId, crypto.randomUUID()])
    } catch(e) {
        // Fallback
        stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, remote_id) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), ?)')
        stmt.bind([value, 0, device, remoteId])
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
    const stmt = db.prepare('UPDATE history SET favorite=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), version=?, is_synced=0 WHERE id=?')
    stmt.bind([fav ? 1 : 0, newVer, r.id])
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
    console.error('getDirtyItems failed (possible schema mismatch, restart app):', e.message)
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
    console.error('updateFromConflict failed:', e.message)
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
      console.error('updateFromConflict fallback failed:', e2.message)
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
    where.push("value NOT LIKE 'data:image%'")
  }
  const f = String(filter || 'all')
  if (f === 'image') where.push("value LIKE 'data:image%'")
  else if (f === 'text') where.push("value NOT LIKE 'data:image%'")
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

function getRecentGuest(device, filter, limit) {
  const f = String(filter || 'all')
  const where = ['device=?']
  if (f === 'image') where.push("value LIKE 'data:image%'")
  else if (f === 'text') where.push("value NOT LIKE 'data:image%'")
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
    where.push("value NOT LIKE 'data:image%'")
  }
  const f = String(filter || 'all')
  if (f === 'image') where.push("value LIKE 'data:image%'")
  else if (f === 'text') where.push("value NOT LIKE 'data:image%'")
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

function persist() {
  if (!dbFilePath || !db) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (e) {
    console.error('Persist error:', e)
  }
}

function sanitize(name) {
  const s = String(name || '').trim()
  return s.replace(/[<>:"/\\|?*]/g, '').slice(0, 64) || 'device'
}

function getRecent(device, filter, limit) {
  const f = String(filter || 'all')
  const where = ['device=?']
  if (f === 'image') where.push("value LIKE 'data:image%'")
  else if (f === 'text') where.push("value NOT LIKE 'data:image%'")
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

module.exports = { init, getAll, insert, setFavorite, clear, importItems, search, getRecent, getByValues, getNotIn, trimToLimit, insertGuest, getAllGuest, clearGuest, trimGuestToLimit, searchGuest, getRecentGuest, deleteById, getById, updateRemoteIdByValue, getDirtyItems, markSynced, updateFromConflict, updateRemoteId, countActive, countGuestActive, deleteNotInRemote }
