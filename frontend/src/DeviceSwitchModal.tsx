import { useEffect, useState } from 'react'

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

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setLoading(true)
    ;(async () => {
      try {
        const list = await (window as any).electronAPI?.listDevices?.()
        if (Array.isArray(list)) setDevices(list)
      } catch {
        setError('No se pudieron cargar los dispositivos')
      } finally {
        setLoading(false)
      }
    })()
  }, [isOpen])

  if (!isOpen) return null

  const apply = async () => {
    if (!selected) return
    try {
      setLoading(true)
      const hist = await (window as any).electronAPI?.loadDeviceHistory?.(selected)
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

