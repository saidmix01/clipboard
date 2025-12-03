import { motion } from 'framer-motion'

type Props = {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export default function DetailsModal({ open, onClose, children }: Props) {
  if (!open) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[4000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }} className="glass w-[560px] max-h-[70vh] overflow-auto p-4">
        {children}
      </motion.div>
    </motion.div>
  )
}
