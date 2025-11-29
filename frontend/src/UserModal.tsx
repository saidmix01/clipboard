import { useEffect, useState, useRef } from 'react'
import { API_BASE } from './config'

type UserModalProps = {
  isOpen: boolean
  onClose: () => void
  isDarkMode: boolean
}

type Session = {
  token?: string
  refreshToken?: string
  email?: string
  name?: string
  user?: any
}

export default function UserModal({ isOpen, onClose, isDarkMode }: UserModalProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<any>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [avatarError, setAvatarError] = useState<boolean>(false)
  
  const updateAll = async () => {
    try {
      setLoading(true)
      setError(null)
      const token = localStorage.getItem('x-token') || (session as any)?.token
      if (!token) return

      const body: any = {}
      if (nameDraft) body.name = nameDraft
      if (newPassword && newPassword === confirmPassword && newPassword.length >= 8) {
        body.password = newPassword
      }

      if (Object.keys(body).length > 0) {
        await fetch(`${API_BASE}/users/me`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })
      }

      if (avatarFile) {
        const fd = new FormData()
        fd.append('avatar', avatarFile)
        await fetch(`${API_BASE}/users/me/avatar`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        })
      }

      const res = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      const payload = (data && typeof data === 'object' ? (data.data ?? data) : {}) as any
      const u = payload?.user
      if (u) {
        setUser(u)
        setNameDraft(u.name || '')
        setAvatarFile(null)
        setPreview(u.avatarUrl || null)
      }
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      setError('No se pudo actualizar la información')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    try {
      const raw = localStorage.getItem('session')
      if (raw) {
        const s = JSON.parse(raw)
        setSession(s)
      } else {
        setSession(null)
      }
    } catch {
      setSession(null)
    }
    ;(async () => {
      try {
        setError(null)
        const token = localStorage.getItem('x-token') || (session as any)?.token
        if (!token) return
        const res = await fetch(`${API_BASE}/users/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const data = await res.json()
        const payload = (data && typeof data === 'object' ? (data.data ?? data) : {}) as any
        const u = payload?.user
        if (u) {
          setUser(u)
          setNameDraft(u.name || '')
        }
      } catch (e: any) {
        setError('No se pudo cargar el usuario')
      }
    })()
  }, [isOpen])

  useEffect(() => {
    if (avatarFile) {
      const url = URL.createObjectURL(avatarFile)
      setPreview(url)
      setAvatarError(false)
      return () => URL.revokeObjectURL(url)
    } else {
      const src = user?.avatarUrl as string | undefined
      const resolve = (s?: string | null): string | null => {
        if (!s) return null
        let v = String(s)
        v = v.replace(/\\/g, '/')
        if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v
        if (v.startsWith('localhost:') || v.startsWith('127.0.0.1:')) return `http://${v}`
        if (v.startsWith('/')) return `${API_BASE}${v}`
        if (v.startsWith('uploads/')) return `${API_BASE}/${v}`
        if (v.includes('/uploads/')) return `${API_BASE}${v.substring(v.indexOf('/uploads/'))}`
        return `${API_BASE}/uploads/${v}`
      }
      const url = resolve(src)
      setPreview(url)
      setAvatarError(false)
    }
  }, [avatarFile, user])

  if (!isOpen) return null

  const labelStyle: React.CSSProperties = {
    fontSize: '0.85rem',
    opacity: 0.8,
    marginBottom: 4
  }

  const fieldStyle: React.CSSProperties = {
    padding: '8px',
    borderRadius: 6,
    border: isDarkMode ? '1px solid #444' : '1px solid #ccc',
    backgroundColor: isDarkMode ? '#2c2c2c' : '#fff',
    transition: 'background-color .2s ease, color .2s ease, border-color .2s ease'
  }

  

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
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
          backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
          color: isDarkMode ? '#f5f5f5' : '#000',
          padding: 20,
          borderRadius: 8,
          width: '92%',
          maxWidth: 420,
          boxShadow: isDarkMode ? '0 2px 14px rgba(0,0,0,0.45)' : '0 2px 10px rgba(0,0,0,0.3)',
          maxHeight: '90vh',
          overflowY: 'auto',
          transition: 'background-color .2s ease, color .2s ease, box-shadow .2s ease'
        }}
      >
        <h3 style={{ marginTop: 0 }}>Datos del usuario</h3>
        {!session ? (
          <p style={{ marginTop: 8 }}>No autenticado</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={labelStyle}>Nombre</div>
              <input
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                style={{ ...fieldStyle, width: '80%', margin: '0 auto', display: 'block' }}
              />
              
            </div>
            <div>
              <div style={labelStyle}>Contraseña</div>
              <input
                type="password"
                placeholder="Nueva contraseña"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                style={{ ...fieldStyle, width: '80%', margin: '0 auto 8px', display: 'block' }}
              />
              <input
                type="password"
                placeholder="Confirmar contraseña"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={{ ...fieldStyle, width: '80%', margin: '0 auto', display: 'block' }}
              />
              
            </div>
            <div>
              <div style={labelStyle}>Avatar</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', border: isDarkMode ? '2px solid #444' : '2px solid #ddd', boxShadow: '0 6px 14px rgba(0,0,0,0.25)', position: 'relative' }}>
                  {preview && !avatarError ? (
                    <img src={preview} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setAvatarError(true)} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDarkMode ? '#2c2c2c' : '#f2f2f2' }}>—</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexGrow: 1 }}>
                  <div
                    style={{ border: isDarkMode ? '1px dashed #555' : '1px dashed #999', borderRadius: 8, padding: 10, textAlign: 'center', cursor: 'pointer' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Elegir imagen
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={e => setAvatarFile(e.target.files?.[0] || null)}
                    style={{ display: 'none' }}
                  />
                  <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                    {avatarFile?.name || 'Ningún archivo seleccionado'}
                  </div>
                  
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between', alignItems: 'center' }}>
          {error && <span style={{ color: 'red' }}>{error}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={updateAll}
              className={isDarkMode ? 'btn btn-sm btn-outline-success' : 'btn btn-sm btn-outline-primary'}
              disabled={loading || (!nameDraft && !avatarFile && !(newPassword && newPassword === confirmPassword && newPassword.length >= 8))}
            >
              Actualizar
            </button>
          <button
            onClick={onClose}
            className={isDarkMode ? 'btn btn-sm btn-outline-light' : 'btn btn-sm btn-outline-dark'}
          >
            Cerrar
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}

