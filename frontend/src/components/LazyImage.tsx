import { useEffect, useRef, useState, memo } from 'react'

type LazyImageProps = {
  previewPath?: string
  originalPath?: string
  imagePath?: string
  alt?: string
  className?: string
  style?: React.CSSProperties
  onLoad?: () => void
  onError?: () => void
}

/**
 * Componente LazyImage con IntersectionObserver para lazy loading real.
 * 
 * - Carga la imagen solo cuando entra en viewport
 * - Libera memoria eliminando src cuando sale del viewport
 * - Usa previewPath si está disponible, sino imagePath/originalPath
 * - Limpia correctamente el IntersectionObserver al desmontar
 */
const LazyImage = memo(function LazyImage({
  previewPath,
  originalPath,
  imagePath,
  alt = 'imagen',
  className = '',
  style,
  onLoad,
  onError
}: LazyImageProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const [src, setSrc] = useState<string | null>(null)

  // Determinar la ruta de la imagen a usar (previewPath tiene prioridad)
  const imageFilePath = previewPath || imagePath || originalPath

  useEffect(() => {
    const imgElement = imgRef.current
    if (!imgElement || !imageFilePath) return

    // Crear IntersectionObserver
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Entró en viewport: cargar imagen
            // Convertir ruta de archivo a URL usando protocolo local-image://
            // que está registrado en Electron
            let fileUrl: string
            if (imageFilePath.startsWith('local-image://')) {
              fileUrl = imageFilePath
            } else if (imageFilePath.startsWith('file://')) {
              // Si viene con file://, convertir a local-image://
              fileUrl = imageFilePath.replace('file://', 'local-image://')
            } else {
              // Ruta absoluta normal, usar protocolo local-image://
              fileUrl = `local-image://${imageFilePath}`
            }
            setSrc(fileUrl)
          } else {
            // Salió del viewport: liberar memoria
            setSrc(null)
          }
        })
      },
      {
        // Opciones del observer: margen pequeño para precargar un poco antes
        rootMargin: '50px',
        threshold: 0.01
      }
    )

    // Observar el elemento
    observerRef.current.observe(imgElement)

    // Cleanup: desconectar observer al desmontar
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      // Asegurar que src se limpia
      setSrc(null)
    }
  }, [imageFilePath])

  // Manejar eventos de carga y error
  const handleLoad = () => {
    onLoad?.()
  }

  const handleError = () => {
    onError?.()
    // Si hay error, intentar con originalPath si es diferente
    if (previewPath && originalPath && src === `local-image://${previewPath}`) {
      setSrc(`local-image://${originalPath}`)
    }
  }

  return (
    <img
      ref={imgRef}
      src={src || undefined}
      alt={alt}
      className={className}
      style={style}
      onLoad={handleLoad}
      onError={handleError}
      // No usar loading="lazy" nativo ya que manejamos lazy loading con IntersectionObserver
      decoding="async"
    />
  )
})

export default LazyImage
