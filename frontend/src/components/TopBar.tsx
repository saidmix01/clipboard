import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import logo from '../../media/64x64.png'

interface Props {
  search: string
  onSearchChange: (value: string) => void
  onClose?: () => void
}

export default function TopBar({ search, onSearchChange, onClose }: Props) {
  const { t } = useTranslation()

  return (
    <div className="px-4 py-3 border-b border-[color:var(--color-border)] flex items-center gap-3 drag_region shrink-0">
      <img src={logo} alt="CopyFy" className="w-4 h-4 rounded-sm no_drag" />

      <div className="flex items-center gap-2 flex-1 no_drag">
        <MagnifyingGlassIcon className="w-4 h-4 text-[color:var(--color-muted)] shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('search_placeholder')}
          className="w-full bg-transparent text-[length:var(--font-size-card)] text-[color:var(--color-text)] focus:outline-none placeholder:text-[color:var(--color-muted)]"
        />
      </div>

      {onClose && (
        <button
          onClick={onClose}
          title={t('ui.close', 'Close')}
          aria-label={t('ui.close', 'Close')}
          className="p-1.5 rounded-md text-[color:var(--color-muted)] hover:text-white hover:bg-red-500 transition-colors no_drag"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
