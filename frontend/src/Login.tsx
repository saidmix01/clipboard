import { useState } from 'react'
import DetailsModal from './components/DetailsModal'
import { useTranslation } from 'react-i18next'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { API_BASE } from './config'

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

      // Real login
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: emailTrim,
            password: passTrim
        })
      })

      if (!response.ok) {
        throw new Error('Login failed')
      }

      const data = await response.json()

      if (data.success && data.data && data.data.token) {
        const { user, token, refreshToken } = data.data
        
        const session: any = {
          token: token,
          refreshToken: refreshToken,
          email: user.email,
          name: user.name,
          user: user
        }
        
        await (window as any).electronAPI?.setConfig?.('session', JSON.stringify(session))
        await (window as any).electronAPI?.saveSession?.(session)
        await (window as any).electronAPI?.setConfig?.('x-token', token)
        
        onLoginSuccess(token, user)
        
        // Notify backend to start sync
        try {
            await (window as any).electronAPI?.notifyLoginSuccess?.()
        } catch (e) {
            console.error('Failed to notify login success', e)
        }

        onClose()
      } else {
        console.error('Login failed data check:', data)
        setError(t('auth.error_credentials') || 'Invalid credentials')
      }

      setLoading(false)
      if (onGlobalLoading) onGlobalLoading(false)

    } catch (e) {
      console.error('Login exception:', e)
      setError(t('auth.error_credentials') || 'Invalid credentials')
      setLoading(false)
      if (onGlobalLoading) onGlobalLoading(false)
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
          <button onClick={() => { if (onBack) onBack(); else onClose(); }} className="p-1 rounded-full hover:text-white transition-colors" onMouseEnter={MouseOver} onMouseLeave={MouseOut} title={t('auth.back')}>
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <h3 className="m-0 text-[color:var(--color-text)]">{mode === 'login' ? t('auth.login_title') : t('auth.register_title')}</h3>
        </div>
        <form onSubmit={handleSubmit} className="space-y-2">
          {mode === 'register' && (
            <input type='text' placeholder={t('auth.name_placeholder')} value={name} onChange={e => setName(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          )}
          <input type='email' placeholder={t('auth.email_placeholder')} value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          <input type='password' placeholder={t('auth.password_placeholder')} value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          
          <button type='submit' disabled={loading} className="w-full px-3 py-2 rounded-md text-white" style={{ backgroundColor: 'var(--color-primary)', opacity: loading ? 0.7 : 1 }}>{loading ? (mode === 'login' ? t('auth.logging_in') : t('auth.registering')) : (mode === 'login' ? t('auth.login_button') : t('auth.register_button'))}</button>
          {error && <p className="text-sm" style={{ color: 'var(--color-accent)' }}>{error}</p>}
        </form>
        <button onClick={onClose} className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">{t('auth.cancel')}</button>
      </div>
    </DetailsModal>
  )
}
