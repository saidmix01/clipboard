import { useEffect, useState } from 'react'
import { API_BASE } from './config'

type Props = {
  isOpen: boolean
  onClose: () => void
  isDarkMode: boolean
  onApplied: (newHistory: any[]) => void
}

export default function DeviceSwitchModal({ isOpen, onClose, isDarkMode, onApplied }: Props) {
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
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: isDarkMode ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: isDarkMode ? '#1e1e1e' : '#fff', color: isDarkMode ? '#f5f5f5' : '#000',
          padding: 20, borderRadius: 8, width: '92%', maxWidth: 380,
          boxShadow: isDarkMode ? '0 2px 14px rgba(0,0,0,0.45)' : '0 2px 10px rgba(0,0,0,0.3)'
        }}
      >
        <h3 style={{ marginTop: 0 }}>Cambiar dispositivo</h3>

        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: 4, display: 'block' }}>Selecciona dispositivo</label>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className={`form-select form-select-sm ${isDarkMode ? 'bg-dark text-white border-secondary' : ''}`}
          >
            <option value='' disabled>—</option>
            {devices.map((d, i) => (
              <option key={i} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {error && <div style={{ color: 'red', marginTop: 10 }}>{error}</div>}

        {loading && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{status || 'Sincronizando...'}</div>
            <div style={{ width: '100%', height: 8, borderRadius: 6, background: isDarkMode ? '#2c2c2c' : '#eee', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(0, Math.min(100, progress))}%`, height: '100%', background: isDarkMode ? '#28a745' : '#0d6efd' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={apply}
            disabled={!selected || loading}
            className={isDarkMode ? 'btn btn-sm btn-outline-success' : 'btn btn-sm btn-outline-primary'}
          >
            Aplicar
          </button>
          <button
            onClick={onClose}
            className={isDarkMode ? 'btn btn-sm btn-outline-light' : 'btn btn-sm btn-outline-dark'}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
