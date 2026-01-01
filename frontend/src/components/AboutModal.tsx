import DetailsModal from './DetailsModal'
import { LinkIcon, XMarkIcon } from '@heroicons/react/24/outline'

type Props = {
  isOpen: boolean
  onClose: () => void
  version: string
}

export default function AboutModal ({ isOpen, onClose, version }: Props) {
  if (!isOpen) return null
  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="p-1 relative">
        <button
          aria-label="Cerrar"
          title="Cerrar"
          onClick={onClose}
          className="absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-full transition transform hover:scale-[1.06]"
          style={{
            background: 'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 20%, transparent), color-mix(in oklab, var(--color-accent) 14%, transparent))',
            border: '1px solid var(--color-border)',
            boxShadow: '0 4px 14px rgba(0,0,0,.14)'
          }}
        >
          <XMarkIcon className="w-4 h-4" style={{ color: 'var(--color-text)' }} />
        </button>
        <h3 className="m-0 text-[color:var(--color-text)]">Acerca de Copyfy++</h3>
        <div className="mt-2 text-[color:var(--color-muted)]">
          <div className="mb-2">Versión: v{version || 'N/D'}</div>
          <div className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            <a href="https://copyfy.lat/novedades" target="_blank" rel="noreferrer" className="text-[color:var(--color-text)] underline" onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://copyfy.lat/novedades') } catch {} }}>
              Novedades
            </a>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <LinkIcon className="w-5 h-5" />
            <a href="https://github.com/saidmix01/clipboard" target="_blank" rel="noreferrer" className="text-[color:var(--color-text)] underline" onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://github.com/saidmix01/clipboard') } catch {} }}>
              GitHub
            </a>
          </div>
        </div>
      </div>
    </DetailsModal>
  )
}
