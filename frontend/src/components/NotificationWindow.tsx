import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'

export default function NotificationWindow() {
  const [image, setImage] = useState<string | null>(null)
  const [file, setFile] = useState<{name: string, path: string} | null>(null)
  const [timeLeft, setTimeLeft] = useState(5)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Notify main process we are ready
    (window as any).electronAPI?.signalNotificationReady?.()

    // Listen for image
    const offImg = (window as any).electronAPI?.onNotificationLoadImage?.((img: string) => {
      console.log("Image received in notification window")
      setImage(img)
      setFile(null)
      setError(null)
      setLoading(false)
      setTimeLeft(5)
    })

    // Listen for file
    const offFile = (window as any).electronAPI?.onNotificationLoadFile?.((f: any) => {
        console.log("File received in notification window", f)
        setFile(f)
        setImage(null)
        setError(null)
        setLoading(false)
        setTimeLeft(5)
    })

    const offError = (window as any).electronAPI?.onNotificationError?.((err: string) => {
        console.log("Error received:", err)
        setError(err)
        setLoading(false)
    })

    return () => { 
        try { offImg?.() } catch {} 
        try { offFile?.() } catch {}
        try { offError?.() } catch {}
    }
  }, [])

  useEffect(() => {
    if ((!image && !file) || loading || error) return
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          handleCancel()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [image, file, loading, error])

  const handleSave = () => {
    if (file) {
      setLoading(true)
    }
    (window as any).electronAPI?.sendNotificationAction?.('save')
  }

  const handleCancel = () => {
    (window as any).electronAPI?.sendNotificationAction?.('cancel')
  }

  if (!image && !file && !error) return (
    <div className="h-screen w-screen bg-transparent flex items-center justify-center">
       {/* Transparent placeholder or loading */}
    </div>
  )

  return (
    <div className="h-screen w-screen bg-[#1e1e1e] text-white overflow-hidden flex flex-col border border-gray-600 rounded-lg shadow-2xl relative select-none">
       {/* Progress Bar */}
       {!loading && !error && (
       <div className="h-1 bg-gray-700 w-full absolute top-0 left-0 z-10">
          <motion.div 
            className="h-full bg-blue-500"
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: 5, ease: 'linear' }}
          />
       </div>
       )}

       <div className="flex-1 p-3 flex flex-col items-center justify-center gap-2 drag-handle">
          <h2 className="text-sm font-semibold text-gray-300 text-center px-2 w-full truncate">
              {error ? error : (loading ? 'Subiendo...' : (file ? `Documento: ${file.name}` : 'Nueva imagen detectada'))}
          </h2>
          
          <div className="flex gap-2 w-full mt-auto">
            <button 
              onClick={handleCancel}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1.5 px-3 rounded text-sm flex items-center justify-center gap-1 transition-colors no-drag"
            >
              <XMarkIcon className="w-4 h-4" />
              {error ? 'Cerrar' : `Cancelar (${timeLeft}s)`}
            </button>
            {!error && !loading && (
            <button 
              onClick={handleSave}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1.5 px-3 rounded text-sm flex items-center justify-center gap-1 transition-colors font-medium no-drag"
            >
              <CheckIcon className="w-4 h-4" />
              {file ? 'Subir' : 'Guardar'}
            </button>
            )}
          </div>
       </div>
    </div>
  )
}
