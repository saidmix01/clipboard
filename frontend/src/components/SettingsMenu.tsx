import DetailsModal from './DetailsModal'
import { ComputerDesktopIcon, ArrowPathIcon, MoonIcon, SunIcon, TrashIcon, CloudArrowDownIcon } from '@heroicons/react/24/outline'

type Props = {
  open: boolean
  darkMode: boolean
  onClose: () => void
  onChangeDevice: () => void
  onForceUpdate: () => void
  onToggleDark: () => void
  onClearHistory: () => void
  onSyncNow: () => void
}

export default function SettingsMenu({ open, darkMode, onClose, onChangeDevice, onForceUpdate, onToggleDark, onClearHistory, onSyncNow }: Props) {
  if (!open) return null
  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="p-1">
        <h3 className="m-0 text-[color:var(--color-text)]">Ajustes</h3>
        <div className="flex flex-col mt-2">
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onSyncNow}>
            <CloudArrowDownIcon className="w-5 h-5" />
            <span>Sincronizar ahora</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onChangeDevice}>
            <ComputerDesktopIcon className="w-5 h-5" />
            <span>Cambiar dispositivo</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onForceUpdate}>
            <ArrowPathIcon className="w-5 h-5" />
            <span>Buscar actualizaciones</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onToggleDark}>
            {darkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            <span>{darkMode ? 'Modo claro' : 'Modo oscuro'}</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onClearHistory}>
            <TrashIcon className="w-5 h-5" />
            <span>Borrar historial</span>
          </button>
        </div>
      </div>
    </DetailsModal>
  )
}
