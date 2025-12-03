# Rediseño UI macOS — Copyfy++

## Design Tokens
- Colors: `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-muted`, `--color-primary`, `--color-secondary`, `--color-accent`
- Radii: `--radius-card` (14px), `--radius-modal` (16px)
- Shadows: `--shadow-soft`, `--shadow-hover`
- Dark mode: alterna con `data-theme="dark"` sobre `html`

## Estética y UX
- Vibrancy/Blur: clases `glass` con `backdrop-filter: saturate(1.8) blur(12px)`
- Tipografía: system-ui stack
- Transiciones: framer-motion con easing `cubic-bezier(.22,.9,.38,1)`

## Componentes
- AppShell, TopBar, Dock, HistoryList, Card, DetailsModal, SidebarFilters, SearchQuickSwitcher
- Storybook: historias para `Card` y `TopBar`

## Atajos y navegación
- Flechas Arriba/Abajo: navegar entre tarjetas
- Enter: copiar/pegar item seleccionado
- Esc: cerrar ventana u overlays
- Ctrl/Cmd+K: abrir Quick Switcher

## Accesibilidad
- Contraste: tokens con énfasis en legibilidad (WCAG AA)
- Roles ARIA: añadir según se extienda (modal, botones, listas)

## Testing
- Unit: Jest + RTL (Card)
- E2E: pendiente integrar Playwright/Cypress con escenarios: copiar, favorito, búsqueda + detalle

## Rendimiento
- Lazy-load imágenes en `Card` (se puede extender)
- Debounce búsqueda (pendiente: hook de debounce)
- Virtualización: evaluar react-window si el historial crece

## IPC y Data
- Mantiene `electronAPI` existente y formato `{ value: string, favorite: boolean }`
- Dedupe y favoritos se conservan desde main.js

## Checklist
- Modo claro/oscuro fiel a macOS
- Navegación teclado y accesibilidad básica
- Favoritos filtrables y visibles en sección
- Historial con texto/imágenes/código
- Performance razonable en dev (optimizable con lazy/virtualización)
- Storybook y guía de estilos incluidas
