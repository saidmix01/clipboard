import { DocumentTextIcon, DocumentIcon, PhotoIcon, StarIcon } from '@heroicons/react/24/outline'
import type { FilterType } from '../types'
import { useTranslation } from 'react-i18next'

type DockItem = {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

type Props = {
  items?: DockItem[]
  userAvatar?: string | null
  filter: FilterType
  onChangeFilter: (f: FilterType) => void
  disabledFavorites?: boolean
  hasAuth?: boolean
}

export default function Dock({ filter, onChangeFilter, disabledFavorites, hasAuth = false }: Props) {
  const { t } = useTranslation()
  
  const filterBtn = (active: boolean) => `flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-[var(--radius-button)] transition-colors duration-100 ${
    active
      ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] font-medium shadow-sm border border-[color:var(--color-primary)]/20'
      : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
  }`
  
  return (
    <div className="px-3 pb-3 relative">
      <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-2 shadow-sm flex items-center justify-between gap-2">
        
        <button className={filterBtn(filter === 'text')} onClick={() => onChangeFilter('text')} title={t('dock.filter_text')}>
          <DocumentIcon className="w-5 h-5" />
          <span className="text-[12px] leading-none">{t('dock.filter_text')}</span>
        </button>
        <button className={filterBtn(filter === 'image')} onClick={() => onChangeFilter('image')} title={t('dock.filter_image')}>
          <PhotoIcon className="w-5 h-5" />
          <span className="text-[12px] leading-none">{t('dock.filter_image')}</span>
        </button>
        <button className={`${filterBtn(filter === 'favorite')} ${disabledFavorites ? 'opacity-60 cursor-not-allowed' : ''}`} onClick={() => { if (!disabledFavorites) onChangeFilter('favorite') }} title={t('dock.filter_favorites')}>
          <StarIcon className="w-5 h-5" />
          <span className="text-[12px] leading-none">{t('dock.filter_favorites')}</span>
        </button>
        <button 
          className={`${filterBtn(filter === 'documents')} ${!hasAuth ? 'opacity-60 cursor-not-allowed' : ''}`} 
          onClick={() => { if (hasAuth) onChangeFilter('documents') }}
          title={t('dock.filter_docs')}
        >
          <DocumentTextIcon className="w-5 h-5" />
          <span className="text-[12px] leading-none">{t('dock.filter_docs')}</span>
        </button>

      </div>
    </div>
  )
}
