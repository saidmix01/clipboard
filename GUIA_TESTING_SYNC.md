# Guía Práctica de Testing - Sistema de Sincronización

**Fecha**: 27 de febrero de 2026  
**Nivel**: Paso a paso para desarrolladores

---

## Preparación Inicial

### 1. Compilar el Proyecto

```bash
# Compilar TypeScript a JavaScript
npm run build

# O si usas tsc directamente
npx tsc
```

**Verificar que se compilaron los archivos**:
```bash
ls backend/*.js
# Deberías ver:
# - BackendDaemon.js
# - SyncEngine.js (nuevo)
# - SyncQueue.js (nuevo)
# - ConflictResolver.js (nuevo)
# - NetworkMonitor.js (nuevo)
```

### 2. Iniciar en Modo Desarrollo

```bash
npm run dev
```

**Logs esperados al iniciar**:
```
[Main] Backend Daemon Initialized
[SyncEngine] Starting hourly sync scheduler
[SyncEngine] Starting sync cycle
[NetworkMonitor] Starting network monitoring
[NetworkMonitor] Network status changed: ONLINE
```

---

## Test 1: Verificar Inicialización

### Objetivo
Confirmar que el SyncEngine se inicializó correctamente.

### Pasos

1. **Abrir DevTools** en la aplicación:
   - Windows/Linux: `Ctrl + Shift + I`
   - macOS: `Cmd + Option + I`

2. **Ejecutar en la consola**:
```javascript
// Verificar que las APIs están disponibles
console.log('syncNow:', typeof window.electronAPI.syncNow);
console.log('getSyncStats:', typeof window.electronAPI.getSyncStats);
console.log('onSyncStats:', typeof window.electronAPI.onSyncStats);

// Debería mostrar:
// syncNow: function
// getSyncStats: function
// onSyncStats: function
```

3. **Obtener estadísticas iniciales**:
```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Sync Stats:', stats);

// Debería mostrar algo como:
// {
//   lastSyncAt: null,
//   itemsSynced: 0,
//   itemsPending: 0,
//   errors: 0,
//   isRunning: false
// }
```

✅ **Resultado esperado**: Todas las funciones están disponibles y las estadísticas se obtienen correctamente.

---

## Test 2: Copiar Items y Verificar Encolado

### Objetivo
Verificar que los items copiados se encolan para sincronización.

### Pasos

1. **Copiar texto** (Ctrl+C o Cmd+C):
   - Selecciona cualquier texto
   - Cópialo al portapapeles

2. **Verificar logs en la terminal**:
```
[Main] broadcastUpdate settings.selectedDeviceId: <device-id>
[Main] broadcastUpdate sending 1 items (Device: <device-id>)
[SyncEngine] Enqueued new operation for item <item-id>
[SyncQueue] Enqueued new operation for item <item-id>
```

3. **Verificar en DevTools**:
```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Items pendientes:', stats.itemsPending);
// Debería mostrar: 1 (o más si copiaste varios items)
```

4. **Copiar más items**:
   - Copia 2-3 textos diferentes
   - Verifica que `itemsPending` aumenta

✅ **Resultado esperado**: Cada item copiado incrementa `itemsPending` en 1.

---

## Test 3: Sincronización Manual

### Objetivo
Ejecutar sincronización manualmente sin esperar 1 hora.

### Pasos

1. **Asegúrate de tener items pendientes**:
```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Pendientes antes:', stats.itemsPending);
```

2. **Ejecutar sincronización manual**:
```javascript
console.log('Iniciando sync manual...');
const result = await window.electronAPI.syncNow();
console.log('Sync completado:', result);
```

3. **Verificar logs en la terminal**:
```
[SyncEngine] Starting sync cycle
[SyncEngine] Pushing local changes...
[SyncEngine] Pushed 3 operations
[SyncEngine] Pulling remote changes...
[SyncEngine] Received 0 remote items
[SyncEngine] Resolving conflicts...
[SyncEngine] Resolved 0 conflicts
[SyncEngine] Sync cycle completed successfully
```

