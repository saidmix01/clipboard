import type { FilterType } from '../types'
import { useTranslation } from 'react-i18next'

interface Props {
  items?: { label: string; icon: React.ReactNode; onClick: () => void }[]
  userAvatar?: string | null
  filter: FilterType
  onChangeFilter: (f: FilterType) => void
  disabledFavorites?: boolean
  hasAuth?: boolean
}

export default function Dock({ filter, onChangeFilter, disabledFavorites, hasAuth = false }: Props) {
  const { t } = useTranslation()

  const tabs: { id: FilterType; label: string; disabled?: boolean }[] = [
    { id: 'all' as FilterType, label: t('dock.filter_all', 'Todo') },
    { id: 'text', label: t('dock.filter_text', 'Texto') },
    { id: 'image', label: t('dock.filter_image', 'Imágenes') },
    { id: 'favorite', label: t('dock.filter_favorites', 'Favoritos'), disabled: disabledFavorites },
    { id: 'documents', label: t('dock.filter_docs', 'Archivos'), disabled: !hasAuth },
  ]

  return (
    <div className="flex gap-1 px-3 py-2 text-xs font-medium border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-hover)]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => { if (!tab.disabled) onChangeFilter(tab.id) }}
          disabled={tab.disabled}
          className={`
            px-3 py-1.5 rounded-md transition-colors duration-100
            ${tab.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            ${filter === tab.id
              ? 'bg-[color:var(--color-surface)] shadow-sm border border-[color:var(--color-border)] text-[color:var(--color-text)]'
              : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-surface-active)] border border-transparent'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
