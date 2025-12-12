import { motion } from 'framer-motion'
import { TagIcon, Squares2X2Icon, Cog6ToothIcon, UserCircleIcon, ArrowRightStartOnRectangleIcon, ArrowLeftEndOnRectangleIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import type { FilterType } from '../types'

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
}

import { useState } from 'react'

export default function Dock({ items, userAvatar, filter, onChangeFilter, disabledFavorites }: Props) {
  const [avatarError, setAvatarError] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const btn = (active: boolean) => `w-full px-2 py-1 rounded-md border flex flex-col items-center justify-center text-center ${
    active
      ? 'bg-[color:var(--color-surface)] border-[color:var(--color-primary)] text-[color:var(--color-text)] font-medium'
      : 'bg-[color:var(--color-bg)] border-[color:var(--color-border)] text-[color:var(--color-text)]'
  } hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)] transition text-xs`
  return (
    <div className="px-3 pb-2 relative">
      <div className="glass flex items-center justify-between px-3 py-2">
        <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.98 }} className="px-3 py-2 rounded-[12px] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" onClick={() => setFiltersOpen(v => !v)} title="Filtros">
          <TagIcon className="w-5 h-5" />
        </motion.button>
        {items.map((it, idx) => (
          <motion.button key={idx} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.98 }} className="px-3 py-2 rounded-[12px] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" onClick={it.onClick} title={it.label}>
            {it.label === 'Ajustes' ? <Cog6ToothIcon className="w-5 h-5" /> :
             it.label === 'Perfil' ? (
               userAvatar && !avatarError ? (
                 <img src={userAvatar} className="w-5 h-5 rounded-full object-cover" onError={() => setAvatarError(true)} />
               ) : (
                 <UserCircleIcon className="w-5 h-5" />
               )
             ) :
             it.label === 'Cerrar sesión' ? <ArrowRightStartOnRectangleIcon className="w-5 h-5" /> :
             it.label === 'Iniciar sesión' ? <ArrowLeftEndOnRectangleIcon className="w-5 h-5" /> :
             it.label === 'Registrarse' ? <UserPlusIcon className="w-5 h-5" /> : it.icon}
          </motion.button>
        ))}
      </div>
      {filtersOpen && (
        <div className="absolute bottom-16 left-0 right-0 mx-3 z-[20000] glass px-2 py-2">
          <div className="grid grid-cols-4 gap-2">
            <button className={btn(filter === 'all')} onClick={() => { onChangeFilter('all'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><Squares2X2Icon className="w-4 h-4" /><span className="text-[10px]">Todo</span></span>
            </button>
            <button className={btn(filter === 'text')} onClick={() => { onChangeFilter('text'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><span className="text-base leading-none">🔤</span><span className="text-[10px]">Texto</span></span>
            </button>
            <button className={btn(filter === 'image')} onClick={() => { onChangeFilter('image'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><span className="text-base leading-none">🖼️</span><span className="text-[10px]">Imagen</span></span>
            </button>
            <button className={`${btn(filter === 'favorite')} ${disabledFavorites ? 'opacity-60 cursor-not-allowed' : ''}`} onClick={() => { if (disabledFavorites) return; onChangeFilter('favorite'); setFiltersOpen(false) }}>
              <span className="flex flex-col items-center gap-1"><span className="text-base leading-none">⭐</span><span className="text-[10px]">Favoritos</span></span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
