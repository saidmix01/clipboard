import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'

export default function NotificationWindow() {
  const { t } = useTranslation()
  const [image, setImage] = useState<string | null>(null)
  const [file, setFile] = useState<{name: string, path: string} | null>(null)
  const [timeLeft, setTimeLeft] = useState(5)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadDarkMode() {
        const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
        if (stored === 'true') {
            document.documentElement.setAttribute('data-theme', 'dark')
        } else {
            document.documentElement.setAttribute('data-theme', 'light')
        }
    }
    loadDarkMode()

    // Notify main process we are ready
    ;(window as any).electronAPI?.signalNotificationReady?.()

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
    <div className="h-screen w-screen bg-[color:var(--color-surface)] text-[color:var(--color-text)] overflow-hidden flex flex-col border border-[color:var(--color-border)] rounded-[var(--radius-modal)] shadow-[var(--shadow-modal)] relative select-none">
       {/* Progress Bar */}
       {!loading && !error && (
       <div className="h-1 bg-[color:var(--color-border)] w-full absolute top-0 left-0 z-10">
          <motion.div 
            className="h-full bg-[color:var(--color-primary)]"
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: 5, ease: 'linear' }}
          />
       </div>
       )}

       <div className="flex-1 p-3 flex flex-col items-center justify-center gap-3 drag-handle">
          <h2 className="text-[13px] font-medium text-[color:var(--color-text)] text-center px-2 w-full truncate">
              {error ? error : (loading ? t('notification_window.uploading') : (file ? `${t('notification_window.document')} ${file.name}` : t('notification_window.new_image')))}
          </h2>
          
          <div className="flex gap-2 w-full mt-auto">
            <button 
              onClick={handleCancel}
              className="flex-1 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] hover:bg-black/5 dark:hover:bg-white/5 text-[color:var(--color-text)] h-[32px] rounded-[var(--radius-button)] text-sm flex items-center justify-center gap-1 transition-colors duration-100 no-drag font-medium"
            >
              <XMarkIcon className="w-4 h-4" />
              {error ? t('notification_window.close') : `${t('notification_window.cancel')} (${timeLeft}s)`}
            </button>
            {!error && !loading && (
            <button 
              onClick={handleSave}
              className="flex-1 bg-[color:var(--color-primary)] hover:bg-blue-600 text-white h-[32px] rounded-[var(--radius-button)] text-sm flex items-center justify-center gap-1 transition-colors duration-100 font-medium no-drag"
            >
              <CheckIcon className="w-4 h-4" />
              {file ? t('notification_window.upload') : t('notification_window.save')}
            </button>
            )}
          </div>
       </div>
    </div>
  )
}
