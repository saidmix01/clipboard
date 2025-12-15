import type { FilterType } from '../types'

type Props = {
  filter: FilterType
  onChange: (f: FilterType) => void
  disabledFavorites?: boolean
}

export default function SidebarFilters({ filter, onChange, disabledFavorites }: Props) {
  const btn = (active: boolean) => `px-3 py-1 rounded-md border ${
    active
      ? 'bg-[color:var(--color-surface)] border-[color:var(--color-primary)] text-[color:var(--color-text)] font-medium'
      : 'bg-[color:var(--color-bg)] border-[color:var(--color-border)] text-[color:var(--color-text)]'
  } hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)] transition text-sm`
  return (
    <div className="px-3 py-2 border-t border-[color:var(--color-border)]">
      <div className="flex items-center justify-between gap-2">
        <button className={btn(filter === 'all')} onClick={() => onChange('all')}>Todo</button>
        <button className={btn(filter === 'text')} onClick={() => onChange('text')}>🔤 Texto</button>
        <button className={btn(filter === 'image')} onClick={() => onChange('image')}>🖼️ Imagen</button>
        <button className={`${btn(filter === 'favorite')} ${disabledFavorites ? 'opacity-60 cursor-not-allowed' : ''}`} onClick={() => { if (disabledFavorites) return; onChange('favorite') }}>⭐ Favoritos</button>
      </div>
    </div>
  )
}
