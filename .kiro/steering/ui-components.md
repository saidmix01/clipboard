---
inclusion: fileMatch
fileMatchPattern: 'frontend/src/components/*.tsx'
---

# CopyFy++ - Componentes UI

## Componentes Principales

### AppShell
- Contenedor principal de la aplicación
- Maneja layout y navegación
- Gestiona estado global (tema, idioma)

### TopBar
- Barra superior con controles de ventana
- Búsqueda rápida
- Botones de acción (settings, about)

### Card
- Representa un item del historial
- Muestra preview según tipo (texto/imagen/código)
- Acciones: copiar, eliminar, favorito, detalles

### HistoryList
- Lista virtualizada de items
- Filtrado y ordenamiento
- Infinite scroll o paginación

### Modals
- `AboutModal`: Información de la app
- `SettingsMenu`: Configuración
- `DeleteModal`: Confirmación de eliminación
- `DetailsModal`: Vista detallada de item
- `OCRModal`: Extracción de texto de imagen
- `ScreenshotModal`: Captura y edición

## Patrones de Diseño

### Composición
```tsx
<Card>
  <Card.Header />
  <Card.Content />
  <Card.Actions />
</Card>
```

### Render Props
```tsx
<HistoryList
  items={items}
  renderItem={(item) => <Card item={item} />}
/>
```

### Custom Hooks
```tsx
// useClipboard.ts
export function useClipboard() {
  const [items, setItems] = useState([]);
  
  useEffect(() => {
    window.api.onClipboardUpdate((item) => {
      setItems(prev => [item, ...prev]);
    });
  }, []);
  
  return { items };
}
```

## Accesibilidad

- Usar elementos semánticos HTML
- Agregar `aria-label` a botones de iconos
- Navegación por teclado (Tab, Enter, Escape)
- Focus visible en elementos interactivos
- Contraste adecuado en modo claro/oscuro

## Animaciones

- Usar framer-motion para transiciones suaves
- Animaciones sutiles (fade, slide)
- Respetar `prefers-reduced-motion`
- No bloquear interacción durante animaciones

## Responsive (si aplica)

- Aunque es desktop app, considerar diferentes tamaños de ventana
- Breakpoints con Tailwind
- Ocultar elementos secundarios en ventanas pequeñas

## Temas

### Variables CSS
```css
:root {
  --bg-primary: #ffffff;
  --text-primary: #000000;
  --accent: #007bff;
}

[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --text-primary: #ffffff;
  --accent: #0d6efd;
}
```

### Aplicar Tema
```tsx
<div className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
  {/* content */}
</div>
```

## Optimización

- Lazy load de modales pesados
- Memoizar componentes que reciben props complejas
- Virtualizar listas largas
- Debounce en inputs de búsqueda
- Throttle en scroll handlers
