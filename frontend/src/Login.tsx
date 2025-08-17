import { useState } from 'react'

type LoginModalProps = {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (token: string) => void
  isDarkMode: boolean
}

export default function LoginModal({
  isOpen,
  onClose,
  onLoginSuccess,
  isDarkMode
}: LoginModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await res.json()
      
      if (!res.ok) {
        setError(data.msg || 'Error en login')
      } else {
        onLoginSuccess(data.token)
        onClose()
      }
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
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
        backgroundColor: 'rgba(0,0,0,0.5)',
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
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
        }}
      >
        <h3 style={{ color: isDarkMode ? '#f5f5f5' : '#000' }}>Iniciar sesión</h3>
        <form onSubmit={handleSubmit}>
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
            {loading ? 'Ingresando...' : 'Ingresar'}
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
