# Inicio Rápido - Testing de Sincronización

## 🚀 Pasos para Probar

### 1. Compilar el Proyecto
```bash
# Compilar TypeScript
npx tsc -p tsconfig.main.json

# Compilar frontend (si es necesario)
cd frontend
npm run build
cd ..
```

### 2. Iniciar la Aplicación
```bash
npm run dev
```

### 3. Verificar Logs Iniciales

Deberías ver en la terminal:
```
[Main] Backend Daemon Initialized
[SyncEngine] Starting hourly sync scheduler
[SyncEngine] Starting sync cycle
[NetworkMonitor] Starting network monitoring
```

Si ves estos logs, ✅ el sistema está funcionando.

### 4. Abrir DevTools

En la aplicación:
- Windows/Linux: `Ctrl + Shift + I`
- macOS: `Cmd + Option + I`

### 5. Verificar API en DevTools

Ejecuta en la consola:
```javascript
// Verificar que la API existe
console.log('API disponible:', {
  syncNow: typeof window.electronAPI?.syncNow,
  getSyncStats: typeof window.electronAPI?.getSyncStats,
  onSyncStats: typeof window.electronAPI?.onSyncStats
});

// Debe mostrar:
// { syncNow: "function", getSyncStats: "function", onSyncStats: "function" }
```

### 6. Obtener Estadísticas

```javascript
const stats = await window.electronAPI.getSyncStats();
console.log('Estadísticas:', stats);

// Debe mostrar algo como:
// {
//   lastSyncAt: null,
//   itemsSynced: 0,
//   itemsPending: 0,
//   errors: 0,
//   isRunning: false
// }
```

### 7. Probar Sincronización Manual

```javascript
console.log('🔄 Iniciando sincronización...');
try {
  const result = await window.electronAPI.syncNow();
  console.log('✅ Resultado:', result);
} catch (e) {
  console.error('❌ Error:', e);
}
```

### 8. Observar Logs en Terminal

Durante la sincronización deberías ver:
```
[SyncEngine] Starting sync cycle
[SyncEngine] Phase 1: Pushing local changes...
[SyncEngine] Pushed 0 operations
[SyncEngine] Phase 2: Pulling remote changes...
[SyncEngine] Received 0 remote items
[SyncEngine] Phase 3: Resolving conflicts...
[SyncEngine] Resolved 0 conflicts
[SyncEngine] Sync cycle completed successfully
```

## 🔍 Diagnóstico de Problemas

### Problema: "API de sincronización no disponible"

**Causa**: Los archivos TypeScript no se compilaron.

**Solución**:
```bash
npx tsc -p tsconfig.main.json
ls backend/*.js  # Verificar que existen los archivos
```

### Problema: "Sync timeout"

**Causa**: La sincronización tarda más de 30 segundos.

**Posibles razones**:
1. Backend no responde
2. Sin conexión a internet
3. No autenticado

**Verificar**:
```javascript
// En DevTools
const prefs = await window.electronAPI.getPreferences();
console.log('Autenticado:', !!prefs.accessToken);
```

### Problema: "Offline, skipping sync"

**Causa**: NetworkMonitor detectó que no hay conexión.

**Solución**:
1. Verificar conexión a internet
2. Esperar ~30 segundos para que detecte reconexión
3. Verificar logs: `[NetworkMonitor] Network status changed: ONLINE`

### Problema: "Not authenticated, skipping sync"

**Causa**: No hay token de acceso guardado.

**Solución**:
1. Iniciar sesión en la aplicación
2. Verificar que el token se guardó:
```javascript
const prefs = await window.electronAPI.getPreferences();
console.log('Token:', prefs.accessToken ? 'Existe ✅' : 'No existe ❌');
```

## 🎯 Testing del Botón UI

### 1. Abrir Configuración
- Clic en el icono de configuración (⚙️)

### 2. Verificar Botón
Deberías ver:
- 🔵 Icono de nube con flecha
- 📝 Texto: "Sincronizar ahora"
- 🕐 Subtexto: "Nunca sincronizado" (primera vez)

### 3. Hacer Clic en el Botón
Al hacer clic:
- Texto cambia a "Sincronizando..."
- Icono se anima (bounce)
- Botón se deshabilita
- Toast notification aparece

### 4. Esperar Resultado
Después de 2-30 segundos:
- ✅ Toast "Sincronización completada"
- Subtexto actualizado con fecha
- Botón vuelve a estado normal

O si hay error:
- ❌ Toast con mensaje de error
- Botón vuelve a estado normal

## 📊 Monitoreo en Tiempo Real

Para ver actualizaciones en vivo:

```javascript
// En DevTools
window.electronAPI.onSyncStats((stats) => {
  console.log('📊 Stats Update:', {
    ultimoSync: stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Nunca',
    sincronizados: stats.itemsSynced,
    pendientes: stats.itemsPending,
    errores: stats.errors,
    ejecutando: stats.isRunning ? '🔄 SÍ' : '✅ NO'
  });
});

console.log('✅ Listener configurado. Copia items para ver actualizaciones.');
```

## 🧪 Test Completo

```javascript
// Script de test completo
async function testSync() {
  console.log('🧪 Iniciando test de sincronización\n');
  
  // 1. Verificar API
  console.log('1️⃣ Verificando API...');
  if (!window.electronAPI?.syncNow) {
    console.error('❌ API no disponible');
    return;
  }
  console.log('✅ API disponible\n');
  
  // 2. Obtener stats iniciales
  console.log('2️⃣ Obteniendo estadísticas iniciales...');
  const statsInicial = await window.electronAPI.getSyncStats();
  console.log('✅ Stats:', statsInicial, '\n');
  
  // 3. Ejecutar sync
  console.log('3️⃣ Ejecutando sincronización...');
  const inicio = Date.now();
  try {
    const resultado = await window.electronAPI.syncNow();
    const duracion = Date.now() - inicio;
    console.log(`✅ Completado en ${duracion}ms`);
    console.log('Resultado:', resultado, '\n');
  } catch (e) {
    console.error('❌ Error:', e, '\n');
  }
  
  // 4. Verificar stats finales
  console.log('4️⃣ Verificando estadísticas finales...');
  const statsFinal = await window.electronAPI.getSyncStats();
  console.log('✅ Stats:', statsFinal, '\n');
  
  console.log('🎉 Test completado');
}

// Ejecutar
testSync();
```

## 📝 Notas Importantes

1. **Primera sincronización**: Puede tardar más si hay muchos items pendientes.

2. **Sin backend**: Si el backend no está disponible, la sincronización fallará. Esto es normal en desarrollo.

3. **Modo offline**: Si no hay internet, la sincronización se salta automáticamente.

4. **Timeout**: El botón tiene un timeout de 30 segundos. Si tarda más, mostrará error.

5. **Logs**: Siempre revisa los logs de la terminal para ver qué está pasando.

## ✅ Checklist Final

Antes de reportar un problema, verifica:

- [ ] Compilaste el proyecto: `npx tsc -p tsconfig.main.json`
- [ ] Los archivos .js existen en `backend/`
- [ ] La app se inició sin errores
- [ ] Viste los logs de inicialización en terminal
- [ ] La API está disponible en DevTools
- [ ] Revisaste los logs durante la sincronización
- [ ] Verificaste estado de autenticación
- [ ] Verificaste conexión a internet

---

**¿Necesitas ayuda?** Proporciona:
1. Logs completos de la terminal
2. Logs de DevTools
3. Resultado del test completo
4. Sistema operativo

**Última actualización**: 27 de febrero de 2026