4. **Verificar estadísticas después**:
```javascript
const statsAfter = await window.electronAPI.getSyncStats();
console.log('Pendientes después:', statsAfter.itemsPending);
console.log('Sincronizados:', statsAfter.itemsSynced);
console.log('Último sync:', new Date(statsAfter.lastSyncAt));
```

✅ **Resultado esperado**: 
- `itemsPending` disminuye a 0
- `itemsSynced` aumenta
- `lastSyncAt` tiene timestamp reciente

---

## Test 4: Monitoreo en Tiempo Real

### Objetivo
Escuchar eventos de sincronización en tiempo real.

### Pasos

1. **Configurar listeners en DevTools**:
```javascript
// Listener de estadísticas
window.electronAPI.onSyncStats((stats) => {
  console.log('📊 Sync Stats Update:', {
    pendientes: stats.itemsPending,
    sincronizados: stats.itemsSynced,
    errores: stats.errors,
    ejecutando: stats.isRunning,
    ultimoSync: stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Nunca'
  });
});

// Listener de red
window.electronAPI.onNetworkStatus((status) => {
  console.log('🌐 Network Status:', status.online ? 'ONLINE ✅' : 'OFFLINE ❌');
});

console.log('✅ Listeners configurados');
```

2. **Copiar varios items**:
   - Copia 3-4 textos diferentes
   - Observa los logs en consola

3. **Ejecutar sync manual**:
```javascript
await window.electronAPI.syncNow();
```

4. **Observar actualizaciones en tiempo real**:
   - Deberías ver múltiples logs de `📊 Sync Stats Update`
   - Verifica que `ejecutando` cambia a `true` y luego a `false`

✅ **Resultado esperado**: Los listeners reciben actualizaciones en tiempo real durante la sincronización.

---

## Test 5: Modo Offline

### Objetivo
Verificar comportamiento cuando no hay conexión a internet.

### Pasos

1. **Desconectar internet**:
   - Desactiva WiFi o desconecta cable Ethernet

2. **Verificar detección en logs** (espera ~30 segundos):
```
[NetworkMonitor] Network status changed: OFFLINE
```

3. **Verificar en DevTools**:
```javascript
// Deberías ver el evento de red
// 🌐 Network Status: OFFLINE ❌
```

4. **Copiar items mientras estás offline**:
   - Copia 2-3 textos
   - Verifica que se guardan localmente

5. **Intentar sincronización manual**:
```javascript
const result = await window.electronAPI.syncNow();
console.log('Resultado offline:', result);
```

6. **Verificar logs**:
```
[SyncEngine] Offline, skipping sync
```

7. **Reconectar internet**:
   - Activa WiFi o reconecta cable

8. **Verificar reconexión** (espera ~30 segundos):
```
[NetworkMonitor] Network status changed: ONLINE
[SyncEngine] Network reconnected, triggering sync
[SyncEngine] Starting sync cycle
```

✅ **Resultado esperado**: 
- Items se guardan localmente mientras estás offline
- Sincronización se salta automáticamente
- Al reconectar, sincronización se ejecuta automáticamente

---

## Test 6: Reintentos con Errores

### Objetivo
Verificar que el sistema reintenta operaciones fallidas.

### Pasos

1. **Simular error de backend** (opcional):
   - Detén el servidor backend temporalmente
   - O cambia la URL en `config.js` a una inválida

2. **Copiar items**:
   - Copia 1-2 textos

3. **Ejecutar sync manual**:
```javascript
await window.electronAPI.syncNow();
```

4. **Verificar logs de error**:
```
[SyncEngine] Failed to push operation: <error>
[SyncQueue] Scheduling retry #1 for item <id> in 2s
```

