import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'

type Props = {
  isOpen: boolean
  previewUrl: string | null
  onConfirm: () => void
  onCancel: () => void
}

export default function ScreenshotModal({ isOpen, previewUrl, onConfirm, onCancel }: Props) {
  const [loading, setLoading] = useState(false)

  // Reset loading state when modal opens/closes
  useEffect(() => {
    if (isOpen) setLoading(false)
  }, [isOpen])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-4 border-b border-[color:var(--color-border)] flex justify-between items-center bg-[color:var(--color-bg)]">
              <h3 className="font-semibold text-lg">Nueva Captura Detectada</h3>
            </div>
            
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/5 min-h-[200px]">
              {previewUrl ? (
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="max-w-full max-h-[60vh] object-contain rounded shadow-md border border-[color:var(--color-border)]"
                />
              ) : (
                <div className="text-[color:var(--color-muted)]">Cargando vista previa...</div>
              )}
            </div>

            <div className="p-4 border-t border-[color:var(--color-border)] flex justify-end gap-3 bg-[color:var(--color-surface)]">
              <button
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2 rounded-lg hover:bg-[color:var(--color-bg)] text-[color:var(--color-text)] transition disabled:opacity-50"
              >
                Descartar
              </button>
              <button
                onClick={() => {
                  setLoading(true)
                  onConfirm()
                }}
                disabled={loading}
                className="px-6 py-2 rounded-lg bg-[color:var(--color-primary)] text-white font-medium hover:opacity-90 transition shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? 'Guardando...' : 'Guardar Captura'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
