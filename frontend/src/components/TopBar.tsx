 

import { XMarkIcon } from '@heroicons/react/24/outline'
import logo from '../../media/64x64.png'

type Props = {
  title?: string
}

export default function TopBar({ title = 'Copyfy++' }: Props) {
  return (
    <div className="relative z-[2000] w-full border-b border-[color:var(--color-border)]/50">
      <div className="flex items-center justify-between px-3 py-2 select-none drag_region">
        <div className="flex items-center gap-2 no_drag">
          <button
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => (window as any).electronAPI?.hideWindow?.()}
            className="w-6 h-6 grid place-items-center rounded-[var(--radius-button)] transition-colors duration-100 hover:bg-red-500 hover:text-white group"
          >
            <XMarkIcon className="w-3.5 h-3.5 text-[color:var(--color-muted)] group-hover:text-white" />
          </button>
        </div>
        <div className="flex items-center gap-2 no_drag opacity-80 hover:opacity-100 transition-opacity">
          <img src={logo} alt="CopyFy logo" className="w-3.5 h-3.5 rounded-[2px]" />
          <h5 className="m-0 text-[13px] font-medium text-[color:var(--color-text)]">{title}</h5>
        </div>
      </div>
    </div>
  )
}
