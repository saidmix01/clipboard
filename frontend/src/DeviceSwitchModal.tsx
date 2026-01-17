import { useEffect, useState } from 'react'
import { API_BASE } from './config'
import { ComputerDesktopIcon, ChevronLeftIcon } from '@heroicons/react/24/outline'
import DetailsModal from './components/DetailsModal'
import { useTranslation } from 'react-i18next'

type Props = {
  isOpen: boolean
  onClose: () => void
  onApplied: (newHistory: any[]) => void
  onBack?: () => void
}

export default function DeviceSwitchModal({ isOpen, onClose, onApplied, onBack }: Props) {
  const { t } = useTranslation()
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
          const token = await (window as any).electronAPI?.getConfig?.('x-token')
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
            const clientId = await (window as any).electronAPI?.getConfig?.('clientId')
            names = Array.from(new Set([...
              names,
              ...apiNames,
              ...(clientId ? [String(clientId)] : [])
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
            const saved = await (window as any).electronAPI?.getConfig?.('clientId') || ''
            if (saved && Array.isArray(list) && list.includes(saved)) initial = saved
          } catch {}
        }
        if (!initial && Array.isArray(list) && list.length) initial = list[0]
        setSelected(initial)
      } catch (e) {
        setError(t('device.error_load_devices'))
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
      try { await (window as any).electronAPI?.setConfig?.('clientId', selected) } catch {}
      onClose()
      Promise.resolve((window as any).electronAPI?.switchActiveDevice?.(selected))
        .then((hist: any) => {
          if (Array.isArray(hist)) onApplied(hist)
        })
        .catch(() => {
          setError(t('device.error_load_history'))
        })
    } catch {
      setError(t('device.error_load_history'))
    } finally {
      setLoading(false)
    }
  }

  const MouseOver = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--color-primary)'
    e.currentTarget.style.color = '#ffffff'
  }
  const MouseOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent'
    e.currentTarget.style.color = 'var(--color-text)'
  }

  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => { if (onBack) onBack(); else onClose(); }} className="p-1 rounded-full hover:text-white transition-colors" onMouseEnter={MouseOver} onMouseLeave={MouseOut} title={t('device.back')}>
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <h3 className="m-0">{t('device.title')}</h3>
        </div>
        <div className="mt-1">
          <label className="text-sm opacity-80 mb-2 block">{t('device.select_label')}</label>
          <div className="max-h-[36vh] overflow-auto space-y-2">
            {devices.length === 0 && (
              <div className="text-sm opacity-70">{t('device.no_devices')}</div>
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
            <div className="text-sm opacity-80">{status || t('device.status_syncing')}</div>
            <div className="w-full h-2 rounded-md" style={{ background: 'var(--color-bg)' }}>
              <div className="h-full rounded-md" style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: 'var(--color-primary)' }} />
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button onClick={apply} disabled={!selected || loading} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">{t('device.apply')}</button>
          <button onClick={onClose} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">{t('device.cancel')}</button>
        </div>
      </div>
    </DetailsModal>
  )
}
