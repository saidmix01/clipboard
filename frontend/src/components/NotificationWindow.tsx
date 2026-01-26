import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'

export default function NotificationWindow() {
  const [image, setImage] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(30)

  useEffect(() => {
    // Notify main process we are ready
    (window as any).electronAPI?.signalNotificationReady?.()

    // Listen for image
    const off = (window as any).electronAPI?.onNotificationLoadImage?.((img: string) => {
      console.log("Image received in notification window")
      setImage(img)
      setTimeLeft(30)
    })
    return () => { try { off?.() } catch {} }
  }, [])

  useEffect(() => {
    if (!image) return
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
  }, [image])

  const handleSave = () => {
    (window as any).electronAPI?.sendNotificationAction?.('save')
  }

  const handleCancel = () => {
    (window as any).electronAPI?.sendNotificationAction?.('cancel')
  }

  if (!image) return (
    <div className="h-screen w-screen bg-transparent flex items-center justify-center">
       {/* Transparent placeholder or loading */}
    </div>
  )

  return (
    <div className="h-screen w-screen bg-[#1e1e1e] text-white overflow-hidden flex flex-col border border-gray-600 rounded-lg shadow-2xl relative select-none">
       {/* Progress Bar */}
       <div className="h-1 bg-gray-700 w-full absolute top-0 left-0 z-10">
          <motion.div 
            className="h-full bg-blue-500"
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: 30, ease: 'linear' }}
          />
       </div>

       <div className="flex-1 p-3 flex flex-col items-center justify-center gap-2 drag-handle">
          <h2 className="text-sm font-semibold text-gray-300">Nueva imagen detectada</h2>
          <div className="flex-1 w-full flex items-center justify-center overflow-hidden bg-black/40 rounded border border-gray-700 p-1">
             <img src={image} className="max-h-[200px] max-w-full object-contain" draggable={false} />
          </div>
          
          <div className="flex gap-2 w-full mt-1">
            <button 
              onClick={handleCancel}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1.5 px-3 rounded text-sm flex items-center justify-center gap-1 transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
              Cancelar ({timeLeft}s)
            </button>
            <button 
              onClick={handleSave}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1.5 px-3 rounded text-sm flex items-center justify-center gap-1 transition-colors font-medium"
            >
              <CheckIcon className="w-4 h-4" />
              Guardar
            </button>
          </div>
       </div>
    </div>
  )
}
