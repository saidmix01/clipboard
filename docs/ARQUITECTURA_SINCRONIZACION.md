# Arquitectura del Sistema de Sincronización - CopyFy++

**Versión**: 2.0  
**Fecha**: 27 de febrero de 2026  
**Estado**: Implementado

---

## Resumen Ejecutivo

Sistema de sincronización con la nube **NO en tiempo real**, ejecutándose automáticamente cada hora. Diseñado para ser estable, tolerante a fallos, eficiente en recursos y que **NO bloquea el hilo principal**.

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │   main.ts    │─────▶│ BackendDaemon│                     │
│  │              │      │              │                     │
│  │ - Clipboard  │      │ - HTTP Client│                     │
│  │   Watcher    │      │ - Auth       │                     │
│  │ - IPC        │      │ - Devices    │                     │
│  └──────┬───────┘      └──────┬───────┘                     │
│         │                     │                              │
│         │                     │                              │
│         ▼                     ▼                              │
│  ┌──────────────────────────────────────┐                   │
│  │          SyncEngine                  │                   │
│  │  ┌────────────────────────────────┐  │                   │
│  │  │  Scheduler (cada 1 hora)       │  │                   │
│  │  └────────────────────────────────┘  │                   │
│  │  ┌────────────────────────────────┐  │                   │
│  │  │  SyncQueue (cola persistente)  │  │                   │
│  │  └────────────────────────────────┘  │                   │
│  │  ┌────────────────────────────────┐  │                   │
│  │  │  ConflictResolver (LWW)        │  │                   │
│  │  └────────────────────────────────┘  │                   │
│  │  ┌────────────────────────────────┐  │                   │
│  │  │  NetworkMonitor (30s check)    │  │                   │
│  │  └────────────────────────────────┘  │                   │
│  └──────────────────────────────────────┘                   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │   db.js      │                                           │
│  │  (SQLite)    │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Componentes Principales

### 1. SyncEngine (backend/SyncEngine.ts)

**Responsabilidad**: Orquestador principal de sincronización

**Características**:
- Scheduler automático cada 1 hora
- Sincronización manual bajo demanda
- Prevención de ejecución concurrente (lock)
- Broadcasting de estadísticas a UI
- Manejo de reconexión automática

**Flujo de Sincronización**:
```
1. Verificar si ya está ejecutando (lock)
2. Verificar conectividad de red
3. Verificar autenticación
4. FASE 1: Enviar cambios locales (push)
5. FASE 2: Recibir cambios remotos (pull)
6. FASE 3: Resolver conflictos
7. Actualizar estadísticas
8. Liberar lock
```

**APIs Públicas**:
- `startScheduler()` - Inicia sincronización automática cada hora
- `stopScheduler()` - Detiene sincronización automática
- `syncNow()` - Sincronización manual inmediata
- `getStats()` - Obtiene estadísticas de sincronización
- `enqueueItem(itemId, operation)` - Encola item para sincronización

### 2. SyncQueue (backend/SyncQueue.ts)

**Responsabilidad**: Cola persistente de operaciones pendientes

**Características**:
- Persistencia en SQLite (sobrevive reinicios)
- Retry con backoff exponencial (2^n segundos, máx 60s)
- Deduplicación de operaciones
- Límite de 5 reintentos por operación
- Cleanup automático de operaciones antiguas (>7 días)

**Estructura de Operación**:
```typescript
{
  type: 'CREATE' | 'UPDATE' | 'DELETE',
  itemId: string,
  item: ClipboardItem,
  timestamp: number,
  retries: number,
  nextRetryAt?: number
}
```

**Backoff Exponencial**:
```
Intento 1: 2 segundos
Intento 2: 4 segundos
Intento 3: 8 segundos
Intento 4: 16 segundos
Intento 5: 32 segundos
Intento 6+: 60 segundos (máximo)
```

### 3. ConflictResolver (backend/ConflictResolver.ts)

**Responsabilidad**: Resolución de conflictos de datos

**Estrategia**: Last-Write-Wins (LWW) basado en timestamp

**Algoritmo**:
```
1. Comparar updatedAt de versión local vs remota
2. Si local.updatedAt > remote.updatedAt → Gana local
3. Si remote.updatedAt > local.updatedAt → Gana remota
4. Si iguales → Desempate por deviceId (alfabético)
5. Incrementar versión del ganador
6. Loguear conflicto para análisis
```

**Validaciones**:
- Verificar que ambas versiones existan
- Verificar que tengan la misma versión (conflicto real)
- Verificar que los valores sean diferentes
- Validar item resuelto antes de guardar

