---
inclusion: fileMatch
fileMatchPattern: 'db.js'
---

# CopyFy++ - Base de Datos SQLite

## Esquema de Base de Datos

### Tabla: clipboard_history
```sql
CREATE TABLE clipboard_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,           -- 'text' | 'image' | 'code'
  content TEXT,                 -- Contenido textual o base64
  preview TEXT,                 -- Preview corto para UI
  language TEXT,                -- Para código: 'javascript', 'python', etc.
  timestamp INTEGER NOT NULL,   -- Unix timestamp
  favorite INTEGER DEFAULT 0,   -- 0 o 1 (booleano)
  tags TEXT,                    -- JSON array de tags
  device_id TEXT,               -- ID del dispositivo (para sync)
  synced INTEGER DEFAULT 0      -- Estado de sincronización
);
```

### Índices
```sql
CREATE INDEX idx_timestamp ON clipboard_history(timestamp DESC);
CREATE INDEX idx_type ON clipboard_history(type);
CREATE INDEX idx_favorite ON clipboard_history(favorite);
```

## Operaciones Comunes

### Insertar Item
```javascript
db.run(
  `INSERT INTO clipboard_history (type, content, preview, timestamp) 
   VALUES (?, ?, ?, ?)`,
  [type, content, preview, Date.now()]
);
```

### Buscar
```javascript
db.all(
  `SELECT * FROM clipboard_history 
   WHERE content LIKE ? OR preview LIKE ?
   ORDER BY timestamp DESC LIMIT 100`,
  [`%${query}%`, `%${query}%`]
);
```

### Eliminar Antiguos
```javascript
// Mantener solo últimos 1000 items
db.run(
  `DELETE FROM clipboard_history 
   WHERE id NOT IN (
     SELECT id FROM clipboard_history 
     ORDER BY timestamp DESC LIMIT 1000
   )`
);
```

## Manejo de Imágenes

- Guardar como base64 en campo `content`
- Generar thumbnail para `preview`
- Considerar límite de tamaño (ej: 5MB)
- Comprimir si es necesario

## Sincronización

- Campo `device_id` identifica origen
- Campo `synced` marca estado de sincronización
- Evitar duplicados comparando timestamp + content hash
- Resolver conflictos: último timestamp gana

## Performance

- Usar transacciones para operaciones batch
- Limitar resultados con LIMIT
- Índices en campos de búsqueda frecuente
- Vacuum periódico para optimizar espacio

## Backup

- Base de datos en `userData` de Electron
- Considerar backup automático antes de sync
- Exportar/importar en formato JSON para portabilidad