5. **Esperar reintentos automáticos**:
   - Observa los logs cada 2, 4, 8, 16, 32 segundos
   - Verás intentos progresivos

6. **Restaurar backend**:
   - Reinicia el servidor o corrige la URL

7. **Verificar sincronización exitosa**:
```
[SyncEngine] Pushed 2 operations
[SyncEngine] Sync cycle completed successfully
```

✅ **Resultado esperado**: Sistema reintenta automáticamente con backoff exponencial hasta que tiene éxito.

---

## Test 7: Sincronización Automática (Cada Hora)

### Objetivo
Verificar que la sincronización se ejecuta automáticamente.

### Pasos

**Opción A: Esperar 1 hora** (no recomendado para testing rápido)

**Opción B: Modificar intervalo temporalmente**

1. **Editar `backend/SyncEngine.ts`**:
```typescript
// Cambiar de 1 hora a 2 minutos para testing
this.syncInterval = setInterval(() => {
  this.performSync().catch(err => {
    console.error('[SyncEngine] Scheduled sync failed:', err);
  });
}, 120000); // 2 minutos = 120000 ms
```

2. **Recompilar**:
```bash
npm run build
```

3. **Reiniciar app**:
```bash
npm run dev
```

4. **Copiar items**:
   - Copia 2-3 textos

5. **Esperar 2 minutos**:
   - Observa los logs
   - Deberías ver sincronización automática

6. **Verificar logs**:
```
[SyncEngine] Starting sync cycle
[SyncEngine] Pushed 3 operations
[SyncEngine] Sync cycle completed successfully
```

✅ **Resultado esperado**: Sincronización se ejecuta automáticamente cada 2 minutos (o 1 hora en producción).

---

## Test 8: Múltiples Dispositivos (Avanzado)

### Objetivo
Probar sincronización entre 2 dispositivos.

### Requisitos
- 2 computadoras con la app instalada
- Ambas autenticadas con la misma cuenta
- Backend funcionando

### Pasos

**En Dispositivo A**:
1. Copiar texto: "Hola desde dispositivo A"
2. Ejecutar sync manual:
```javascript
await window.electronAPI.syncNow();
```
3. Verificar que se envió al backend

**En Dispositivo B**:
1. Ejecutar sync manual:
```javascript
await window.electronAPI.syncNow();
```
2. Verificar logs:
```
[SyncEngine] Received 1 remote items
[SyncEngine] Inserted new remote item <id>
```
3. Verificar en UI que aparece el texto de dispositivo A

**Probar conflicto**:
1. En ambos dispositivos, modificar el mismo item
2. Sincronizar ambos
3. Verificar logs de resolución de conflictos:
```
[ConflictResolver] Resolving conflict for item <id>
[ConflictResolver] Remote version wins (timestamp comparison)
```

✅ **Resultado esperado**: Items se sincronizan entre dispositivos y conflictos se resuelven automáticamente.

---

## Test 9: Persistencia de Cola

### Objetivo
Verificar que la cola sobrevive reinicios de la app.

### Pasos

1. **Desconectar internet**

2. **Copiar varios items**:
   - Copia 5-6 textos diferentes

3. **Verificar items pendientes**:
```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Pendientes:', stats.itemsPending); // Debería ser 5-6
```

4. **Cerrar la aplicación completamente**:
   - Quit/Exit de la app

5. **Reabrir la aplicación**:
```bash
npm run dev
```

6. **Verificar que los items siguen pendientes**:
```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Pendientes después de reinicio:', stats.itemsPending);
// Debería seguir siendo 5-6
```

7. **Reconectar internet**

8. **Ejecutar sync**:
```javascript
await window.electronAPI.syncNow();
```

9. **Verificar que se sincronizaron**:
```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Pendientes:', stats.itemsPending); // Debería ser 0
console.log('Sincronizados:', stats.itemsSynced); // Debería ser 5-6
```

✅ **Resultado esperado**: Cola persiste entre reinicios y se procesa correctamente al reconectar.

