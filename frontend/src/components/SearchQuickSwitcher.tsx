import { useEffect } from 'react'
import { motion } from 'framer-motion'
import Portal from './Portal'

type Props = {
  open: boolean
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
}

export default function SearchQuickSwitcher({ open, query, onQueryChange, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!open) return null
  return (
    <Portal>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex items-start justify-center pt-16 no_drag" style={{ zIndex: 9500 }}>
        <div className="panel w-[520px]">
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar…"
            className="w-full px-4 py-3 bg-transparent text-[color:var(--color-text)] outline-none focus:bg-[color:var(--color-surface)]"
          />
        </div>
      </motion.div>
    </Portal>
  )
}
