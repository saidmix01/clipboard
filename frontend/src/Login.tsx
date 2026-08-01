import { useState } from 'react'
import DetailsModal from './components/DetailsModal'
import { useTranslation } from 'react-i18next'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'

type LoginModalProps = {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (token: string, user?: any) => void
  mode?: 'login' | 'register'
  onGlobalLoading?: (loading: boolean) => void
  onBack?: () => void
}

export default function LoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
  mode = 'login',
  onGlobalLoading,
  onBack
}: LoginModalProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const isRegister = mode === 'register'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    if (onGlobalLoading) onGlobalLoading(true)

    try {
      const emailTrim = email.trim()
      const passTrim = password.trim()
      const nameTrim = name.trim()

      // Validaciones
      if (isRegister) {
        if (!nameTrim || !emailTrim || !passTrim) {
          setError(t('auth.error_all_fields'))
          return
        }
        if (passTrim.length < 8) {
          setError(t('auth.error_password_length'))
          return
        }
        if (passTrim !== confirmPassword.trim()) {
          setError(t('auth.error_password_mismatch'))
          return
        }
      } else {
        if (!emailTrim || !passTrim) {
          setError(t('auth.error_all_fields'))
          return
        }
      }

      const endpoint = isRegister ? '/auth/register' : '/auth/login'
      const requestBody = isRegister
        ? { email: emailTrim, password: passTrim, name: nameTrim }
        : { email: emailTrim, password: passTrim }

      const response = await (window as any).electronAPI?.backend?.request({
        url: endpoint,
        method: 'POST',
        data: requestBody
      })

      if (!response || !response.success) {
        // El servidor retorna { success: false, message, errors: [{param, msg}] } en validación (422)
        // o { success: false, message } en otros errores
        const serverErrors = response?.data?.errors
        const firstError = Array.isArray(serverErrors) && serverErrors.length > 0
          ? serverErrors[0].msg
          : null
        const serverMsg = firstError || response?.data?.message || response?.error
        throw Object.assign(new Error(serverMsg || 'Request failed'), { status: response?.status })
      }

      // BackendDaemon.request() retorna { success, data, status }
      // data = lo que el servidor devuelve: { success, data: { user, token, refreshToken } }
      const serverData = response.data
      const payload = serverData?.data ?? serverData
      const { user, token, refreshToken } = payload ?? {}

      if (token) {
        await (window as any).electronAPI?.setConfig?.('session', JSON.stringify({
          token,
          refreshToken,
          email: user?.email,
          name: user?.name,
          user
        }))

        onLoginSuccess(token, user)

        try {
          await (window as any).electronAPI?.notifyLoginSuccess?.()
        } catch {}

        onClose()
      } else {
        setError(
          isRegister
            ? t('auth.error_register')
            : t('auth.error_credentials')
        )
      }

    } catch (e: any) {
      const msg = e?.message || ''
      if (msg.includes('409') || msg.toLowerCase().includes('already') || (e?.status === 409)) {
        setError(t('auth.error_email_taken'))
      } else if (msg.toLowerCase().includes('password') && msg.toLowerCase().includes('8')) {
        setError(t('auth.error_password_length'))
      } else if (msg && msg !== 'Request failed') {
        // Mostrar mensaje real del servidor si es legible
        setError(msg)
      } else {
        setError(isRegister ? t('auth.error_register') : t('auth.error_credentials'))
      }
    } finally {
      setLoading(false)
      if (onGlobalLoading) onGlobalLoading(false)
    }
  }

  const passwordsMatch = !confirmPassword || confirmPassword === password

  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="space-y-3">

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => { if (onBack) onBack(); else onClose() }}
            className="p-1 rounded-[var(--radius-button)] text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={t('auth.back')}
          >
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <h3 className="m-0 text-[color:var(--color-text)] font-semibold text-base">
            {isRegister ? t('auth.register_title') : t('auth.login_title')}
          </h3>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-2">

          {isRegister && (
            <input
              type="text"
              placeholder={t('auth.name_placeholder')}
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoComplete="name"
              className="w-full px-3 h-[36px] rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
            />
          )}

          <input
            type="email"
            placeholder={t('auth.email_placeholder')}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full px-3 h-[36px] rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
          />

          <input
            type="password"
            placeholder={t('auth.password_placeholder')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            className="w-full px-3 h-[36px] rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] text-sm"
          />

          {isRegister && (
            <input
              type="password"
              placeholder={t('auth.confirm_password_placeholder')}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={`w-full px-3 h-[36px] rounded-[var(--radius-input)] border bg-transparent text-[color:var(--color-text)] outline-none focus:ring-1 text-sm transition-colors
                ${!passwordsMatch
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-[color:var(--color-border)] focus:ring-[color:var(--color-primary)]'
                }`}
            />
          )}

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 px-0.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-3 h-[36px] rounded-[var(--radius-button)] text-white font-medium text-sm transition-colors duration-100 disabled:opacity-60 hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {loading
              ? (isRegister ? t('auth.registering') : t('auth.logging_in'))
              : (isRegister ? t('auth.register_button') : t('auth.login_button'))
            }
          </button>

        </form>

        <button
          type="button"
          onClick={onClose}
          className="w-full px-3 h-[34px] rounded-[var(--radius-button)] border border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-100 text-sm"
        >
          {t('auth.cancel')}
        </button>

      </div>
    </DetailsModal>
  )
}
