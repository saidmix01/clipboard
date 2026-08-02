import { useState, useEffect } from 'react'
import { ComputerDesktopIcon } from '@heroicons/react/24/outline'
import { notifyError } from '../utils/notify'
import { useTranslation } from 'react-i18next'

type Props = {
  onSuccess: () => void
}

export default function DeviceRegistrationModal({ onSuccess }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Check if device is registered
    const checkDevice = async () => {
        try {
            const device = await (window as any).electronAPI?.getActiveDevice?.()
            // Show modal if no device OR if it's the legacy 'local-device'
            if (!device || !device.Id || device.Id === 'local-device') {
                // Get hostname for suggestion
                const hostname = await (window as any).electronAPI?.getHostname?.()
                
                // Suggest hostname if available, or just default
                if (device?.Name && device.Id === 'local-device' && device.Name !== 'local-device') {
                     // Prefer existing custom name if it wasn't the default "local-device" ID's default name
                     setDeviceName(device.Name)
                } else {
                     setDeviceName(hostname || 'Mi PC')
                }
                setOpen(true)
            }
        } catch (e) {
            console.error('Error checking device:', e)
            setOpen(true) // Fallback: show modal if check fails
        }
    }
    
    // Slight delay to ensure bridge is ready
    setTimeout(checkDevice, 1000)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!deviceName.trim()) return
      
      setLoading(true)
      try {
          await (window as any).electronAPI?.registerNewDevice?.(deviceName)
          setOpen(false)
          onSuccess()
      } catch (err) {
          notifyError(t('device.register_error'))
      } finally {
          setLoading(false)
      }
  }

  if (!open) return null

  // We use a custom modal overlay here because we want it to be blocking/prominent
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-modal)] shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
                <div className="p-3 rounded-full bg-[color:var(--color-bg)]">
                    <ComputerDesktopIcon className="w-8 h-8 text-[color:var(--color-primary)]" />
                </div>
                <h2 className="text-lg font-semibold text-[color:var(--color-text)]">{t('device.register_title')}</h2>
                <p className="text-sm text-[color:var(--color-muted)]">
                    {t('device.register_desc')}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <input
                  type="text"
                  value={deviceName}
                  onChange={e => setDeviceName(e.target.value)}
                  placeholder={t('device.name_placeholder')}
                  className="w-full px-3 h-[32px] rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
                  autoFocus
                />
                
                <button
                  type="submit"
                  disabled={loading || !deviceName.trim()}
                  className="w-full h-[32px] bg-[color:var(--color-primary)] text-white rounded-[var(--radius-button)] font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors duration-100 text-sm"
                >
                    {loading ? t('device.registering') : t('device.continue')}
                </button>
            </form>
        </div>
    </div>
  )
}