---

## Test 10: Verificación de Base de Datos

### Objetivo
Inspeccionar directamente la base de datos SQLite.

### Pasos

1. **Localizar la base de datos**:
   - Windows: `%APPDATA%/copyfy/copyfy-v2.sqlite`
   - macOS: `~/Library/Application Support/copyfy/copyfy-v2.sqlite`
   - Linux: `~/.config/copyfy/copyfy-v2.sqlite`

2. **Abrir con SQLite Browser** (o similar):
```bash
# Instalar si no lo tienes
# Windows: Descargar de https://sqlitebrowser.org/
# macOS: brew install --cask db-browser-for-sqlite
# Linux: sudo apt install sqlitebrowser

# Abrir
sqlitebrowser ~/Library/Application\ Support/copyfy/copyfy-v2.sqlite
```

3. **Verificar tabla SyncQueue**:
```sql
SELECT * FROM SyncQueue;
```

Deberías ver:
- `Id`: UUID de la operación
- `OperationType`: CREATE, UPDATE, o DELETE
- `ItemId`: ID del item
- `ItemData`: JSON del item
- `Timestamp`: Cuándo se creó
- `Retries`: Número de reintentos
- `NextRetryAt`: Cuándo reintentar (NULL si listo)

4. **Verificar items pendientes**:
```sql
SELECT * FROM ClipboardItem WHERE Pending = 1;
```

5. **Verificar índices**:
```sql
SELECT name FROM sqlite_master WHERE type='index';
```

Deberías ver:
- `idx_clipboard_device`
- `idx_clipboard_pending`
- `idx_syncqueue_retry`

✅ **Resultado esperado**: Tablas e índices existen correctamente, datos se persisten.

---

## Troubleshooting Común

### Problema: "syncNow is not a function"

**Causa**: preload.ts no se compiló o no se cargó.

**Solución**:
```bash
# Recompilar
npm run build

# Verificar que preload.js existe
ls preload.js

# Reiniciar app
npm run dev
```

### Problema: "SyncEngine is not defined"

**Causa**: SyncEngine.ts no se compiló.

**Solución**:
```bash
# Verificar compilación
npx tsc backend/SyncEngine.ts

# Verificar que existe
ls backend/SyncEngine.js

# Recompilar todo
npm run build
```

### Problema: No se ven logs de SyncEngine

**Causa**: SyncEngine no se inicializó en main.ts.

**Solución**:
1. Verificar que main.ts tiene:
```typescript
import { SyncEngine } from './backend/SyncEngine';
const syncEngine = SyncEngine.getInstance();
syncEngine.startScheduler();
```

2. Recompilar y reiniciar

### Problema: Items no se sincronizan

**Causa**: Backend no está corriendo o URL incorrecta.

**Solución**:
1. Verificar URL en `config.js`:
```javascript
BACKEND_URL: 'https://copyfy.webcolsoluciones.com.co'
```

2. Verificar que backend está corriendo:
```bash
curl https://copyfy.webcolsoluciones.com.co/health
```

3. Verificar autenticación:
```javascript
const settings = await window.electronAPI.getPreferences();
console.log('Token:', settings.accessToken);
```

### Problema: "Network status: OFFLINE" pero tengo internet

**Causa**: NetworkMonitor no puede alcanzar google.com.

**Solución**:
1. Verificar firewall/antivirus
2. Probar manualmente:
```bash
curl -I https://www.google.com
```
3. Editar `backend/NetworkMonitor.ts` para usar otra URL si es necesario

---

## Checklist de Testing Completo

Antes de considerar el sistema listo para producción:

