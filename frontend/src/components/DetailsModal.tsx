import { motion } from 'framer-motion'
import Portal from './Portal'

type Props = {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export default function DetailsModal({ open, onClose, children }: Props) {
  if (!open) return null
  return (
    <Portal>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex items-center justify-center no_drag" style={{ zIndex: 10000 }}>
        <div className="absolute inset-0 bg-black/40" onClick={onClose} style={{ zIndex: 1 }} />
        <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }} className="panel w-[560px] max-h-[70vh] overflow-auto p-4" style={{ zIndex: 2 }}>
          {children}
        </motion.div>
      </motion.div>
    </Portal>
  )
}
