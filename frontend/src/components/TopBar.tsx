 

type Props = {
  title?: string
}

export default function TopBar({ title = '📋 Copyfy++' }: Props) {
  return (
    <div className="relative z-[2000] w-full">
      <div className="flex items-center justify-between px-3 py-2 select-none drag_region">
        <div className="flex items-center gap-2 no_drag">
          <button
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => (window as any).electronAPI?.hideWindow?.()}
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: 'var(--traffic-red)' }}
          />
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--traffic-yellow)' }} />
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--traffic-green)' }} />
        </div>
        <h5 className="m-0 text-[15px] font-semibold text-[color:var(--color-text)]">{title}</h5>
      </div>
    </div>
  )
}
