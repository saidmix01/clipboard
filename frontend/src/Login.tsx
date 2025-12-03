import { useState } from 'react'
import DetailsModal from './components/DetailsModal'

type LoginModalProps = {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (token: string) => void
  isDarkMode: boolean
  mode?: 'login' | 'register'
  onGlobalLoading?: (loading: boolean) => void
}

export default function LoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
  isDarkMode,
  mode = 'login',
  onGlobalLoading
}: LoginModalProps) {
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
          setError('Completa todos los campos')
          setLoading(false)
          if (onGlobalLoading) onGlobalLoading(false)
          return
        }
      } else {
        if (!emailTrim || !passTrim) {
          setError('Completa todos los campos')
          setLoading(false)
          if (onGlobalLoading) onGlobalLoading(false)
          return
        }
      }

      if (passTrim.length < 8) {
        setError('La contraseña debe tener al menos 8 caracteres')
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
        setError((data && (data.message || data.msg)) || (mode === 'login' ? 'Error en login' : 'Error en registro'))
      } else {
        try {
          const session: any = {
            token: tokenResp,
            refreshToken: refreshResp,
            email: (userResp?.email ?? emailTrim),
            name: (userResp?.name ?? (mode === 'register' ? nameTrim : undefined)),
            user: userResp
          }
          localStorage.setItem('session', JSON.stringify(session))
        } catch {}
        onLoginSuccess(tokenResp)
        onClose()
      }
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
      if (onGlobalLoading) onGlobalLoading(false)
    }
  }

  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="space-y-3">
        <h3 className="m-0 text-[color:var(--color-text)]">{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h3>
        <form onSubmit={handleSubmit} className="space-y-2">
          {mode === 'register' && (
            <input type='text' placeholder='Nombre' value={name} onChange={e => setName(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          )}
          <input type='email' placeholder='Correo' value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          <input type='password' placeholder='Contraseña' value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
          <button type='submit' disabled={loading} className="w-full px-3 py-2 rounded-md text-white" style={{ backgroundColor: 'var(--color-primary)', opacity: loading ? 0.7 : 1 }}>{loading ? (mode === 'login' ? 'Ingresando...' : 'Registrando...') : (mode === 'login' ? 'Ingresar' : 'Registrarse')}</button>
          {error && <p className="text-sm" style={{ color: 'var(--color-accent)' }}>{error}</p>}
        </form>
        <button onClick={onClose} className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">Cancelar</button>
      </div>
    </DetailsModal>
  )
}
import { API_BASE } from './config'