### 4. NetworkMonitor (backend/NetworkMonitor.ts)

**Responsabilidad**: Monitoreo de conectividad de red

**Características**:
- Check periódico cada 30 segundos
- Timeout de 5 segundos por check
- Notificación de cambios de estado (online/offline)
- Trigger automático de sync al reconectar
- No bloquea el hilo principal

**Método de Detección**:
```
1. HTTP HEAD request a https://www.google.com
2. Timeout de 5 segundos
3. Cualquier respuesta 2xx-4xx = ONLINE
4. Timeout o error de red = OFFLINE
```

---

## Flujo Completo de Sincronización

### FASE 1: Envío de Cambios Locales (Push)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Usuario copia texto/imagen                           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Clipboard Watcher detecta cambio                     │
│    - Deduplicación por hash (imágenes) o valor (texto)  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. BackendDaemon.saveClipboardItem()                    │
│    - Verifica dispositivo activo                        │
│    - Inserta en DB con deviceId                         │
│    - Retorna item con ID                                │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. SyncEngine.enqueueItem(itemId, 'CREATE')             │
│    - Agrega a cola persistente                          │
│    - Marca como pendiente en DB                         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Scheduler ejecuta sync (cada 1 hora)                 │
│    - O sync manual por usuario                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 6. SyncQueue.dequeue()                                  │
│    - Obtiene siguiente operación lista                  │
│    - Verifica nextRetryAt                               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 7. BackendDaemon.request(POST /clipboard/items)         │
│    - Envía item a la nube                               │
│    - Incluye versión y timestamp                        │
└────────────────┬────────────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
    ┌────────┐      ┌────────┐
    │ ÉXITO  │      │ ERROR  │
    └───┬────┘      └───┬────┘
        │               │
        ▼               ▼
┌──────────────┐  ┌──────────────────┐
│ Marcar como  │  │ ¿Reintentar?     │
│ sincronizado │  │ - Red: SÍ        │
│              │  │ - 5xx: SÍ        │
│              │  │ - 4xx: NO        │
│              │  │ - Max 5: NO      │
└──────────────┘  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ Backoff          │
                  │ exponencial      │
                  │ Re-encolar       │
                  └──────────────────┘
```

### FASE 2: Recepción de Cambios Remotos (Pull)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Scheduler ejecuta sync                                │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. GET /clipboard/items?since=lastSyncAt                │
│    - Excluye items del dispositivo actual               │
│    - Filtra por timestamp del último sync               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Para cada item remoto:                               │
│    - Verificar si existe localmente                     │
└────────────────┬────────────────────────────────────────┘
                 │
         ┌───────┴───────┬───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌────────┐      ┌────────┐     ┌──────────┐
    │ NUEVO  │      │ EXISTE │     │ EXISTE   │
    │        │      │ v_rem  │     │ v_rem =  │
    │        │      │ > v_loc│     │ v_loc    │
    └───┬────┘      └───┬────┘     └────┬─────┘
        │               │               │
        ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Insertar     │  │ Actualizar   │  │ CONFLICTO    │
│ en DB local  │  │ DB local     │  │ → Fase 3     │
└──────────────┘  └──────────────┘  └──────────────┘
```

### FASE 3: Resolución de Conflictos

```
┌─────────────────────────────────────────────────────────┐
│ 1. Detectar conflicto: v_local == v_remote              │
│    pero valores diferentes                              │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. ConflictResolver.resolve(local, remote)              │
│    - Comparar updatedAt timestamps                      │
└────────────────┬────────────────────────────────────────┘
                 │
         ┌───────┴───────┬───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌────────┐      ┌────────┐     ┌──────────┐
    │ local  │      │ remote │     │ EMPATE   │
    │ > rem  │      │ > loc  │     │          │
    └───┬────┘      └───┬────┘     └────┬─────┘
        │               │               │
        └───────┬───────┘               │
                │                       ▼
                │              ┌──────────────┐
                │              │ Desempate    │
                │              │ por deviceId │
                │              └────┬─────────┘
                │                   │
                └───────┬───────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Ganador:                                             │
│    - Incrementar versión (max(v_local, v_remote) + 1)  │
│    - Actualizar updatedAt                               │
│    - Marcar conflictResolvedAt                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Guardar item resuelto en DB local                    │
│    - Limpiar marca de conflicto                         │
│    - Loguear para análisis                              │
└─────────────────────────────────────────────────────────┘
```

---

## Esquema de Base de Datos

### Tabla: ClipboardItem (Actualizada)

