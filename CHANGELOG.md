# Changelog

Todos los cambios notables en este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.6] - 2026-04-07

### Fixed
- **Registro de usuarios**: Corregido error donde el frontend siempre enviaba peticiones a `/auth/login` incluso en modo registro, causando el error "invalid credentials" al crear nuevas cuentas.
  - Ahora diferencia correctamente entre:
    - **Login**: `POST /auth/login` (email, password)
    - **Registro**: `POST /auth/register` (name, email, password)

## [1.2.5] - 2026-04-06

### Added
- **Sistema de compartir en tiempo real**: Implementación completa de WebSocket para compartir items del portapapeles entre usuarios
  - Backend: Socket.io namespace `/sharing`, tabla `shared_items`, eventos personalizados
  - Frontend: Componentes `SharingManager`, `ShareItemModal`, `SharingNotification`
  - Funcionalidades: Enviar, recibir, aceptar y rechazar items compartidos

### Fixed
- **Card hover en tema claro**: Corregido color de hover que se volvía negro en lugar de gris
- **Vulnerabilidad de axios**: Actualizado de versión 1.10.0 a 1.14.0 (evitando versión comprometida 1.14.1)

### Changed
- **Documentación backend**: README.md completamente reescrito con documentación completa
- **Compatibilidad frontend-backend**: Análisis y plan de fixes para endpoints faltantes

## [1.2.0] - 2026-04-05

### Added
- **Sincronización multi-dispositivo**: Funcionalidad básica de sincronización
- **Sistema de favoritos**: Marcado y sincronización de items favoritos
- **Internacionalización**: Soporte para español e inglés

### Changed
- **Arquitectura de base de datos**: Mejoras en modelos y relaciones
- **Sistema de autenticación**: JWT tokens con refresh tokens

## [1.0.0] - 2026-03-15

### Added
- **Lanzamiento inicial**: Aplicación de portapapeles multiplataforma
- **Funcionalidades básicas**:
  - Copiar y pegar texto/imágenes
  - Historial de portapapeles
  - Búsqueda y filtrado
  - Interfaz de usuario moderna
  - Soporte para Windows, macOS y Linux