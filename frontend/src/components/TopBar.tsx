 

import { XMarkIcon } from '@heroicons/react/24/outline'

type Props = {
  title?: string
}

export default function TopBar({ title = '📋 Copyfy++' }: Props) {
  return (
    <div className="relative z-[2000] w-full">
      <div className="flex items-center justify-between px-3 py-2 select-none drag_region">
        <div className="flex items-center gap-1 no_drag">
          <button
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => (window as any).electronAPI?.hideWindow?.()}
            className="w-7 h-7 grid place-items-center rounded-full transition transform hover:scale-[1.06]"
            style={{
              background: 'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 20%, transparent), color-mix(in oklab, var(--color-accent) 14%, transparent))',
              border: '1px solid var(--color-border)',
              boxShadow: '0 4px 14px rgba(0,0,0,.14)'
            }}
          >
            <XMarkIcon className="w-4 h-4" style={{ color: 'var(--color-text)' }} />
          </button>
        </div>
        <h5 className="m-0 text-[15px] font-semibold text-[color:var(--color-text)]">{title}</h5>
      </div>
    </div>
  )
}
