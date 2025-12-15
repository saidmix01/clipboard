import { useEffect, useState } from 'react'
import { API_BASE } from './config'
import { ComputerDesktopIcon } from '@heroicons/react/24/outline'
import DetailsModal from './components/DetailsModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onApplied: (newHistory: any[]) => void
}

export default function DeviceSwitchModal({ isOpen, onClose, onApplied }: Props) {
  const [devices, setDevices] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number>(0)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setLoading(true)
    ;(async () => {
      try {
        const list = await (window as any).electronAPI?.listDevices?.()
        let names: string[] = Array.isArray(list) ? list : []
        try {
          const token = localStorage.getItem('x-token')
          if (token) {
            const res = await fetch(`${API_BASE}/devices`, { headers: { Authorization: `Bearer ${token}` } })
            const data = await res.json()
            const container: any = (data && typeof data === 'object' ? (data.data ?? data) : {})
            const arr: any[] = Array.isArray(container) ? container : (Array.isArray(container.items) ? container.items : [])
            const apiNames = Array.isArray(arr)
              ? arr.map((d: any) => {
                  if (typeof d === 'string') return d
                  const o = d || {}
                  return String(o.clientId || o.name || '')
                }).filter(Boolean)
              : []
            names = Array.from(new Set([...
              names,
              ...apiNames,
              ...(localStorage.getItem('clientId') ? [String(localStorage.getItem('clientId'))] : [])
            ])).filter(Boolean)
          }
        } catch {}
        setDevices(names)
        let initial = ''
        try {
          const current = await (window as any).electronAPI?.getActiveDevice?.()
          if (typeof current === 'string' && current && Array.isArray(list) && list.includes(current)) {
            initial = current
          }
        } catch {}
        if (!initial) {
          try {
            const saved = localStorage.getItem('clientId') || ''
            if (saved && Array.isArray(list) && list.includes(saved)) initial = saved
          } catch {}
        }
        if (!initial && Array.isArray(list) && list.length) initial = list[0]
        setSelected(initial)
      } catch {
        setError('No se pudieron cargar los dispositivos')
      } finally {
        setLoading(false)
      }
    })()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const off = (window as any).electronAPI?.onSyncProgress?.((p: any) => {
      try {
        const val = Number(p?.percentage) || 0
        const msg = typeof p?.message === 'string' ? p.message : ''
        setProgress(val)
        setStatus(msg)
      } catch {}
    })
    return () => {
      try { if (typeof off === 'function') off() } catch {}
      setProgress(0)
      setStatus('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const apply = async () => {
    if (!selected) return
    try {
      setLoading(true)
      setProgress(0)
      setStatus('')
      try { localStorage.setItem('clientId', selected) } catch {}
      const hist = await (window as any).electronAPI?.switchActiveDevice?.(selected)
      if (Array.isArray(hist)) onApplied(hist)
      onClose()
    } catch {
      setError('No se pudo cargar el historial del dispositivo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="space-y-3">
        <h3 className="m-0">Cambiar dispositivo</h3>
        <div className="mt-1">
          <label className="text-sm opacity-80 mb-2 block">Selecciona dispositivo</label>
          <div className="max-h-[36vh] overflow-auto space-y-2">
            {devices.length === 0 && (
              <div className="text-sm opacity-70">Sin dispositivos</div>
            )}
            {devices.map((d, i) => {
              const isSel = selected === d
              return (
                <button
                  key={i}
                  onClick={() => setSelected(d)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left hover:bg-[color:var(--color-bg)]"
                  style={{
                    borderColor: isSel ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isSel ? 'color-mix(in oklab, var(--color-primary) 12%, transparent)' : 'transparent',
                    color: 'var(--color-text)'
                  }}
                >
                  <ComputerDesktopIcon className="w-5 h-5" />
                  <span className="truncate">{d}</span>
                </button>
              )
            })}
          </div>
        </div>
        {error && <div className="text-sm" style={{ color: 'var(--color-accent)' }}>{error}</div>}
        {loading && (
          <div className="mt-2 space-y-2">
            <div className="text-sm opacity-80">{status || 'Sincronizando...'}</div>
            <div className="w-full h-2 rounded-md" style={{ background: 'var(--color-bg)' }}>
              <div className="h-full rounded-md" style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: 'var(--color-primary)' }} />
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button onClick={apply} disabled={!selected || loading} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">Aplicar</button>
          <button onClick={onClose} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">Cancelar</button>
        </div>
      </div>
    </DetailsModal>
  )
}