```sql
CREATE TABLE ClipboardItem (
  Id TEXT PRIMARY KEY,
  Value TEXT,
  Type TEXT,
  IsFavorite BOOLEAN DEFAULT 0,
  CreatedAt DATETIME,
  UpdatedAt DATETIME,
  IsDeleted BOOLEAN DEFAULT 0,
  Pending BOOLEAN DEFAULT 0,      -- 0: sincronizado, 1: pendiente, 2: conflicto
  DeviceId TEXT,
  Version INTEGER DEFAULT 1
);

-- Índices optimizados
CREATE INDEX idx_clipboard_created ON ClipboardItem(CreatedAt DESC);
CREATE INDEX idx_clipboard_favorite ON ClipboardItem(IsFavorite);
CREATE INDEX idx_clipboard_device ON ClipboardItem(DeviceId, CreatedAt DESC);
CREATE INDEX idx_clipboard_pending ON ClipboardItem(Pending) WHERE Pending = 1;
```

### Tabla: SyncQueue (Nueva)

```sql
CREATE TABLE SyncQueue (
  Id TEXT PRIMARY KEY,
  OperationType TEXT,             -- 'CREATE', 'UPDATE', 'DELETE'
  ItemId TEXT,
  ItemData TEXT,                  -- JSON serializado del item
  Timestamp INTEGER,
  Retries INTEGER DEFAULT 0,
  NextRetryAt INTEGER,            -- NULL si listo para procesar
  CreatedAt DATETIME
);

-- Índice para búsqueda eficiente
CREATE INDEX idx_syncqueue_retry ON SyncQueue(NextRetryAt);
```

---

## Manejo de Errores y Reintentos

### Errores Reintentables

```typescript
const RETRYABLE_ERRORS = [
  'ETIMEDOUT',      // Timeout de red
  'ECONNREFUSED',   // Conexión rechazada
  'ENOTFOUND',      // DNS no resuelve
  'ECONNRESET',     // Conexión reseteada
  // HTTP 5xx
  500, 502, 503, 504
];
```

### Errores NO Reintentables

```typescript
const NON_RETRYABLE_ERRORS = [
  // HTTP 4xx (errores del cliente)
  400, 401, 403, 404, 409, 422
];
```

### Estrategia de Reintentos

```
Intento 1: Inmediato
Intento 2: 2 segundos después
Intento 3: 4 segundos después
Intento 4: 8 segundos después
Intento 5: 16 segundos después
Intento 6: 32 segundos después
Intento 7+: 60 segundos después (máximo)

Máximo de reintentos: 5
Después de 5 fallos: Marcar como fallido permanentemente
```

---

## Prevención de Problemas Críticos

### 1. Race Conditions

**Problema**: Múltiples sincronizaciones concurrentes

**Solución**:
```typescript
private isRunning: boolean = false;

async performSync() {
  if (this.isRunning) {
    console.log('Sync already in progress, skipping');
    return;
  }
  
  this.isRunning = true;
  try {
    // ... sincronización ...
  } finally {
    this.isRunning = false;
  }
}
```

### 2. Memory Leaks

**Problema**: Intervalos y listeners no limpiados

**Solución**:
```typescript
// Guardar referencia al intervalo
private syncInterval: NodeJS.Timeout | null = null;

// Limpiar en destroy()
public destroy() {
  if (this.syncInterval) {
    clearInterval(this.syncInterval);
    this.syncInterval = null;
  }
  this.networkMonitor.destroy();
}
```

### 3. Pérdida de Datos

**Problema**: Persist síncrono sin manejo de errores

**Solución**:
```typescript
// Propagar errores
function persist() {
  try {
    const data = db.export();
    fs.writeFileSync(dbFilePath, Buffer.from(data));
  } catch (e) {
    console.error('Error persisting DB:', e);
    throw e; // Propagar para que el caller lo maneje
  }
}

// Versión asíncrona para operaciones no críticas
async function persistAsync() {
  return new Promise((resolve, reject) => {
    try {
      const data = db.export();
      fs.writeFile(dbFilePath, Buffer.from(data), (err) => {
        if (err) reject(err);
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}
```

### 4. Bloqueo del Hilo Principal

**Problema**: Operaciones síncronas bloqueantes

**Solución**:
- Todas las operaciones de red son asíncronas (axios)
- Sincronización en background (no bloquea UI)
- Polling de red cada 30 segundos (no cada segundo)
- Clipboard watcher optimizado (1 segundo es aceptable)

---

## APIs Expuestas a Frontend

### IPC Handlers

