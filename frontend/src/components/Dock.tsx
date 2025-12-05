import { motion } from 'framer-motion'
import { ClipboardIcon, ClipboardDocumentCheckIcon, HeartIcon, Cog6ToothIcon, UserCircleIcon, ArrowRightStartOnRectangleIcon, ArrowLeftEndOnRectangleIcon, UserPlusIcon } from '@heroicons/react/24/outline'

type DockItem = {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

type Props = {
  items: DockItem[]
  userAvatar?: string | null
}

import { useState } from 'react'

export default function Dock({ items, userAvatar }: Props) {
  const [avatarError, setAvatarError] = useState(false)
  return (
    <div className="px-3 pb-2">
      <div className="glass flex items-center justify-between px-3 py-2">
        {items.map((it, idx) => (
          <motion.button key={idx} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.98 }} className="px-3 py-2 rounded-[12px] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" onClick={it.onClick} title={it.label}>
            {it.label === 'Copiar' ? <ClipboardIcon className="w-5 h-5" /> :
             it.label === 'Pegar' ? <ClipboardDocumentCheckIcon className="w-5 h-5" /> :
             it.label === 'Favoritos' ? <HeartIcon className="w-5 h-5" /> :
             it.label === 'Ajustes' ? <Cog6ToothIcon className="w-5 h-5" /> :
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
    </div>
  )
}
