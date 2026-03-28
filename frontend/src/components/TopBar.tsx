 

import { useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import logo from '../../media/64x64.png'
import { useTranslation } from 'react-i18next'

type ActionItem = {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

type Props = {
  title?: string
  actions?: ActionItem[]
  userAvatar?: string | null
}

export default function TopBar({ title = 'Copyfy++', actions = [], userAvatar }: Props) {
  const { t } = useTranslation()
  const [avatarError, setAvatarError] = useState(false)

  return (
    <div className="relative z-[2000] w-full border-b border-[color:var(--color-border)]/50">
      <div className="flex items-center justify-between px-3 py-2 select-none drag_region h-[40px]">
        
        {/* Left: Title & Logo */}
        <div className="flex items-center gap-2 no_drag opacity-90 hover:opacity-100 transition-opacity pl-1">
          <img src={logo} alt="CopyFy logo" className="w-4 h-4 rounded-[2px]" />
          <h5 className="m-0 text-[13px] font-medium text-[color:var(--color-text)] tracking-wide">{title}</h5>
        </div>

        {/* Right: Actions & Close Button */}
        <div className="flex items-center gap-2 no_drag">
          {actions.length > 0 && (
            <div className="flex items-center gap-1 mr-1">
              {actions.map((it, idx) => (
                <button 
                  key={idx} 
                  className="p-2 rounded-[var(--radius-button)] text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100" 
                  onClick={it.onClick} 
                  title={it.label}
                >
                  {it.label === t('dock.profile') || it.label === 'Perfil' ? (
                     userAvatar && !avatarError ? (
                       <img src={userAvatar} className="w-5 h-5 rounded-full object-cover border border-[color:var(--color-border)]" onError={() => setAvatarError(true)} />
                     ) : (
                       <div className="w-5 h-5">{it.icon}</div>
                     )
                   ) : (
                     <div className="w-5 h-5">{it.icon}</div>
                   )}
                </button>
              ))}
            </div>
          )}
          
          {/* Divider */}
          {actions.length > 0 && (
            <div className="w-[1px] h-4 bg-[color:var(--color-border)] mr-1" />
          )}

          {/* Close Button */}
          <button
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => (window as any).electronAPI?.hideWindow?.()}
            className="w-8 h-8 grid place-items-center rounded-[var(--radius-button)] transition-colors duration-100 hover:bg-red-500 hover:text-white group"
          >
            <XMarkIcon className="w-5 h-5 text-[color:var(--color-muted)] group-hover:text-white" />
          </button>
        </div>
        
      </div>
    </div>
  )
}
