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
      <div className="fixed inset-0 flex items-center justify-center no_drag animate-in fade-in duration-100" style={{ zIndex: 10000 }}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} style={{ zIndex: 1 }} />
        <div className="panel w-[380px] max-h-[70vh] overflow-auto p-4 animate-in zoom-in-95 duration-100 shadow-2xl border border-[color:var(--color-border)] rounded-[var(--radius-modal)]" style={{ zIndex: 2 }}>
          {children}
        </div>
      </div>
    </Portal>
  )
}
