# Diagnóstico - Problema de Sincronización

## Problema Reportado
El botón de sincronización se queda en "Syncing..." y no completa.

## Causas Posibles

### 1. Backend no disponible
**Síntoma**: La sincronización intenta conectar pero el servidor no responde.

**Verificar**:
```javascript
// En DevTools de la app
const config = await window.electronAPI.getPreferences();
console.log('Backend URL:', config);
```

**Solución**:
- Verificar que el backend esté corriendo
- Verificar la URL en `config.js`
- Probar manualmente: `curl https://copyfy.webcolsoluciones.com.co/health`

### 2. No autenticado
**Síntoma**: La sincronización se salta porque no hay token de acceso.

**Verificar**:
```javascript
// En DevTools
const prefs = await window.electronAPI.getPreferences();
console.log('Token:', prefs.accessToken ? 'Existe' : 'No existe');
```

**Solución**:
- Iniciar sesión en la aplicación
- Verificar que el token se guardó correctamente

### 3. Sin conexión a internet
**Síntoma**: NetworkMonitor detecta offline.

**Verificar logs en terminal**:
```
[NetworkMonitor] Network status changed: OFFLINE
[SyncEngine] Offline, skipping sync
```

**Solución**:
- Verificar conexión a internet
- Esperar ~30 segundos para que NetworkMonitor detecte reconexión

### 4. Error en SyncEngine
**Síntoma**: Excepción no capturada en el código.

**Verificar logs en terminal**:
```
[SyncEngine] Error: ...
```

**Solución**:
- Revisar logs completos
- Verificar que db.js tiene todas las funciones necesarias

## Solución Rápida

### Paso 1: Verificar compilación
```bash
# Recompilar todo
npx tsc -p tsconfig.main.json

# Verificar que existen los archivos
ls backend/*.js
# Debe mostrar: SyncEngine.js, SyncQueue.js, ConflictResolver.js, NetworkMonitor.js
```

### Paso 2: Verificar logs
```bash
# Reiniciar la app y ver logs
npm run dev

# Buscar estos mensajes:
# [SyncEngine] Starting hourly sync scheduler
# [NetworkMonitor] Starting network monitoring
```

### Paso 3: Probar sincronización con timeout
El botón ahora tiene un timeout de 30 segundos. Si no responde en ese tiempo, mostrará error.

### Paso 4: Verificar en DevTools
```javascript
// Abrir DevTools (Ctrl+Shift+I)

// 1. Verificar que la API existe
console.log('syncNow:', typeof window.electronAPI.syncNow);
// Debe mostrar: "function"

// 2. Verificar estadísticas
const stats = await window.electronAPI.getSyncStats();
console.log('Stats:', stats);
// Debe mostrar objeto con: lastSyncAt, itemsSynced, etc.

// 3. Probar sincronización con logs
console.log('Iniciando sync...');
try {
  const result = await window.electronAPI.syncNow();
  console.log('Resultado:', result);
} catch (e) {
  console.error('Error:', e);
}
```

## Modo de Prueba Sin Backend

Si quieres probar la UI sin backend real, puedes modificar temporalmente `backend/SyncEngine.ts`:

```typescript
// En performSync(), agregar al inicio:
private async performSync(): Promise<SyncStats> {
  // MODO DE PRUEBA - Comentar para producción
  console.log('[SyncEngine] MODO DE PRUEBA - Simulando sync');
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 segundos
  this.stats.lastSyncAt = Date.now();
  this.stats.itemsSynced += 5;
  this.stats.itemsPending = 0;
  this.broadcastStats();
  return this.stats;
  // FIN MODO DE PRUEBA
  
  // ... resto del código original
}
```

Luego recompilar:
```bash
npx tsc -p tsconfig.main.json
npm run dev
```

## Checklist de Verificación

- [ ] ✅ Archivos compilados existen (backend/*.js)
- [ ] ✅ main.js importa SyncEngine
- [ ] ✅ Logs muestran "SyncEngine Initialized"
- [ ] ✅ window.electronAPI.syncNow existe
- [ ] ✅ Backend está corriendo (o modo prueba activado)
- [ ] ✅ Usuario está autenticado (o se salta verificación)
- [ ] ✅ Hay conexión a internet (o se salta verificación)

## Logs Esperados (Sincronización Exitosa)

```
[SyncEngine] Starting sync cycle
[SyncEngine] Pushing local changes...
[SyncEngine] Pushed 0 operations
[SyncEngine] Pulling remote changes...
[SyncEngine] Received 0 remote items
[SyncEngine] Resolving conflicts...
[SyncEngine] Resolved 0 conflicts
[SyncEngine] Sync cycle completed successfully
```

## Logs de Error Comunes

### Error 1: "Offline, skipping sync"
```
[SyncEngine] Offline, skipping sync
```
**Solución**: Verificar conexión a internet, esperar reconexión.

### Error 2: "Not authenticated, skipping sync"
```
[SyncEngine] Not authenticated, skipping sync
```
**Solución**: Iniciar sesión en la aplicación.

### Error 3: "Sync already in progress"
```
[SyncEngine] Sync already in progress, skipping
```
**Solución**: Esperar a que termine la sincronización actual.

### Error 4: Network timeout
```
[SyncEngine] Failed to pull remote changes: timeout
```
**Solución**: Verificar que el backend responde, aumentar timeout si es necesario.

## Contacto

Si el problema persiste después de seguir estos pasos, proporciona:
1. Logs completos de la terminal
2. Logs de DevTools (consola)
3. Versión del sistema operativo
4. Estado de autenticación (con/sin sesión)
5. Estado de red (online/offline)

---

**Última actualización**: 27 de febrero de 2026
