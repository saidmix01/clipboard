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
      const current = await (window as any).electronAPI?.getActiveDevice?.()
      
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
      toast.success(t('device.created'))
      setView('list')
      setNewDeviceName('')
      loadDevices()
    } catch (e) {
      toast.error(t('device.create_error'))
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
                    <button onClick={() => setView('create')} className="p-1 rounded-[var(--radius-button)] hover:bg-black/5 dark:hover:bg-white/5 text-[color:var(--color-primary)] transition-colors duration-100" title={t('device.new_device')}>
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
                                className={`flex items-center justify-between p-2 rounded-[var(--radius-card)] border cursor-pointer transition-colors duration-100 ${dev.Id === currentDeviceId ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/5' : 'border-[color:var(--color-border)] hover:bg-black/5 dark:hover:bg-white/5'}`}
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
                <p className="text-sm text-[color:var(--color-muted)]">{t('device.register_desc')}</p>
                <input
                  type="text"
                  value={newDeviceName}
                  onChange={e => setNewDeviceName(e.target.value)}
                  placeholder={t('device.name_placeholder')}
                  className="w-full px-3 h-[32px] rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
                  autoFocus
                />
                <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className="flex-1 h-[32px] border border-[color:var(--color-border)] rounded-[var(--radius-button)] text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100 text-sm font-medium"
                    >
                        {t('device.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !newDeviceName.trim()}
                      className="flex-1 h-[32px] bg-[color:var(--color-primary)] hover:bg-blue-600 text-white rounded-[var(--radius-button)] disabled:opacity-50 transition-colors duration-100 text-sm font-medium"
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
