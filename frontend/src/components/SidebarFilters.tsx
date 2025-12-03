import type { FilterType } from '../types'

type Props = {
  filter: FilterType
  onChange: (f: FilterType) => void
}

export default function SidebarFilters({ filter, onChange }: Props) {
  const btn = (active: boolean) => `px-3 py-1 rounded-md border ${active ? 'bg-[color:var(--color-bg)]' : ''} border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition text-sm`
  return (
    <div className="px-3 py-2 border-t border-[color:var(--color-border)]">
      <div className="flex items-center justify-between gap-2">
        <button className={btn(filter === 'all')} onClick={() => onChange('all')}>Todo</button>
        <button className={btn(filter === 'text')} onClick={() => onChange('text')}>🔤 Texto</button>
        <button className={btn(filter === 'image')} onClick={() => onChange('image')}>🖼️ Imagen</button>
        <button className={btn(filter === 'favorite')} onClick={() => onChange('favorite')}>⭐ Favoritos</button>
      </div>
    </div>
  )
}
