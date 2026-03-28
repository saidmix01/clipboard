import { useState } from 'react'
import { TagIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import type { FilterType } from '../types'
import { useTranslation } from 'react-i18next'

type DockItem = {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

type Props = {
  items: DockItem[]
  userAvatar?: string | null
  filter: FilterType
  onChangeFilter: (f: FilterType) => void
  disabledFavorites?: boolean
  hasAuth?: boolean
}

export default function Dock({ items, userAvatar, filter, onChangeFilter, disabledFavorites, hasAuth = false }: Props) {
  const { t } = useTranslation()
  const [avatarError, setAvatarError] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  
  const btn = (active: boolean) => `w-full px-2 py-1 rounded-[var(--radius-button)] border flex flex-col items-center justify-center text-center transition-colors duration-100 ${
    active
      ? 'bg-[color:var(--color-surface)] border-[color:var(--color-primary)] text-[color:var(--color-text)] font-medium shadow-sm'
      : 'bg-[color:var(--color-bg)] border-[color:var(--color-border)] text-[color:var(--color-text)]'
  } hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)] text-xs`
  
  return (
    <div className="px-3 pb-3 relative">
      <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] flex items-center justify-between px-2 py-1.5 shadow-sm">
        <button 
          className="p-1.5 rounded-[var(--radius-button)] text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100" 
          onClick={() => setFiltersOpen(v => !v)} 
          title={t('dock.filters')}
        >
          <TagIcon className="w-5 h-5" />
        </button>
        {items.map((it, idx) => (
          <button 
            key={idx} 
            className="p-1.5 rounded-[var(--radius-button)] text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100" 
            onClick={it.onClick} 
            title={it.label}
          >
            {it.label === 'Perfil' && userAvatar && !avatarError ? (
               <img src={userAvatar} className="w-5 h-5 rounded-full object-cover" onError={() => setAvatarError(true)} />
             ) : (
               it.icon
             )}
          </button>
        ))}
      </div>
      {filtersOpen && (
        <div className="absolute bottom-14 left-0 right-0 mx-3 z-[20000] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] px-2 py-2 shadow-md animate-in fade-in slide-in-from-bottom-2 duration-100">
          <div className="grid grid-cols-4 gap-2">
            <button className={btn(filter === 'text')} onClick={() => { onChangeFilter('text'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><span className="text-base leading-none">🔤</span><span className="text-[10px]">{t('dock.filter_text')}</span></span>
            </button>
            <button className={btn(filter === 'image')} onClick={() => { onChangeFilter('image'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><span className="text-base leading-none">🖼️</span><span className="text-[10px]">{t('dock.filter_image')}</span></span>
            </button>
            <button className={`${btn(filter === 'favorite')} ${disabledFavorites ? 'opacity-60 cursor-not-allowed' : ''}`} onClick={() => { if (disabledFavorites) return; onChangeFilter('favorite'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><span className="text-base leading-none">⭐</span><span className="text-[10px]">{t('dock.filter_favorites')}</span></span>
            </button>
            <button 
              className={`${btn(filter === 'documents')} ${!hasAuth ? 'opacity-60 cursor-not-allowed' : ''}`} 
              onClick={() => { 
                if (!hasAuth) return
                onChangeFilter('documents')
                setFiltersOpen(false)
              }}
            >
              <span className="flex flex-col items-center gap-1"><DocumentTextIcon className="w-4 h-4" /><span className="text-[10px]">{t('dock.filter_docs')}</span></span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
