const path = require('path')
const fs = require('fs')
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
      created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_history_device_value ON history(device, value);
    CREATE INDEX IF NOT EXISTS idx_history_device_created ON history(device, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_device_favorite ON history(device, favorite);
    CREATE TABLE IF NOT EXISTS guest_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      device TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_device_value ON guest_history(device, value);
    CREATE INDEX IF NOT EXISTS idx_guest_device_created ON guest_history(device, created_at DESC);
  `)
  try {
    db.run("ALTER TABLE history ADD COLUMN remote_id TEXT")
  } catch {}
  try {
    db.run("ALTER TABLE guest_history ADD COLUMN remote_id TEXT")
  } catch {}
  persist()
}

function getAll(device) {
  const stmt = db.prepare('SELECT id, value, favorite, remote_id FROM history WHERE device=? ORDER BY created_at DESC, id DESC')
  const rows = []
  stmt.bind([device])
  while (stmt.step()) {
    const r = stmt.getAsObject()
    rows.push({ id: String(r.id), value: String(r.value), favorite: !!r.favorite, remote_id: r.remote_id ? String(r.remote_id) : null })
  }
  stmt.free()
  return rows
}

function insert(device, value, remoteId = null) {
  const stmt = db.prepare('INSERT INTO history(value, favorite, device, created_at, remote_id) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), ?) ON CONFLICT(device, value) DO UPDATE SET created_at=strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'), remote_id=coalesce(excluded.remote_id, history.remote_id)')
  stmt.bind([value, 0, device, remoteId])
  stmt.step()
  stmt.free()
  persist()
}

function setFavorite(device, value, fav) {
  const stmt = db.prepare('UPDATE history SET favorite=? WHERE device=? AND value=?')
  stmt.bind([fav ? 1 : 0, device, value])
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

function importItems(device, items) {
  const insertStmt = db.prepare('INSERT OR IGNORE INTO history(value, favorite, device, created_at) VALUES(?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%f\', \'now\'))')
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.value !== 'string') continue
    insertStmt.bind([it.value, it.favorite ? 1 : 0, device])
    insertStmt.step()
    insertStmt.reset()
  }
  insertStmt.free()
  persist()
}

function trimToLimit(device, limit) {
  const n = Math.max(1, Number(limit || 50))
  const sql = `DELETE FROM history WHERE device=? AND id NOT IN (SELECT id FROM history WHERE device=? ORDER BY created_at DESC LIMIT ?)`
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
  const stmt = db.prepare('SELECT value, favorite FROM guest_history WHERE device=? ORDER BY created_at DESC, id DESC')
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
  const sql = `DELETE FROM guest_history WHERE device=? AND id NOT IN (SELECT id FROM guest_history WHERE device=? ORDER BY created_at DESC LIMIT ?)`
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
  if (q.length > 0) { where.push('value LIKE ?'); params.push('%' + q + '%') }
  const f = String(filter || 'all')
  if (f === 'image') where.push("value LIKE 'data:image%'")
  else if (f === 'text') where.push("value NOT LIKE 'data:image%'")
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
  if (q.length > 0) { where.push('value LIKE ?'); params.push('%' + q + '%') }
  const f = String(filter || 'all')
  if (f === 'image') where.push("value LIKE 'data:image%'")
  else if (f === 'text') where.push("value NOT LIKE 'data:image%'")
  else if (f === 'favorite') where.push('favorite=1')
  else if (f === 'all') where.push('favorite=0')
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
  } catch {}
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
  else if (f === 'all') where.push('favorite=0')
  const n = Math.max(1, Math.min(1000, Number(limit || 50)))
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
  const sql = `SELECT id, value, favorite FROM history WHERE device=? AND value IN (${placeholders})`
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
  const sql = `SELECT id, value, favorite FROM history WHERE device=? AND value NOT IN (${placeholders})`
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
  const stmt = db.prepare('SELECT id, value, favorite, remote_id FROM history WHERE id=?')
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

module.exports = { init, getAll, insert, setFavorite, clear, importItems, search, getRecent, getByValues, getNotIn, trimToLimit, insertGuest, getAllGuest, clearGuest, trimGuestToLimit, searchGuest, getRecentGuest, deleteById, getById, updateRemoteIdByValue }
