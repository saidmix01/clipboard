# CopyFy++ - Estándares del Proyecto

## Stack Tecnológico

- **Backend**: Electron (main process) + Node.js + TypeScript
- **Frontend**: React 19 + TypeScript + Vite
- **Estilos**: Tailwind CSS + Bootstrap 5
- **Base de datos**: SQLite (sql.js)
- **Testing**: Jest + Vitest + React Testing Library

## Estructura del Proyecto

```
copyfy/
├── main.ts              # Proceso principal de Electron
├── preload.ts           # Script de preload para IPC
├── db.js                # Gestión de base de datos SQLite
├── backend/             # Servicios backend (sincronización)
├── frontend/            # Aplicación React
│   ├── src/
│   │   ├── components/  # Componentes React
│   │   ├── api/         # Comunicación con backend
│   │   └── i18n/        # Internacionalización
└── viewer/              # Ventanas auxiliares (editor de código)
```

## Convenciones de Código

### TypeScript
- Usar tipos explícitos siempre que sea posible
- Evitar `any`, preferir `unknown` cuando sea necesario
- Definir interfaces para props de componentes
- Usar tipos para respuestas de API

### React
- Componentes funcionales con hooks
- Usar `React.FC` o definir props explícitamente
- Mantener componentes pequeños y reutilizables
- Extraer lógica compleja a custom hooks

### Electron
- Separar claramente main process y renderer process
- Usar contextBridge para exponer APIs al renderer
- Manejar IPC de forma segura con validación

### Estilos
- Preferir Tailwind CSS para estilos
- Usar clases de Bootstrap solo cuando sea necesario
- Mantener consistencia con el tema oscuro/claro

## Nomenclatura

- **Archivos**: PascalCase para componentes (`Card.tsx`), camelCase para utilidades
- **Componentes**: PascalCase (`AboutModal`, `TopBar`)
- **Funciones**: camelCase (`handleClick`, `fetchData`)
- **Constantes**: UPPER_SNAKE_CASE (`API_URL`, `MAX_ITEMS`)
- **Interfaces/Types**: PascalCase con prefijo `I` opcional (`IClipboardItem`)

## Gestión de Estado

- Estado local con `useState` para UI simple
- Context API para estado compartido (tema, idioma)
- Props drilling solo para 1-2 niveles

## Manejo de Errores

- Usar try-catch en operaciones asíncronas
- Mostrar notificaciones con react-hot-toast
- Loguear errores con electron-log en el main process

## Internacionalización

- Todos los textos visibles deben usar i18next
- Archivos de traducción en `frontend/src/i18n/`
- Soportar español e inglés

## Performance

- Lazy loading para imágenes grandes (`LazyImage` component)
- Virtualización para listas largas si es necesario
- Debounce en búsquedas y filtros
- Optimizar renders con `React.memo` cuando sea apropiado
