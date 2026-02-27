---
inclusion: manual
---

# CopyFy++ - Build y Testing

## Comandos de Desarrollo

### Desarrollo
```bash
# Iniciar en modo desarrollo (frontend + electron)
npm run dev

# Solo frontend
npm run dev --prefix frontend

# Modo SQL (para debugging de base de datos)
npm run sql
```

### Build
```bash
# Build del frontend
npm run build

# Build completo y empaquetado
npm run dist
```

### Testing
```bash
# Tests del frontend
npm run test --prefix frontend

# Tests con coverage
npm run test --prefix frontend -- --coverage
```

## Estructura de Tests

- Tests unitarios en archivos `*.test.tsx` o `*.test.ts`
- Colocar tests junto a los componentes que prueban
- Usar React Testing Library para componentes
- Mockear IPC de Electron cuando sea necesario

## Electron Builder

### Targets por Plataforma
- **Windows**: NSIS installer
- **macOS**: DMG + ZIP
- **Linux**: AppImage + DEB

### Archivos Incluidos
- Frontend compilado (`frontend/dist`)
- Scripts principales (main.js, db.js, preload.js)
- Backend daemon
- Helpers nativos (paste.exe, paste-image.exe)
- sql-wasm.wasm (desempaquetado)

### Auto-actualización
- Configurado con electron-updater
- Publicación en GitHub Releases
- Verificar `dev-app-update.yml` para testing

## Debugging

### Electron Main Process
```bash
# Agregar en launch.json de VS Code
{
  "type": "node",
  "request": "launch",
  "name": "Electron Main",
  "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
  "program": "${workspaceFolder}/main.js"
}
```

### Frontend
- DevTools de Chrome disponibles en desarrollo
- React DevTools integrado
- Console logs visibles en DevTools

## Troubleshooting Común

### Error de compilación TypeScript
- Verificar `tsconfig.json` y `tsconfig.main.json`
- Ejecutar `tsc -b` para ver errores específicos

### Problemas con sql.js
- Asegurar que `sql-wasm.wasm` esté en `asarUnpack`
- Verificar rutas en `db.js`

### Helpers de Windows no funcionan
- Verificar que `paste.exe` y `paste-image.exe` estén desempaquetados
- Revisar permisos de ejecución
