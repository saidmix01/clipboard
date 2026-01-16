import { useState } from 'react'
import DetailsModal from './components/DetailsModal'
import { useTranslation } from 'react-i18next'
import { API_BASE } from './config'

type LoginModalProps = {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (token: string) => void
  mode?: 'login' | 'register'
  onGlobalLoading?: (loading: boolean) => void
}

export default function LoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
  mode = 'login',
  onGlobalLoading
}: LoginModalProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    if (onGlobalLoading) onGlobalLoading(true)

    try {
      const emailTrim = email.trim()
      const passTrim = password.trim()
      const nameTrim = name.trim()

      if (mode === 'register') {
        if (!emailTrim || !passTrim || !nameTrim) {
          setError(t('auth.error_all_fields'))
          setLoading(false)
          if (onGlobalLoading) onGlobalLoading(false)
          return
        }
      } else {
        if (!emailTrim || !passTrim) {
          setError(t('auth.error_all_fields'))
          setLoading(false)
          if (onGlobalLoading) onGlobalLoading(false)
          return
        }
      }

      if (passTrim.length < 8) {
        setError(t('auth.error_password_length'))
        setLoading(false)
        if (onGlobalLoading) onGlobalLoading(false)
        return
      }
      const url =
        mode === 'login'
          ? `${API_BASE}/auth/login`
          : `${API_BASE}/auth/register`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'login'
            ? { email: emailTrim, password: passTrim }
            : { email: emailTrim, password: passTrim, name: nameTrim }
        )
      })
      const data = await res.json()
      const success = res.ok
      const payload = (typeof data === 'object' ? (data.data ?? data) : {}) as any
      const tokenResp = payload?.token
      const refreshResp = payload?.refreshToken
      const userResp = payload?.user

      if (!success || !tokenResp) {
        setError((data && (data.message || data.msg)) || (mode === 'login' ? t('auth.error_login') : t('auth.error_register')))
      } else {
        try {
          const session: any = {
            token: tokenResp,
            refreshToken: refreshResp || null,
            email: (userResp?.email ?? emailTrim),
            name: (userResp?.name ?? (mode === 'register' ? nameTrim : undefined)),
            user: userResp
          }
          
          // Validar que el refreshToken existe antes de guardar
          if (!session.refreshToken) {
            console.warn('Advertencia: No se recibió refreshToken en la respuesta del servidor', {
              hasRefreshToken: !!refreshResp,
              payloadKeys: Object.keys(payload || {}),
              dataKeys: Object.keys(data || {})
            })
          }
          
          await (window as any).electronAPI?.setConfig?.('session', JSON.stringify(session))
          await (window as any).electronAPI?.saveSession?.(session)
        } catch (e) {
          console.error('Error al guardar sesión:', e)
        }
        onLoginSuccess(tokenResp)
        onClose()
      }
    } catch {
      setError(t('auth.error_connection'))
    } finally {
      setLoading(false)
      if (onGlobalLoading) onGlobalLoading(false)
    }
  }

  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="space-y-3">
        <h3 className="m-0 text-[color:var(--color-text)]">{mode === 'login' ? t('auth.login_title') : t('auth.register_title')}</h3>
        <form onSubmit={handleSubmit} className="space-y-2">
          {mode === 'register' && (
            <input type='text' placeholder={t('auth.name_placeholder')} value={name} onChange={e => setName(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          )}
          <input type='email' placeholder={t('auth.email_placeholder')} value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          <input type='password' placeholder={t('auth.password_placeholder')} value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          {mode === 'login' && (
            <div className="w-full text-right">
              <a
                href="https://copyfy.lat/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[color:var(--color-primary)] hover:underline"
                onClick={(e) => { e.preventDefault(); try { (window as any).electronAPI?.openExternalUrl?.('https://copyfy.lat/') } catch {} }}
              >
                {t('auth.recover_password')}
              </a>
            </div>
          )}
          <button type='submit' disabled={loading} className="w-full px-3 py-2 rounded-md text-white" style={{ backgroundColor: 'var(--color-primary)', opacity: loading ? 0.7 : 1 }}>{loading ? (mode === 'login' ? t('auth.logging_in') : t('auth.registering')) : (mode === 'login' ? t('auth.login_button') : t('auth.register_button'))}</button>
          {error && <p className="text-sm" style={{ color: 'var(--color-accent)' }}>{error}</p>}
        </form>
        <button onClick={onClose} className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">{t('auth.cancel')}</button>
      </div>
    </DetailsModal>
  )
}
