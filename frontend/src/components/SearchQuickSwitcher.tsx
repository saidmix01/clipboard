import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Portal from './Portal'

type Props = {
  open: boolean
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
}

export default function SearchQuickSwitcher({
  open,
  query,
  onQueryChange,
  onClose
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  useEffect(() => {
    if (open && inputRef.current) {
      try { inputRef.current.focus(); inputRef.current.select?.() } catch {}
    }
  }, [open])

  if (!open) return null
  return (
    <Portal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 flex items-center justify-center no_drag bg-black/40"
        style={{ zIndex: 9500 }}
      >
        <div className="panel w-[640px] max-h-[40vh] flex flex-col">
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              const v = e.target.value
              onQueryChange(v)
              try { ;(window as any).electronAPI?.setSearchQuery?.(v) } catch {}
            }}
            placeholder="Buscar…"
            className="w-full px-4 py-3 bg-transparent text-[color:var(--color-text)] outline-none focus:bg-[color:var(--color-surface)]"
          />
        </div>
      </motion.div>
    </Portal>
  )
}
