---
inclusion: fileMatch
fileMatchPattern: '{main.ts,preload.ts,frontend/src/api/backend.ts}'
---

# CopyFy++ - Comunicación IPC Electron

## Arquitectura IPC

### Main Process (main.ts)
- Maneja la lógica de negocio
- Acceso a sistema de archivos y APIs nativas
- Gestión de ventanas y menús
- Interacción con base de datos

### Preload Script (preload.ts)
- Expone APIs seguras al renderer via contextBridge
- Valida y sanitiza datos entre procesos
- No debe exponer módulos completos de Node.js

### Renderer Process (frontend)
- Interfaz de usuario React
- Llama a APIs expuestas por preload
- No tiene acceso directo a Node.js

## Patrón de Comunicación

### Desde Renderer a Main
```typescript
// preload.ts
contextBridge.exposeInMainWorld('api', {
  saveClipboard: (data: ClipboardData) => ipcRenderer.invoke('save-clipboard', data),
  getHistory: () => ipcRenderer.invoke('get-history')
});

// main.ts
ipcMain.handle('save-clipboard', async (event, data) => {
  // Validar data
  // Procesar y guardar
  return result;
});

// frontend/src/api/backend.ts
const result = await window.api.saveClipboard(data);
```

### Desde Main a Renderer
```typescript
// main.ts
mainWindow.webContents.send('clipboard-updated', newItem);

// preload.ts
contextBridge.exposeInMainWorld('api', {
  onClipboardUpdate: (callback: (item: ClipboardItem) => void) => {
    ipcRenderer.on('clipboard-updated', (_, item) => callback(item));
  }
});

// frontend component
useEffect(() => {
  window.api.onClipboardUpdate((item) => {
    // Actualizar UI
  });
}, []);
```

## Seguridad

- Nunca exponer `ipcRenderer` directamente
- Validar todos los datos recibidos en main process
- Usar `invoke/handle` para operaciones asíncronas
- Usar `send/on` solo para notificaciones unidireccionales
- Sanitizar paths y comandos del sistema

## APIs Comunes en CopyFy++

- `save-clipboard`: Guardar item en historial
- `get-history`: Obtener historial completo
- `delete-item`: Eliminar item específico
- `search`: Buscar en historial
- `translate`: Traducir texto
- `ocr`: Extraer texto de imagen
- `sync-*`: Operaciones de sincronización
