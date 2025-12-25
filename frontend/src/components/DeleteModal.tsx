import { motion, AnimatePresence } from 'framer-motion'

type Props = {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteModal({ isOpen, onConfirm, onCancel }: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onCancel}
          />
          
          {/* Modal Content */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-xl p-6 shadow-2xl w-[90%] max-w-sm"
          >
            <h3 className="text-lg font-semibold text-[color:var(--color-text)] mb-2">
              ¿Eliminar elemento?
            </h3>
            <p className="text-sm text-[color:var(--color-muted)] mb-6">
              Esta acción no se puede deshacer. El elemento se eliminará permanentemente de tu historial.
            </p>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg bg-[color:var(--color-bg)] text-[color:var(--color-text)] hover:opacity-80 transition-opacity"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm"
              >
                Eliminar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