- [ ] ✅ Test 1: Inicialización correcta
- [ ] ✅ Test 2: Items se encolan
- [ ] ✅ Test 3: Sincronización manual funciona
- [ ] ✅ Test 4: Listeners en tiempo real funcionan
- [ ] ✅ Test 5: Modo offline funciona
- [ ] ✅ Test 6: Reintentos funcionan
- [ ] ✅ Test 7: Sincronización automática funciona
- [ ] ✅ Test 8: Múltiples dispositivos funcionan
- [ ] ✅ Test 9: Cola persiste entre reinicios
- [ ] ✅ Test 10: Base de datos correcta

**Testing adicional recomendado**:
- [ ] Probar con 100+ items
- [ ] Probar con imágenes grandes
- [ ] Probar con conexión lenta
- [ ] Probar en Windows, macOS y Linux
- [ ] Probar con múltiples usuarios
- [ ] Probar cierre forzado de app
- [ ] Probar con disco lleno
- [ ] Probar con permisos limitados

---

## Scripts Útiles para Testing

### Script de Testing Rápido

Crea un archivo `test-sync.js` en la raíz:

```javascript
// test-sync.js
// Ejecutar en DevTools de la app

async function testSync() {
  console.log('🧪 Iniciando tests de sincronización...\n');
  
  // Test 1: Verificar APIs
  console.log('Test 1: Verificar APIs');
  console.log('✓ syncNow:', typeof window.electronAPI.syncNow);
  console.log('✓ getSyncStats:', typeof window.electronAPI.getSyncStats);
  
  // Test 2: Estadísticas iniciales
  console.log('\nTest 2: Estadísticas iniciales');
  const stats = await window.electronAPI.getSyncStats();
  console.log('✓ Stats:', stats);
  
  // Test 3: Sincronización manual
  console.log('\nTest 3: Sincronización manual');
  console.log('Ejecutando sync...');
  const result = await window.electronAPI.syncNow();
  console.log('✓ Resultado:', result);
  
  // Test 4: Estadísticas después
  console.log('\nTest 4: Estadísticas después');
  const statsAfter = await window.electronAPI.getSyncStats();
  console.log('✓ Stats después:', statsAfter);
  
  console.log('\n✅ Tests completados');
}

// Ejecutar
testSync();
```

### Script de Monitoreo Continuo

```javascript
// monitor-sync.js
// Ejecutar en DevTools para monitoreo continuo

let statsHistory = [];

window.electronAPI.onSyncStats((stats) => {
  statsHistory.push({
    timestamp: new Date().toLocaleTimeString(),
    ...stats
  });
  
  console.clear();
  console.log('📊 SYNC MONITOR');
  console.log('═══════════════════════════════════════');
  console.log('Último sync:', stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Nunca');
  console.log('Items sincronizados:', stats.itemsSynced);
  console.log('Items pendientes:', stats.itemsPending);
  console.log('Errores:', stats.errors);
  console.log('Estado:', stats.isRunning ? '🔄 SINCRONIZANDO' : '✅ IDLE');
  console.log('═══════════════════════════════════════');
  console.log('\nHistorial (últimos 5):');
  statsHistory.slice(-5).forEach(h => {
    console.log(`${h.timestamp}: ${h.itemsSynced} sync, ${h.itemsPending} pending`);
  });
});

window.electronAPI.onNetworkStatus((status) => {
  console.log('🌐 Red:', status.online ? 'ONLINE ✅' : 'OFFLINE ❌');
});

console.log('✅ Monitor iniciado. Copia items para ver actualizaciones.');
```

---

## Conclusión

Con esta guía puedes probar completamente el sistema de sincronización. Los tests más importantes para empezar son:

1. **Test 1-3**: Verificación básica (5 minutos)
2. **Test 4-5**: Monitoreo y offline (10 minutos)
3. **Test 9**: Persistencia (5 minutos)

Los demás tests son opcionales pero recomendados antes de producción.

**¡Buena suerte con el testing!** 🚀

---

**Preparado por**: Ingeniero Senior - Arquitectura Electron/React/Node.js  
**Fecha**: 27 de febrero de 2026  
**Versión**: 1.0
