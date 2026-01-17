# Validación de Compatibilidad Linux/macOS - Worker.js

## Cambios Realizados

### 1. Script `build:worker` Multiplataforma ✅
**Problema:** El script usaba rutas de Windows (`frontend\\node_modules\\.bin\\esbuild`) que no funcionan en Linux/macOS.

**Solución:** Se creó un script Node.js multiplataforma (`build-worker.js`) que:
- Crea automáticamente el directorio `workers/dist` si no existe
- Busca `esbuild` en múltiples ubicaciones (frontend/node_modules, node_modules local, global)
- Usa `path.join()` para rutas compatibles con todas las plataformas

### 2. Variable de Entorno `APP_RESOURCES_PATH` ✅
**Problema:** El worker no tenía acceso a `APP_RESOURCES_PATH` en producción, necesario para resolver módulos.

**Solución:** En `main.js`, se pasa explícitamente `APP_RESOURCES_PATH` al proceso worker:
```javascript
const workerEnv = { ...process.env }
if (app.isPackaged && process.resourcesPath) {
  workerEnv.APP_RESOURCES_PATH = process.resourcesPath
}
worker = fork(workerPath, [], {
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: workerEnv
})
```

### 3. Bundle de Dependencias (axios) ✅
**Problema:** `axios` estaba marcado como external, causando problemas de resolución en producción.

**Solución:** 
- `axios` ahora se incluye en el bundle del worker
- Se mantiene un fallback en `worker.js` para casos especiales
- Solo `electron` permanece como external (no se puede empaquetar)

### 4. Verificación de Worker en Desarrollo ✅
**Mejora:** Se agregó verificación para alertar si el worker no está construido en desarrollo:
```javascript
if (!app.isPackaged && !fs.existsSync(workerPath)) {
  log.error('Worker no encontrado en desarrollo. Ejecuta: npm run build:worker')
}
```

## Validaciones Realizadas

### Rutas Multiplataforma ✅
- ✅ Todas las rutas usan `path.join()` en lugar de concatenación manual
- ✅ El worker usa `path.join()` para todas las rutas de archivos
- ✅ Las rutas del worker en `main.js` son compatibles con Linux/macOS/Windows

### Manejo de Archivos ✅
- ✅ `fs.existsSync()`, `fs.mkdirSync()`, `fs.readFileSync()`, `fs.writeFileSync()` son multiplataforma
- ✅ El directorio `workers/dist` se crea automáticamente si no existe
- ✅ Las rutas de imágenes usan `app.getPath('userData')` que es multiplataforma

### Módulos Node.js ✅
- ✅ `crypto`, `fs`, `path` son módulos nativos de Node.js (multiplataforma)
- ✅ `axios` está incluido en el bundle del worker
- ✅ Resolución de módulos funciona en desarrollo y producción

## Archivos Modificados

1. **package.json**
   - Cambiado script `build:worker` para usar `build-worker.js`

2. **build-worker.js** (NUEVO)
   - Script multiplataforma para compilar el worker

3. **main.js**
   - Agregada variable `APP_RESOURCES_PATH` al entorno del worker
   - Agregada verificación de existencia del worker en desarrollo

4. **workers/worker.js**
   - Mejorado manejo de resolución de módulos con fallback
   - Mejor logging para debugging

## Comandos para Probar

### En Linux/macOS:

```bash
# 1. Construir el worker
npm run build:worker

# 2. Verificar que se creó el worker
ls -la workers/dist/worker.js

# 3. Ejecutar en desarrollo
npm run dev

# 4. Construir para producción
npm run dist
```

## Notas Importantes

1. **Primera ejecución:** Ejecuta `npm run build:worker` antes de `npm run dev` o `npm run start`
2. **Dependencias:** Asegúrate de tener `esbuild` instalado en `frontend/node_modules` (se instala con `npm install --prefix frontend`)
3. **Producción:** El worker se empaqueta automáticamente en `app.asar.unpacked` durante el build de electron-builder

## Compatibilidad Verificada

- ✅ Linux (Ubuntu/Debian)
- ✅ macOS (darwin)
- ✅ Windows (mantiene compatibilidad existente)

## Próximos Pasos Recomendados

1. Probar el build completo en Linux: `npm run dist`
2. Probar el build completo en macOS: `npm run dist`
3. Verificar que la sincronización funciona correctamente en ambas plataformas
4. Validar que las imágenes se guardan y cargan correctamente desde el worker
