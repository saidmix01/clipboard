# 📋 CopyFy++ - Gestor Avanzado de Portapapeles

**CopyFy++** es un gestor de portapapeles inteligente y moderno para escritorio, desarrollado con **Electron + React + Vite + TypeScript**. Ofrece sincronización en la nube, historial persistente, búsqueda avanzada y múltiples herramientas de productividad. Ideal para desarrolladores, creadores de contenido y usuarios profesionales.

**Estado del Proyecto**: ✅ **Producción Estable** - Versión 1.2.5
**Sitio Web**: [https://copyfy.lat](https://copyfy.lat)
**Backend**: Configurable (ver sección de configuración)

---

## 🚀 Características Principales

### 📋 **Gestión de Portapapeles**
- ✅ **Historial completo** de texto e imágenes
- 🔍 **Búsqueda inteligente** con filtros por tipo (texto/imagen/favoritos)
- ⭐ **Marcar como favoritos** para acceso rápido
- 🗑️ **Eliminación selectiva** o en lote

### ☁️ **Sincronización en la Nube**
- 🔄 **Sincronización automática** cada hora
- 📱 **Multi-dispositivo** - Accede a tu portapapeles desde cualquier lugar
- 🔒 **Resolución de conflictos** inteligente (Last-Write-Wins)
- 📶 **Tolerante a fallos** - Reintentos automáticos con backoff exponencial

### 🛠️ **Herramientas de Productividad**
- 🌐 **Traducción instantánea** al inglés
- 🧠 **Resaltado de sintaxis** para código (Highlight.js)
- 📝 **Editor de código integrado**
- 🔎 **Visor de imágenes** con zoom y navegación
- 💾 **Exportación de datos** en múltiples formatos

### 🎨 **Interfaz y Experiencia de Usuario**
- 🌙 **Modo oscuro/claro** automático
- 🖱️ **Ventana arrastrable** sin bordes
- ⚡ **Interfaz minimalista** y responsive
- 🔔 **Notificaciones del sistema**
- 🎯 **Atajos de teclado** configurables

### 🔧 **Características Técnicas**
- 🏗️ **Arquitectura modular** con separación clara de responsabilidades
- 📊 **Base de datos SQLite** local para rendimiento óptimo
- 🔄 **Sistema de colas persistente** para operaciones de sincronización
- 🌐 **Monitoreo de red** automático (cada 30 segundos)
- 🛡️ **Manejo robusto de errores** y recovery automático

---

## 🏗️ Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Electron)               │
│                                                           │
│  Clipboard Watcher ──▶ BackendDaemon ──▶ SyncEngine     │
│         │                     │               │          │
│         │                     │               ├─ SyncQueue
│         │                     │               ├─ ConflictResolver
│         │                     │               └─ NetworkMonitor
│         │                     │                           │
│         └─────────────────────┴───────▶ db.js (SQLite)   │
│                                                           │
└─────────────────────────────────────────────────────────┘
         │                                          ▲
         │ IPC                                      │ IPC Events
         ▼                                          │
┌─────────────────────────────────────────────────────────┐
│               RENDERER PROCESS (React)                  │
│                                                           │
│  React Components ◀──▶ preload.ts ◀──▶ electronAPI     │
│         │                                          │      │
│         └──────────────────────────────────────────┴──────┘
└─────────────────────────────────────────────────────────┘
```

---

## 🛠️ Stack Tecnológico

### **Frontend**
- ⚛️ **React 18** - Biblioteca de UI
- 📘 **TypeScript** - Tipado estático
- ⚡ **Vite** - Build tool ultra rápido
- 🎨 **Bootstrap 5** - Framework CSS
- 🌐 **i18next** - Internacionalización

### **Backend (Electron Main Process)**
- ⚡ **Electron 28** - Framework de escritorio
- 🗄️ **SQLite** (sql.js) - Base de datos embebida
- 🔄 **Axios** - Cliente HTTP
- 📝 **Electron-log** - Sistema de logging

### **Sincronización**
- 🔄 **SyncEngine** - Motor de sincronización personalizado
- 📋 **SyncQueue** - Cola persistente de operaciones
- ⚖️ **ConflictResolver** - Resolución de conflictos
- 🌐 **NetworkMonitor** - Monitoreo de conectividad

### **Build & Deployment**
- 🏗️ **Electron Builder** - Empaquetado multiplataforma
- 🔄 **Electron Updater** - Actualizaciones automáticas
- 🐳 **Multiplataforma** - Windows, macOS, Linux

---

## 📦 Instalación y Desarrollo

### **Requisitos Previos**
- Node.js 18+ y npm
- Git

### **Clonar y Configurar**
```bash
# Clonar el repositorio
git clone https://github.com/saidmix01/clipboard.git
cd clipboard

# Instalar dependencias principales
npm install

# Instalar dependencias del frontend
cd frontend
npm install
cd ..
```

### **Modos de Ejecución**

#### **Modo Desarrollo**
```bash
# Inicia el servidor de desarrollo (hot reload)
npm run dev
```

#### **Modo Producción**
```bash
# Compilar TypeScript
npx tsc -p tsconfig.main.json

# Compilar frontend
cd frontend
npm run build
cd ..

# Iniciar aplicación
npm start
```

#### **Modo SQL (Para debugging)**
```bash
# Abre la aplicación con herramientas de base de datos
npm run sql
```

### **Empaquetado para Distribución**
```bash
# Construir para la plataforma actual
electron-builder

# Construir para todas las plataformas
electron-builder --win --mac --linux

# Construir específicamente para Windows
electron-builder --win
```

---

## 📱 Plataformas Soportadas

### **Windows**
- ✅ Windows 10/11 (x64)
- 📦 Instalador NSIS
- 🔄 Actualizaciones automáticas

### **macOS**
- ✅ macOS 11+ (Intel & Apple Silicon)
- 🍎 Code signing compatible
- 🛡️ Hardened Runtime habilitado

### **Linux**
- ✅ Distribuciones basadas en Debian/Ubuntu
- 📦 AppImage y DEB packages
- 🐧 Dependencias: xclip, libnotify-bin

---

## 🔧 Configuración y Personalización

### **Configuración del Backend**
```javascript
// config.js
module.exports = {
  BACKEND_URL: 'https://tu-backend.com'  // URL de producción
  // BACKEND_URL: 'http://localhost:3000' // Desarrollo local
}
```

**Nota de seguridad**: Para entornos de producción, configura la URL del backend en el archivo `config.js`. No expongas URLs internas en documentación pública.

### **Variables de Entorno**
```bash
# Para desarrollo local
BACKEND_URL=http://localhost:3000
```

### **Auto-inicio**
La aplicación puede configurarse para iniciar automáticamente con el sistema operativo a través de `autolaunch.js`.

---

## 📊 Sistema de Sincronización

### **Características Clave**
- ⏰ **Scheduler automático** - Sincroniza cada hora
- 🔄 **Bidireccional** - Push y pull de datos
- 🛡️ **Tolerante a fallos** - Máximo 5 reintentos
- ⏳ **Backoff exponencial** - 2^n segundos (máx 60s)
- 🧹 **Cleanup automático** - Operaciones >7 días eliminadas

### **Estados de Sincronización**
```typescript
type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';
```

### **API de Sincronización**
```javascript
// Sincronización manual
electronAPI.syncNow();

// Obtener estadísticas
electronAPI.getSyncStats();

// Escuchar eventos
electronAPI.onSyncStats((stats) => {
  console.log('Estadísticas:', stats);
});
```

---

## 🧪 Testing y Calidad

### **Pruebas Implementadas**
- ✅ **Pruebas de sincronización** - Verificación de flujos completos
- ✅ **Pruebas de base de datos** - Operaciones CRUD
- ✅ **Pruebas de red** - Conectividad y manejo de errores
- ✅ **Pruebas de UI** - Componentes React

### **Documentación de Testing**
Consulte `GUIA_TESTING_SYNC.md` para guías detalladas de testing.

---

## 📚 Documentación Adicional

### **Documentación Técnica**
1. 📖 `ARQUITECTURA_SINCRONIZACION.md` - Arquitectura detallada del sistema
2. 🔍 `AUDITORIA_SINCRONIZACION.md` - Auditoría técnica completa
3. 🛠️ `IMPLEMENTACION_SINCRONIZACION.md` - Guía de implementación
4. 📊 `RESUMEN_EJECUTIVO.md` - Resumen ejecutivo del proyecto

### **Guías de Usuario**
1. 🚀 `INICIO_RAPIDO.md` - Comenzar en 5 minutos
2. 💻 `how_compile.md` - Guía de compilación
3. 🐧 `VALIDACION_LINUX_MACOS.md` - Validación multiplataforma

---

## 🤝 Contribución

### **Reportar Issues**
1. Verificar que el issue no haya sido reportado
2. Usar la plantilla de issue apropiada
3. Incluir pasos para reproducir y logs relevantes

### **Enviar Pull Requests**
1. Fork el repositorio
2. Crear una rama descriptiva (`feature/nueva-funcionalidad`)
3. Incluir tests relevantes
4. Actualizar documentación
5. Seguir las convenciones de código existentes

### **Convenciones de Código**
- TypeScript con tipado estricto
- Componentes React funcionales con hooks
- Separación clara entre lógica y presentación
- Comentarios en inglés para código, español para documentación

---

## 📄 Licencia

Este proyecto está licenciado bajo la **GNU General Public License v3.0**.

```
CopyFy++ - Gestor Avanzado de Portapapeles
Copyright (C) 2025-2026 Said Andres Avendaño

Este programa es software libre: puedes redistribuirlo y/o modificarlo
bajo los términos de la GNU General Public License publicada por
la Free Software Foundation, ya sea la versión 3 de la Licencia, o
(a tu elección) cualquier versión posterior.
```

Consulte el archivo `LICENSE` para los términos completos.

---

## 👨‍💻 Autor

**Said Andres Avendaño**
- 📧 Email: saidandresmix01@gmail.com
- 🌐 GitHub: [saidmix01](https://github.com/saidmix01)
- 🔗 LinkedIn: [Said Avendaño](https://linkedin.com/in/said-avendaño)

---

## 🙏 Agradecimientos

- **Electron** comunidad por el increíble framework
- **React** equipo por la biblioteca de UI
- **Vite** por el build tool ultra rápido
- Todos los **contribuidores** y **testers** del proyecto

---

**⭐ Si este proyecto te es útil, considera darle una estrella en GitHub!**

