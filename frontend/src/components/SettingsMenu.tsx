import { motion } from 'framer-motion'

type Props = {
  open: boolean
  darkMode: boolean
  onClose: () => void
  onChangeDevice: () => void
  onForceUpdate: () => void
  onToggleDark: () => void
  onClearHistory: () => void
}

export default function SettingsMenu({ open, darkMode, onClose, onChangeDevice, onForceUpdate, onToggleDark, onClearHistory }: Props) {
  if (!open) return null
  return (
    <div className="relative">
      <div className="fixed inset-0 z-[2500]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 0.9, 0.38, 1] }}
        className="absolute right-3 top-12 z-[3000] glass min-w-[220px]"
      >
        <div className="flex flex-col p-2 gap-2">
          <button className="px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onChangeDevice}>🖥️ Cambiar dispositivo</button>
          <button className="px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onForceUpdate}>🔄 Buscar actualizaciones</button>
          <button className="px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onToggleDark}>{darkMode ? '🌞' : '🌙'} Modo oscuro</button>
          <button className="px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onClearHistory}>🗑️ Borrar historial</button>
        </div>
      </motion.div>
    </div>
  )
}
