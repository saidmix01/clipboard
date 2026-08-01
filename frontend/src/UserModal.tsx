import { useEffect, useState, useRef } from 'react'
import { API_BASE } from './config'
import DetailsModal from './components/DetailsModal'
import { useTranslation } from 'react-i18next'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { backendRequest } from './api/backend'

type UserModalProps = {
  isOpen: boolean
  onClose: () => void
  onBack?: () => void
}

type Session = {
  token?: string
  refreshToken?: string
  email?: string
  name?: string
  user?: any
}

export default function UserModal({ isOpen, onClose, onBack }: UserModalProps) {
  const { t } = useTranslation()
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
      // No need to get token manually, backendRequest handles it via Main process
      
      const body: any = {}
      if (nameDraft) body.name = nameDraft
      if (newPassword && newPassword === confirmPassword && newPassword.length >= 8) {
        body.password = newPassword
      }

      if (Object.keys(body).length > 0) {
        await backendRequest('/users/me', 'PUT', body)
      }

      if (avatarFile) {
        // Convertir el archivo a base64 para enviarlo via IPC (FormData no se serializa bien en IPC)
        const reader = new FileReader()
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(avatarFile)
        })
        
        await backendRequest('/users/me/avatar', 'POST', {
          avatar: base64,
          mimeType: avatarFile.type,
          fileName: avatarFile.name
        })
      }

      // Refresh user data
      const userData: any = await backendRequest('/users/me')
      const payload = (userData && typeof userData === 'object' ? (userData.data ?? userData) : {}) as any
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
      setError(t('user.error_update'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    ;(async () => {
      try {
        const sessionStr = await (window as any).electronAPI?.getConfig?.('session')
        if (sessionStr) {
          try {
            const s = JSON.parse(sessionStr)
            setSession(s)
          } catch {
            setSession(null)
          }
        } else {
          setSession(null)
        }
      } catch {
        setSession(null)
      }
      try {
        setError(null)
        const userData: any = await backendRequest('/users/me')
        const payload = (userData && typeof userData === 'object' ? (userData.data ?? userData) : {}) as any
        const u = payload?.user
        if (u) {
          setUser(u)
          setNameDraft(u.name || '')
        }
      } catch (e: any) {
        setError(t('user.error_load'))
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
          <button onClick={() => { if (onBack) onBack(); else onClose(); }} className="p-1 rounded-full hover:text-white transition-colors" onMouseEnter={MouseOver} onMouseLeave={MouseOut} title={t('user.back')}>
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <h3 className="m-0">{t('user.title')}</h3>
        </div>
        {!session ? (
          <p className="mt-1 text-[color:var(--color-muted)]">{t('user.not_authenticated')}</p>
        ) : (
          <div className="grid gap-3">
            <div>
              <div className="text-sm opacity-80 mb-1">{t('user.name_label')}</div>
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="w-4/5 mx-auto block px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
            </div>
            <div>
              <div className="text-sm opacity-80 mb-1">{t('user.password_label')}</div>
              <input type="password" placeholder={t('user.new_password_placeholder')} value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-4/5 mx-auto block mb-2 px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
              <input type="password" placeholder={t('user.confirm_password_placeholder')} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-4/5 mx-auto block px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]" />
            </div>
            <div>
              <div className="text-sm opacity-80 mb-1">{t('user.avatar_label')}</div>
              <div className="flex items-center gap-3">
                <div className="w-24 h-24 rounded-full overflow-hidden border" style={{ borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-soft)' }}>
                  {preview && !avatarError ? (
                    <img src={preview || ''} alt="avatar" className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>—</div>
                  )}
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <div className="text-center cursor-pointer px-3 py-2 rounded-md border border-dashed" style={{ borderColor: 'var(--color-border)' }} onClick={() => fileInputRef.current?.click()}>{t('user.choose_image')}</div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files?.[0] || null)} className="hidden" />
                  <div className="text-xs opacity-70">{avatarFile?.name || t('user.no_file_selected')}</div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-2 items-center justify-between">
          {error && <span className="text-sm" style={{ color: 'var(--color-accent)' }}>{error}</span>}
          <div className="flex gap-2">
            <button onClick={updateAll} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]" disabled={loading || (!nameDraft && !avatarFile && !(newPassword && newPassword === confirmPassword && newPassword.length >= 8))}>{t('user.update')}</button>
            <button onClick={onClose} className="px-3 py-2 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]">{t('user.close')}</button>
          </div>
        </div>
      </div>
    </DetailsModal>
  )
}

