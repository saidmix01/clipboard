import { useState } from 'react'

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
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: isDarkMode ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: isDarkMode ? '#1e1e1e' : 'white',
          color: isDarkMode ? '#f5f5f5' : '#000',
          padding: 20,
          borderRadius: 8,
          width: '90%',
          maxWidth: 320,
          boxShadow: isDarkMode ? '0 2px 14px rgba(0,0,0,0.45)' : '0 2px 10px rgba(0,0,0,0.3)',
          transition: 'background-color .2s ease, color .2s ease, box-shadow .2s ease'
        }}
      >
        <h3 style={{ color: isDarkMode ? '#f5f5f5' : '#000' }}>
          {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </h3>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <input
              type='text'
              placeholder='Nombre'
              value={name}
              onChange={e => setName(e.target.value)}
              required
              style={{
                width: '100%',
                marginBottom: 10,
                padding: 8,
                backgroundColor: isDarkMode ? '#2c2c2c' : '#fff',
                color: isDarkMode ? '#f5f5f5' : '#000',
                border: '1px solid #ccc',
                boxSizing: 'border-box'
              }}
            />
          )}
          <input
            type='email'
            placeholder='Correo'
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              marginBottom: 10,
              padding: 8,
              backgroundColor: isDarkMode ? '#2c2c2c' : '#fff',
              color: isDarkMode ? '#f5f5f5' : '#000',
              border: '1px solid #ccc',
              boxSizing: 'border-box'
            }}
          />
          <input
            type='password'
            placeholder='Contraseña'
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              width: '100%',
              marginBottom: 10,
              padding: 8,
              backgroundColor: isDarkMode ? '#2c2c2c' : '#fff',
              color: isDarkMode ? '#f5f5f5' : '#000',
              border: '1px solid #ccc',
              boxSizing: 'border-box'
            }}
          />
          <button
            type='submit'
            disabled={loading}
            style={{
              width: '100%',
              padding: 10,
              cursor: loading ? 'not-allowed' : 'pointer',
              backgroundColor: isDarkMode ? '#444' : '#007bff',
              color: isDarkMode ? '#f5f5f5' : '#fff',
              border: 'none',
              borderRadius: 4
            }}
          >
            {loading
              ? mode === 'login'
                ? 'Ingresando...'
                : 'Registrando...'
              : mode === 'login'
                ? 'Ingresar'
                : 'Registrarse'}
          </button>
          {error && <p style={{ color: 'red', marginTop: 10 }}>{error}</p>}
        </form>
        <button
          onClick={onClose}
          style={{
            marginTop: 15,
            width: '100%',
            backgroundColor: isDarkMode ? '#555' : '#ddd',
            color: isDarkMode ? '#f5f5f5' : '#000',
            padding: 10,
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
import { API_BASE } from './config'
