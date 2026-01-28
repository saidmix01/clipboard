import { useState, useEffect } from 'react'
import DetailsModal from './DetailsModal'
import { ComputerDesktopIcon, PlusIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function DeviceSelectionModal({ open, onClose, onSuccess }: Props) {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<any[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'list' | 'create'>('list')
  const [newDeviceName, setNewDeviceName] = useState('')

  useEffect(() => {
    if (open) {
      loadDevices()
    }
  }, [open])

  const loadDevices = async () => {
    try {
      setLoading(true)
      const all = await (window as any).electronAPI?.getAllDevices?.()
      const current = await (window as any).electronAPI?.getCurrentDevice?.()
      
      setDevices(all || [])
      if (current) setCurrentDeviceId(current.Id)
    } catch (e) {
      console.error(e)
      toast.error(t('device.error_load_devices'))
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = async (device: any) => {
    // Just select it immediately without checking currentDeviceId
    // because we might want to re-confirm the same device.
    
    try {
      setLoading(true)
      // We are calling setActiveDevice which we need to implement in backend
      await (window as any).electronAPI?.setActiveDevice?.(device.Id)
      
      // Update local state immediately to reflect change in UI
      setCurrentDeviceId(device.Id)
      
      toast.success(t('device.apply'))
      
      // Force reload via parent
      if (onSuccess) onSuccess()
      
      onClose()
    } catch (e) {
      console.error(e)
      toast.error('Error changing device')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDeviceName.trim()) return

    try {
      setLoading(true)
      await (window as any).electronAPI?.registerNewDevice?.(newDeviceName)
      toast.success('Dispositivo creado')
      setView('list')
      setNewDeviceName('')
      loadDevices()
    } catch (e) {
      toast.error('Error creating device')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-[color:var(--color-bg)]">
                <ComputerDesktopIcon className="w-6 h-6 text-[color:var(--color-primary)]" />
            </div>
            <h3 className="m-0 text-[color:var(--color-text)]">{t('device.title')}</h3>
        </div>

        {view === 'list' ? (
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <p className="text-sm text-[color:var(--color-muted)]">{t('device.select_label')}</p>
                    <button onClick={() => setView('create')} className="p-1 rounded hover:bg-[color:var(--color-bg)] text-[color:var(--color-primary)]" title="Nuevo dispositivo">
                        <PlusIcon className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                    {loading && devices.length === 0 ? (
                        <p className="text-center text-xs text-[color:var(--color-muted)]">{t('ui.loading')}</p>
                    ) : devices.length === 0 ? (
                        <p className="text-center text-xs text-[color:var(--color-muted)]">{t('device.no_devices')}</p>
                    ) : (
                        devices.map(dev => (
                            <div 
                                key={dev.Id} 
                                onClick={() => handleSelect(dev)}
                                className={`flex items-center justify-between p-3 rounded-md border cursor-pointer transition ${dev.Id === currentDeviceId ? 'border-[color:var(--color-primary)] bg-[color:var(--color-surface)]' : 'border-[color:var(--color-border)] hover:bg-[color:var(--color-bg)]'}`}
                            >
                                <div className="flex flex-col">
                                    <span className="font-medium text-[color:var(--color-text)]">{dev.Name}</span>
                                    <span className="text-[10px] text-[color:var(--color-muted)]">{dev.OsName} • {new Date(dev.UpdatedAt).toLocaleDateString()}</span>
                                </div>
                                {dev.Id === currentDeviceId && (
                                    <CheckCircleIcon className="w-5 h-5 text-[color:var(--color-primary)]" />
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        ) : (
            <form onSubmit={handleCreate} className="space-y-3">
                <p className="text-sm text-[color:var(--color-muted)]">Ingresa un nombre para este dispositivo:</p>
                <input
                  type="text"
                  value={newDeviceName}
                  onChange={e => setNewDeviceName(e.target.value)}
                  placeholder="Ej: Laptop Casa"
                  className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]"
                  autoFocus
                />
                <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className="flex-1 py-2 border border-[color:var(--color-border)] rounded-lg text-[color:var(--color-text)]"
                    >
                        {t('device.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !newDeviceName.trim()}
                      className="flex-1 py-2 bg-[color:var(--color-primary)] text-white rounded-lg"
                    >
                        {loading ? '...' : t('device.apply')}
                    </button>
                </div>
            </form>
        )}
      </div>
    </DetailsModal>
  )
}
