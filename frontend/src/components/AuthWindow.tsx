import { useState, useEffect } from 'react'
import { XMarkIcon, EnvelopeIcon, LockClosedIcon, UserIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { notifySuccess } from '../utils/notify'
import logo from '../../media/64x64.png'

export default function AuthWindow() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isRegister = mode === 'register'

  useEffect(() => {
    const load = async () => {
      const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
      document.documentElement.setAttribute('data-theme', stored === 'true' ? 'dark' : 'light')
    }
    load()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const emailTrim = email.trim()
      const passTrim = password.trim()
      const nameTrim = name.trim()

      if (isRegister) {
        if (!nameTrim || !emailTrim || !passTrim) { setError(t('auth.error_all_fields', 'Complete all fields')); return }
        if (passTrim.length < 8) { setError(t('auth.error_password_length', 'Password must be at least 8 characters')); return }
        if (passTrim !== confirmPassword.trim()) { setError(t('auth.error_password_mismatch', 'Passwords do not match')); return }
      } else {
        if (!emailTrim || !passTrim) { setError(t('auth.error_all_fields', 'Complete all fields')); return }
      }

      const endpoint = isRegister ? '/auth/register' : '/auth/login'
      const requestBody = isRegister
        ? { email: emailTrim, password: passTrim, name: nameTrim }
        : { email: emailTrim, password: passTrim }

      const response = await (window as any).electronAPI?.backend?.request({ url: endpoint, method: 'POST', data: requestBody })

      if (!response || !response.success) {
        const serverErrors = response?.data?.errors
        const firstError = Array.isArray(serverErrors) && serverErrors.length > 0 ? serverErrors[0].msg : null
        const serverMsg = firstError || response?.data?.message || response?.error
        throw Object.assign(new Error(serverMsg || 'Request failed'), { status: response?.status })
      }

      const serverData = response.data
      const payload = serverData?.data ?? serverData
      const { user, token, refreshToken } = payload ?? {}

      if (token) {
        await (window as any).electronAPI?.setConfig?.('session', JSON.stringify({ token, refreshToken, email: user?.email, name: user?.name, user }))
        try { await (window as any).electronAPI?.notifyLoginSuccess?.() } catch {}
        notifySuccess(isRegister ? t('auth.register_success', 'Account created') : t('auth.login_success', 'Signed in'))
        setTimeout(() => (window as any).electronAPI?.closeWindow?.(), 800)
      } else {
        setError(isRegister ? t('auth.error_register', 'Registration error') : t('auth.error_credentials', 'Invalid credentials'))
      }
    } catch (e: any) {
      const msg = e?.message || ''
      if (msg.includes('409') || msg.toLowerCase().includes('already') || e?.status === 409) {
        setError(t('auth.error_email_exists', 'Email is already registered'))
      } else if (msg.includes('401') || e?.status === 401) {
        setError(t('auth.error_credentials', 'Invalid credentials'))
      } else {
        setError(msg || t('auth.error_connection', 'Connection error'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-screen h-screen bg-zinc-50 dark:bg-neutral-900 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">

      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 drag_region shrink-0">
        <div className="flex items-center gap-2 no_drag">
          <img src={logo} alt="CopyFy" className="w-4 h-4 rounded-sm" />
          <span className="text-xs font-medium">{isRegister ? t('auth.register_title', 'Create Account') : t('auth.login_title', 'Log In')}</span>
        </div>
        <button onClick={() => (window as any).electronAPI?.closeWindow?.()} className="p-1 rounded text-zinc-400 hover:text-white hover:bg-red-500 transition-colors no_drag" aria-label="Close">
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col justify-center px-6 py-4">
        <p className="text-xs text-zinc-500 text-center mb-5">
          {isRegister ? t('auth.register_subtitle', 'Create your account to sync') : t('auth.login_subtitle', 'Sign in to sync')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-2.5">
          {isRegister && (
            <InputField icon={<UserIcon className="w-4 h-4" />} type="text" placeholder={t('auth.name_placeholder', 'Name')} value={name} onChange={setName} />
          )}
          <InputField icon={<EnvelopeIcon className="w-4 h-4" />} type="email" placeholder={t('auth.email_placeholder', 'Email')} value={email} onChange={setEmail} />
          <InputField icon={<LockClosedIcon className="w-4 h-4" />} type="password" placeholder={t('auth.password_placeholder', 'Password')} value={password} onChange={setPassword} />
          {isRegister && (
            <InputField icon={<LockClosedIcon className="w-4 h-4" />} type="password" placeholder={t('auth.confirm_password_placeholder', 'Confirm password')} value={confirmPassword} onChange={setConfirmPassword} />
          )}

          {error && <p className="text-xs text-red-500 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? '...' : isRegister ? t('auth.register_button', 'Create Account') : t('auth.login_button', 'Log In')}
          </button>
        </form>

        <button
          onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(null) }}
          className="mt-4 text-xs text-indigo-500 hover:text-indigo-600 text-center w-full"
        >
          {isRegister ? t('auth.have_account', 'Already have an account? Sign in') : t('auth.no_account', "Don't have an account? Register")}
        </button>
      </div>
    </div>
  )
}

function InputField({ icon, type, placeholder, value, onChange }: { icon: React.ReactNode; type: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 focus-within:border-indigo-400 transition-colors">
      <span className="text-zinc-400 shrink-0">{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-zinc-400"
      />
    </div>
  )
}