```typescript
// Sincronización manual
ipcMain.handle('sync:now', async () => {
  const syncEngine = SyncEngine.getInstance();
  return syncEngine.syncNow();
});

// Obtener estadísticas
ipcMain.handle('sync:get-stats', () => {
  const syncEngine = SyncEngine.getInstance();
  return syncEngine.getStats();
});
```

### IPC Events (Renderer ← Main)

```typescript
// Estadísticas de sincronización
mainWindow.webContents.send('sync:stats', {
  lastSyncAt: 1709049600000,
  itemsSynced: 42,
  itemsPending: 3,
  errors: 0,
  isRunning: false
});

// Estado de red
mainWindow.webContents.send('sync:network-status', {
  online: true
});
```

### Uso en Frontend

```typescript
// Sincronización manual
const stats = await window.electronAPI.syncNow();

// Escuchar estadísticas
window.electronAPI.onSyncStats((stats) => {
  console.log('Sync stats:', stats);
});

// Escuchar estado de red
window.electronAPI.onNetworkStatus((status) => {
  console.log('Network:', status.online ? 'ONLINE' : 'OFFLINE');
});
```

---

## Monitoreo y Logs

### Logs Estructurados

```typescript
console.log('[SyncEngine] Starting sync cycle');
console.log('[SyncEngine] Pushed 5 operations');
console.log('[SyncEngine] Received 3 remote items');
console.log('[SyncEngine] Resolved 1 conflicts');
console.log('[SyncEngine] Sync cycle completed successfully');
```

### Estadísticas en Tiempo Real

```typescript
{
  lastSyncAt: 1709049600000,      // Timestamp del último sync exitoso
  itemsSynced: 42,                // Total de items sincronizados
  itemsPending: 3,                // Items en cola pendientes
  errors: 0,                      // Errores en el último ciclo
  isRunning: false                // Si está ejecutando actualmente
}
```

---

## Configuración y Personalización

### Intervalos Configurables

```typescript
// En SyncEngine.ts
private readonly SYNC_INTERVAL_MS = 3600000;  // 1 hora (configurable)

// En NetworkMonitor.ts
private readonly CHECK_INTERVAL_MS = 30000;   // 30 segundos
private readonly TIMEOUT_MS = 5000;           // 5 segundos
```

### Límites Configurables

```typescript
// En SyncQueue.ts
private readonly MAX_RETRIES = 5;             // Máximo de reintentos
private readonly MAX_BACKOFF_MS = 60000;      // Backoff máximo: 60s
private readonly CLEANUP_DAYS = 7;            // Limpiar ops > 7 días
```

---

## Testing y Validación

### Tests Recomendados

1. **Unit Tests**:
   - ConflictResolver.resolve() con diferentes escenarios
   - SyncQueue.scheduleRetry() con backoff exponencial
   - NetworkMonitor.isConnected() con mocks

2. **Integration Tests**:
   - Flujo completo de push (local → nube)
   - Flujo completo de pull (nube → local)
   - Resolución de conflictos end-to-end

3. **E2E Tests**:
   - Sincronización entre 2 dispositivos
   - Manejo de offline/online
   - Recuperación de errores

### Escenarios de Prueba

```
✓ Crear item local → Sincronizar → Verificar en nube
✓ Crear item remoto → Pull → Verificar local
✓ Modificar mismo item en 2 dispositivos → Resolver conflicto
✓ Desconectar red → Crear items → Reconectar → Sincronizar
✓ Cerrar app con items pendientes → Reabrir → Sincronizar
✓ Fallar 5 veces → Marcar como fallido permanentemente
```

---

## Roadmap Futuro

### Fase 1: Optimizaciones (Completado)
- ✅ Sincronización cada hora
- ✅ Cola persistente con retry
- ✅ Resolución de conflictos LWW
- ✅ Monitoreo de red
- ✅ Prevención de race conditions

### Fase 2: Mejoras (Próximo)
- [ ] WebSocket para push notifications (opcional)
- [ ] Compresión de datos grandes
- [ ] Encriptación end-to-end
- [ ] Sincronización selectiva por tipo
- [ ] Historial de conflictos en UI

### Fase 3: Avanzado (Futuro)
- [ ] CRDT para resolución automática
- [ ] Sincronización incremental (delta sync)
- [ ] Priorización de items (favoritos primero)
- [ ] Telemetría y analytics
- [ ] Modo offline-first completo

---

**Fin del Documento**

Preparado por: Ingeniero Senior - Arquitectura Electron/React/Node.js  
Fecha: 27 de febrero de 2026  
Versión: 2.0
