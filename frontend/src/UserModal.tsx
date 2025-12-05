import { useEffect, useState, useRef } from 'react'
import { API_BASE } from './config'
import DetailsModal from './components/DetailsModal'

type UserModalProps = {
  isOpen: boolean
  onClose: () => void
}

type Session = {
  token?: string
  refreshToken?: string
  email?: string
  name?: string
  user?: any
}

export default function UserModal({ isOpen, onClose }: UserModalProps) {
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

  

  

  return (
    <DetailsModal open={isOpen} onClose={onClose}>
      <div className="space-y-3">
        <h3 className="m-0">Datos del usuario</h3>
        {!session ? (
          <p className="mt-1 text-[color:var(--color-muted)]">No autenticado</p>
        ) : (
          <div className="grid gap-3">
            <div>
              <div className="text-sm opacity-80 mb-1">Nombre</div>
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="w-4/5 mx-auto block px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
            </div>
            <div>
              <div className="text-sm opacity-80 mb-1">Contraseña</div>
              <input type="password" placeholder="Nueva contraseña" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-4/5 mx-auto block mb-2 px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
              <input type="password" placeholder="Confirmar contraseña" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-4/5 mx-auto block px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
            </div>
            <div>
              <div className="text-sm opacity-80 mb-1">Avatar</div>
              <div className="flex items-center gap-3">
                <div className="w-24 h-24 rounded-full overflow-hidden border" style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-soft)' }}>
                  {preview && !avatarError ? (
                    <img src={preview || ''} alt="avatar" className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>—</div>
                  )}
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <div className="text-center cursor-pointer px-3 py-2 rounded-md border border-dashed" style={{ borderColor: 'var(--color-border)' }} onClick={() => fileInputRef.current?.click()}>Elegir imagen</div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files?.[0] || null)} className="hidden" />
                  <div className="text-xs opacity-70">{avatarFile?.name || 'Ningún archivo seleccionado'}</div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-2 items-center justify-between">
          {error && <span className="text-sm" style={{ color: 'var(--color-accent)' }}>{error}</span>}
          <div className="flex gap-2">
            <button onClick={updateAll} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]" disabled={loading || (!nameDraft && !avatarFile && !(newPassword && newPassword === confirmPassword && newPassword.length >= 8))}>Actualizar</button>
            <button onClick={onClose} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">Cerrar</button>
          </div>
        </div>
      </div>
    </DetailsModal>
  )
}

