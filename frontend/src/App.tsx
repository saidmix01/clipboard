import { useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { motion } from 'framer-motion'
import LoginModal from './Login'
import UserModal from './UserModal'
import DeviceSwitchModal from './DeviceSwitchModal'
import { API_BASE } from './config'
import AppShell from './components/AppShell'
import TopBar from './components/TopBar'
import Dock from './components/Dock'
import HistoryList from './components/HistoryList'
import FileList from './components/FileList'
// filtros movidos a la barra inferior
import SearchQuickSwitcher from './components/SearchQuickSwitcher'
import SettingsMenu from './components/SettingsMenu'
import AboutModal from './components/AboutModal'
import OnboardingTour from './components/OnboardingTour'
import ContextMenu from './components/ContextMenu'
import DeleteModal from './components/DeleteModal'
import type { HistoryItem, FilterType } from './types'


// tipos movidos a ./types

const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

function App () {
  const [filter, setFilter] = useState<FilterType>('all')
  const [displayed, setDisplayed] = useState<HistoryItem[]>([])
  const [listLoading, setListLoading] = useState<boolean>(false)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [syncPct, setSyncPct] = useState<number>(0)
  const [downloading, setDownloading] = useState<boolean>(false)
  const [downloadPct, setDownloadPct] = useState<number>(0)
  const [downloadFileName, setDownloadFileName] = useState<string>('')
  const [downloadBytes, setDownloadBytes] = useState<number>(0)
  const [downloadTotal, setDownloadTotal] = useState<number>(0)
  const [, setHistory] = useState<HistoryItem[]>([])
  const [search, setSearch] = useState<string>('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchLocked, setSearchLocked] = useState<boolean>(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)

  const logout = () => {
    setToken(null)
    localStorage.removeItem('x-token')
    localStorage.removeItem('session')
    try { localStorage.removeItem('clientId') } catch {}
    ;(window as any).electronAPI?.setAuthToken?.('')
    try { (window as any).electronAPI?.clearUserData?.() } catch {}
    toast.success('Sesión cerrada')
  }

  async function refreshAuthToken () {
    try {
      const raw = localStorage.getItem('session')
      if (!raw) return false
      const sess = JSON.parse(raw)
      const rt = sess?.refreshToken
      if (!rt) return false
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt })
      })
      const data = await res.json()
      const payload = (data && typeof data === 'object' ? (data.data ?? data) : {}) as any
      const okFlag = (data && typeof data === 'object') ? (data.success ?? data.status) : undefined
      const newToken = payload?.token
      const newRefresh = payload?.refreshToken
      if ((okFlag ?? res.ok) && newToken) {
        handleLoginSuccess(newToken)
        const newSession = { ...sess, token: newToken, refreshToken: newRefresh || rt }
        localStorage.setItem('session', JSON.stringify(newSession))
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const handleLoginSuccess = (newToken: string) => {
    setToken(newToken)
    localStorage.setItem('x-token', newToken)

    if ((window as any).electronAPI?.setAuthToken) {
      ;(window as any).electronAPI?.setAuthToken(newToken)
    }

    try {
      setTimeout(() => {
        ;(window as any).electronAPI?.registerDevice?.('')
      }, 200)
    } catch {}
  }

  // Ref para el contenedor scrollable y para cada item
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const [files, setFiles] = useState<any[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ usedBytes: number, availableBytes: number, quotaBytes: number } | null>(null)
  const [filesPage, setFilesPage] = useState<number>(1)
  const [filesLimit, setFilesLimit] = useState<number>(50)
  const [filesTotal, setFilesTotal] = useState<number>(0)
  
  // Ref para mantener el valor actual de filesLimit en callbacks
  const filesLimitRef = useRef(filesLimit)
  filesLimitRef.current = filesLimit

  const loadFiles = useCallback(async (page: number = 1, limit: number = 50) => {
     if (!token) {
        return
     }
     setFilesLoading(true)
     try {
        if (!(window as any).electronAPI?.listFiles) {
           setFiles([])
           return
        }
        
        const res = await (window as any).electronAPI.listFiles({ 
          page, 
          limit 
        })
        
        // Manejar la nueva estructura de respuesta con paginación
        let items = []
        let total = 0
        let responsePage = page
        let responseLimit = limit
        
        if (res?.success && res?.data) {
          // Nueva estructura: { success: true, data: { items, page, limit, total, storage } }
          if (Array.isArray(res.data.items)) {
            items = res.data.items
          }
          total = typeof res.data.total === 'number' ? res.data.total : 0
          responsePage = typeof res.data.page === 'number' ? res.data.page : page
          responseLimit = typeof res.data.limit === 'number' ? res.data.limit : limit
          
          // Extraer info de storage
          if (res.data.storage) {
            setStorageInfo(res.data.storage)
          }
        } else {
          // Soporte para estructura anterior (backward compatibility)
          if (res?.data?.items && Array.isArray(res.data.items)) {
            items = res.data.items
          } else if (res?.items && Array.isArray(res.items)) {
            items = res.items
          } else if (Array.isArray(res?.data)) {
            items = res.data
          }
          
          if (res?.data?.storage) {
            setStorageInfo(res.data.storage)
          } else if (res?.storage) {
            setStorageInfo(res.storage)
          }
        }
        
        setFiles(items)
        setFilesTotal(total)
        setFilesPage(responsePage)
        setFilesLimit(responseLimit)
     } catch (err) {
        setFiles([])
        setFilesTotal(0)
     } finally {
        setFilesLoading(false)
     }
  }, [token])

  useEffect(() => {
    if (filter === 'documents') {
       setFilesPage(1) // Resetear a página 1 al cambiar a documentos
       loadFiles(1, filesLimitRef.current)
    }
  }, [filter, token, loadFiles])
  
  useEffect(() => {
    if ((window as any).electronAPI?.onFileUploaded) {
      const off = (window as any).electronAPI.onFileUploaded(() => {
         toast.success('Archivo subido')
         if (filter === 'documents') {
            // Recargar la primera página después de subir un archivo
            setFilesPage(1)
            loadFiles(1, filesLimitRef.current)
         }
      })
      return () => { try { off?.() } catch {} }
    }
  }, [filter, loadFiles])

  useEffect(() => {
    if ((window as any).electronAPI?.onFileUploadError) {
      const off = (window as any).electronAPI.onFileUploadError((err: any) => {
         const msg = err?.error || 'Error al subir archivo'
         // Mensaje para el usuario si no hay internet
         if (String(msg).includes('Network') || String(msg).includes('EAI_AGAIN') || String(msg).includes('ENOTFOUND')) {
            toast.error('No hay conexión a internet para subir el archivo')
         } else {
            toast.error(`Error al subir: ${msg}`)
         }
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])


  const highlightMatch = (
    text: string,
    query: string
  ): ReactNode[] | string => {
    if (!query) return text

    const regex = new RegExp(`(${query})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, idx) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={idx} className='bg-yellow-200 font-semibold rounded'>
          {part}
        </mark>
      ) : (
        <span key={idx}>{part}</span>
      )
    )
  }

  useEffect(() => {
    async function restoreSession () {
      try {
        const raw = localStorage.getItem('session')
        if (raw) {
          const sess = JSON.parse(raw)
          // Si hay refreshToken, intentar refrescar primero
          if (sess?.refreshToken) {
            const refreshed = await refreshAuthToken()
            if (refreshed) {
              // Si refreshAuthToken fue exitoso, handleLoginSuccess ya fue llamado
              return
            }
            // Si el refresh falla, intentar usar el token existente como fallback
            if (sess?.token) {
              handleLoginSuccess(sess.token)
              ;(window as any).electronAPI?.setAuthToken(sess.token)
              return
            }
          }
          // Si no hay refreshToken pero hay token, usarlo directamente
          if (sess?.token) {
            handleLoginSuccess(sess.token)
            ;(window as any).electronAPI?.setAuthToken(sess.token)
            return
          }
        }
      } catch (e) {
        // Si falla parsear session, intentar con x-token como fallback
      }
      // Fallback: usar x-token directamente
      const token = localStorage.getItem('x-token')
      if (token) {
        handleLoginSuccess(token)
        ;(window as any).electronAPI?.setAuthToken(token)
      }
    }
    restoreSession()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      refreshAuthToken()
    }, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    async function fetchAvatar() {
      try {
        
        if (!token) { setUserAvatar(null); return }
        const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        const payload: any = (data && typeof data === 'object' ? (data.data ?? data) : {})
        const u = payload?.user
        const src: string | undefined = u?.avatarUrl
        const resolve = (s?: string | null): string | null => {
          if (!s) return null
          let v = String(s).replace(/\\/g, '/')
          if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v
          if (v.startsWith('/')) return `${API_BASE}${v}`
          if (v.startsWith('uploads/')) return `${API_BASE}/${v}`
          if (v.includes('/uploads/')) return `${API_BASE}${v.substring(v.indexOf('/uploads/'))}`
          return `${API_BASE}/uploads/${v}`
        }
        setUserAvatar(resolve(src))
      } catch {
        setUserAvatar(null)
      }
    }
    fetchAvatar()
  }, [token])

  useEffect(() => {
    if (!showUserModal && token) {
      (async () => {
        try {
          
          const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
          const data = await res.json()
          const payload: any = (data && typeof data === 'object' ? (data.data ?? data) : {})
          const u = payload?.user
          const src: string | undefined = u?.avatarUrl
          const resolve = (s?: string | null): string | null => {
            if (!s) return null
            let v = String(s).replace(/\\/g, '/')
            if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v
            if (v.startsWith('/')) return `${API_BASE}${v}`
            if (v.startsWith('uploads/')) return `${API_BASE}/${v}`
            if (v.includes('/uploads/')) return `${API_BASE}${v.substring(v.indexOf('/uploads/'))}`
            return `${API_BASE}/uploads/${v}`
          }
          setUserAvatar(resolve(src))
        } catch {}
      })()
    }
  }, [showUserModal, token])


  useEffect(() => {
    if ((window as any).electronAPI?.onClipboardUpdate) {
      const off = (window as any).electronAPI.onClipboardUpdate((data: HistoryItem[]) => {
        setHistory(data)
        setFilter('all')
        if (!searchLocked) {
          setSearch('')
          if (Array.isArray(data)) {
            setDisplayed(data.slice(0, 50))
          }
        }
        setListLoading(false)
      })
      return () => { try { off?.() } catch {} }
    }
  }, [searchLocked])

  useEffect(() => {
    if ((window as any).electronAPI?.getClipboardHistory) {
      ;(window as any).electronAPI.getClipboardHistory().then((data: HistoryItem[]) => {
        if (Array.isArray(data)) setHistory(data)
      })
    }
  }, [])

  useEffect(() => {
    const escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ;(window as any).electronAPI?.hideWindow?.()
      }
    }
    window.addEventListener('keydown', escListener)
    return () => window.removeEventListener('keydown', escListener)
  }, [])

  useEffect(() => {
    function handleClickOutside (event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        ;(window as any).electronAPI?.hideWindow?.()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('darkMode')
    return stored === 'true'
  })

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString())
  }, [darkMode])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    try {
      ;(window as any).electronAPI?.getPreferences?.().then((prefs: any) => {
        if (prefs?.colorPrimary) {
          document.documentElement.style.setProperty('--color-primary', prefs.colorPrimary)
        }
        if (prefs?.colorSecondary) {
          document.documentElement.style.setProperty('--color-secondary', prefs.colorSecondary)
        }
        if (prefs?.colorBg) {
          document.documentElement.style.setProperty('--color-bg', prefs.colorBg)
        }
        if (prefs?.colorSurface) {
          document.documentElement.style.setProperty('--color-surface', prefs.colorSurface)
        }
        if (prefs?.colorText) {
          document.documentElement.style.setProperty('--color-text', prefs.colorText)
        }
        if (prefs?.fontSize) {
          document.documentElement.style.setProperty('--font-size-card', `${prefs.fontSize}px`)
        }
      })
    } catch {}
  }, [])

  const [appVersion, setAppVersion] = useState<string>('')
  const [showTour, setShowTour] = useState<boolean>(false)

  useEffect(() => {
    if ((window as any).electronAPI?.getAppVersion) {
      ;(window as any).electronAPI.getAppVersion().then(setAppVersion)
    }
  }, [])

  useEffect(() => {
    if ((window as any).electronAPI?.onSyncProgress) {
      const off = (window as any).electronAPI.onSyncProgress((data: any) => {
        try {
          const msg = (data && typeof data === 'object') ? String(data.message || '') : ''
          const pct = (data && typeof data === 'object') ? Number(data.percentage || 0) : 0
          setSyncing(pct > 0 && pct < 100)
          setSyncPct(pct)
          if (pct === 100) {
            if (msg.toLowerCase().includes('fallida')) {
              toast.error('Sincronización fallida')
            } else {
              toast.success('Sincronización completada')
            }
          }
        } catch {}
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])
  
  useEffect(() => {
    if ((window as any).electronAPI?.onDownloadProgress) {
      const off = (window as any).electronAPI.onDownloadProgress((data: any) => {
        try {
          if (data && typeof data === 'object') {
            const pct = Number(data.percentage || 0)
            const fileName = String(data.fileName || '')
            const downloaded = Number(data.downloaded || 0)
            const total = Number(data.total || 0)
            const error = data.error
            
            if (error) {
              setDownloading(false)
              setDownloadPct(0)
              setDownloadFileName('')
              setDownloadBytes(0)
              setDownloadTotal(0)
              toast.error(`Error al descargar: ${error}`)
            } else {
              setDownloadFileName(fileName)
              setDownloadPct(pct)
              setDownloadBytes(downloaded)
              setDownloadTotal(total)
              setDownloading(pct > 0 && pct < 100)
              
              if (pct === 100) {
                setTimeout(() => {
                  setDownloading(false)
                  setDownloadPct(0)
                  setDownloadFileName('')
                  setDownloadBytes(0)
                  setDownloadTotal(0)
                }, 1000)
              }
            }
          }
        } catch {}
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])
  useEffect(() => {
    if ((window as any).electronAPI?.onUpdateStatus) {
      const off = (window as any).electronAPI.onUpdateStatus((message: string) => {
        try {
          if (typeof message === 'string' && message.trim()) {
            toast(message)
          }
        } catch {}
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])

  useEffect(() => {
    if ((window as any).electronAPI?.onOpenTutorial) {
      const off = (window as any).electronAPI.onOpenTutorial(() => {
        try { setShowTour(true) } catch {}
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])

  useEffect(() => {
    async function checkFirstRun () {
      try {
        const prefs = await (window as any).electronAPI?.getPreferences?.()
        if (!prefs || prefs.firstRunGuideDone !== true) {
          setShowTour(true)
        }
      } catch {}
    }
    checkFirstRun()
  }, [])

  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [aboutOpen, setAboutOpen] = useState<boolean>(false)
  const [showDeviceSwitch, setShowDeviceSwitch] = useState<boolean>(false)
  const isQuick = (() => {
    try { return new URLSearchParams(window.location.search).get('quick') === '1' } catch { return false }
  })()
  const [quickOpen, setQuickOpen] = useState<boolean>(isQuick)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: HistoryItem } | null>(null)
  const [itemToDelete, setItemToDelete] = useState<HistoryItem | null>(null)
  const [deletingLoading, setDeletingLoading] = useState<boolean>(false)

  if (isQuick) {
    return (
      <>
        <SearchQuickSwitcher
          open={quickOpen}
          query={search}
          onQueryChange={setSearch}
          onClose={() => { try { window.close() } catch {}; setQuickOpen(false) }}
        />
      </>
    )
  }

  // Scroll automático cuando cambia selectedIndex
  useEffect(() => {
    const itemEl = itemRefs.current[selectedIndex]
    if (itemEl && itemEl.scrollIntoView) {
      itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [selectedIndex, displayed])

  useEffect(() => {
    const keyListener = (e: KeyboardEvent) => {
      if (displayed.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % displayed.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev <= 0 ? displayed.length - 1 : prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < displayed.length) {
          const item = displayed[selectedIndex]
          if (item.value.startsWith('data:image')) {
            ;(window as any).electronAPI?.copyImage?.(item.value)
            setTimeout(() => { ;(window as any).electronAPI.pasteImage() }, 300)
            toast.success('Imagen copiada al portapapeles')
          } else {
            ;(window as any).electronAPI?.copyText(item.value)
            setTimeout(() => { ;(window as any).electronAPI?.pasteText() }, 100)
            toast.success('Pegado automáticamente')
          }
          setTimeout(() => { ;(window as any).electronAPI?.hideWindow?.() }, 500)
        }
      }
    }
    window.addEventListener('keydown', keyListener)
    return () => window.removeEventListener('keydown', keyListener)
  }, [displayed, selectedIndex])

  useEffect(() => {
    if (isQuick) return
    const handler = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === 'k'
      const meta = e.ctrlKey || e.metaKey
      if (isK && meta) {
        e.preventDefault()
        try { (window as any).electronAPI?.openQuickSwitcher?.() } catch {}
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isQuick])

  useEffect(() => {
    if ((window as any).electronAPI?.onFocusSearch) {
      ;(window as any).electronAPI.onFocusSearch(() => {
        try {
          const el = searchInputRef.current
          el?.focus()
          ;(el as any)?.select?.()
          setTimeout(() => {
            try {
              el?.focus()
              ;(el as any)?.select?.()
            } catch {}
          }, 80)
          setTimeout(() => {
            try {
              el?.focus()
              ;(el as any)?.select?.()
            } catch {}
          }, 200)
        } catch {}
      })
    }
  }, [])
  useEffect(() => {
    if ((window as any).electronAPI?.onApplySearch) {
      const off = (window as any).electronAPI.onApplySearch((payload: any) => {
        try {
          const q = (payload && typeof payload === 'object') ? String(payload.query || '') : ''
          const items = (payload && typeof payload === 'object' && Array.isArray(payload.items)) ? payload.items : []
          if (q) {
            setSearchLocked(true)
            setSearch(q)
          }
          if (Array.isArray(items)) {
            setDisplayed(items)
            setListLoading(false)
          }
        } catch {}
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])
  useEffect(() => {
    const q = search.trim()
    if (!token && filter === 'favorite') { setDisplayed([]); return }
    setListLoading(true)
    if (q.length === 0) {
      const payload = { filter, limit: 50 }
      Promise.resolve((window as any).electronAPI?.listRecent?.(payload))
        .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
        .finally(() => setListLoading(false))
    } else {
      const payload = { query: q, filter: 'text' }
      Promise.resolve((window as any).electronAPI?.searchHistory?.(payload))
        .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
        .finally(() => setListLoading(false))
    }
  }, [search, filter])

  return (
    <>
      <Toaster position='top-center' />
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}>
        <AppShell darkMode={darkMode}>
          <TopBar />
          <SettingsMenu
            open={settingsOpen}
            darkMode={darkMode}
            onClose={() => setSettingsOpen(false)}
            onChangeDevice={() => { setSettingsOpen(false); setShowDeviceSwitch(true) }}
            onForceUpdate={() => { setSettingsOpen(false); toast('Buscando actualizaciones...'); (window as any).electronAPI?.forceUpdate?.() }}
            onToggleDark={() => { setSettingsOpen(false); setDarkMode(prev => !prev) }}
            onClearHistory={() => { setSettingsOpen(false); (window as any).electronAPI?.clearHistory?.(); toast.success('Historial eliminado') }}
            onSyncNow={async () => {
              try {
                setSettingsOpen(false)
                const dev = await (window as any).electronAPI?.getActiveDevice?.()
                await (window as any).electronAPI?.switchActiveDevice?.(dev || '')
              } catch {
                toast.error('Error al iniciar sincronización')
              }
            }}
            onOpenAbout={() => { setSettingsOpen(false); setAboutOpen(true) }}
          />
          <div className="px-3 pt-1">
            <input
              type='text'
              placeholder='Buscar en el historial…'
              value={search}
              onChange={e => setSearch(e.target.value)}
              ref={searchInputRef}
              autoFocus
              data-app-search
              className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)] outline-none focus:bg-[color:var(--color-surface)]"
            />
          </div>

            <LoginModal
              isOpen={showLogin}
              onClose={() => setShowLogin(false)}
              onLoginSuccess={handleLoginSuccess}
              mode='login'
              onGlobalLoading={setGlobalLoading}
            />
            <LoginModal
              isOpen={showRegister}
              onClose={() => setShowRegister(false)}
              onLoginSuccess={handleLoginSuccess}
              mode='register'
              onGlobalLoading={setGlobalLoading}
            />
            <UserModal
              isOpen={showUserModal}
              onClose={() => setShowUserModal(false)}
            />
            <DeviceSwitchModal
              isOpen={showDeviceSwitch}
              onClose={() => setShowDeviceSwitch(false)}
              onApplied={(newHistory: HistoryItem[]) => {
                if (Array.isArray(newHistory)) setHistory(newHistory)
              }}
            />

          {/* filtros ahora en Dock */}

          {filter === 'documents' ? (
            !token ? (
              <div className="flex-1 px-3 py-1 flex flex-col items-center justify-center text-[color:var(--color-muted)] text-xs gap-2 min-h-[200px]">
                <div>Debes iniciar sesión para acceder a los documentos</div>
                <button 
                  onClick={() => setShowLogin(true)}
                  className="px-4 py-2 rounded-md bg-[color:var(--color-primary)] text-white hover:opacity-80 transition text-sm"
                >
                  Iniciar sesión
                </button>
              </div>
            ) : filesLoading ? (
               <div className="flex-1 px-3 py-1 flex items-center justify-center text-[color:var(--color-muted)] text-xs">Cargando documentos...</div>
             ) : (
               <FileList
                  items={files.filter(f => !search || f.originalName?.toLowerCase().includes(search.toLowerCase()))}
                  storage={storageInfo}
                  currentPage={filesPage}
                  totalPages={filesTotal > 0 ? Math.max(1, Math.ceil(filesTotal / filesLimit)) : 1}
                  totalItems={filesTotal}
                  limit={filesLimit}
                  onPageChange={(newPage) => {
                     setFilesPage(newPage)
                     loadFiles(newPage, filesLimit)
                  }}
                  onLimitChange={(newLimit) => {
                     setFilesLimit(newLimit)
                     setFilesPage(1)
                     loadFiles(1, newLimit)
                  }}
                  onDelete={async (item) => {
                     if (!window.confirm('¿Eliminar archivo?')) return
                     await (window as any).electronAPI.deleteFile(item.id)
                     loadFiles(filesPage, filesLimit)
                     toast.success('Archivo eliminado')
                  }}
                  onDownload={async (item) => {
                     const res = await (window as any).electronAPI.downloadFile(item.id, item.originalName)
                     if (res.success) toast.success('Descarga completada')
                     else if (!res.canceled) toast.error('Error al descargar')
                  }}
               />
             )
          ) : (
          <HistoryList
            items={displayed}
            search={search}
            selectedIndex={selectedIndex}
            onToggleFavorite={(item) => {
              if (!token) { toast.error('Debes iniciar sesión'); return }
              ;(window as any).electronAPI?.toggleFavorite?.(item)
              const payload = { query: search, filter }
              setListLoading(true)
              Promise.resolve((window as any).electronAPI?.searchHistory?.(payload))
                .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
                .finally(() => setListLoading(false))
            }}
            onCopy={(item) => {
              if (item.value.startsWith('data:image')) {
                ;(window as any).electronAPI?.copyImage?.(item.value)
                setTimeout(() => { ;(window as any).electronAPI.pasteImage() }, 300)
                toast.success('Imagen copiada al portapapeles')
              } else {
                ;(window as any).electronAPI?.copyText(item.value)
                setTimeout(() => { ;(window as any).electronAPI?.pasteText() }, 100)
                toast.success('Pegado automáticamente')
              }
              setTimeout(() => { ;(window as any).electronAPI?.hideWindow?.() }, 500)
            }}
            highlightMatch={highlightMatch}
            canFavorite={!!token}
            canOpenModal={!!token}
            onContextMenu={(e, item) => {
              e.preventDefault()
              setContextMenu({ x: e.clientX, y: e.clientY, item })
            }}
          />
          )}
          {listLoading && (
            <div className="px-3 py-1 text-[color:var(--color-muted)] text-xs">Cargando…</div>
          )}
          {syncing && (
            <div className="fixed top-2 right-2 z-[20000] glass px-3 py-2">
              <div className="spinner"><span className="ring"></span><span>Sincronizando… {Math.round(syncPct)}%</span></div>
            </div>
          )}
          {downloading && (
            <div className="fixed top-2 right-2 z-[20000] glass px-3 py-2 rounded-lg shadow-lg" style={{ top: syncing ? '70px' : '8px' }}>
              <div className="flex flex-col gap-2 min-w-[200px]">
                <div className="text-xs font-medium text-[color:var(--color-text)] truncate" title={downloadFileName}>
                  Descargando: {downloadFileName}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-[color:var(--color-bg)] rounded-full overflow-hidden border border-[color:var(--color-border)]">
                    <div 
                      className="h-full bg-[color:var(--color-primary)] transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, downloadPct))}%` }}
                    />
                  </div>
                  <span className="text-xs text-[color:var(--color-muted)] whitespace-nowrap">{Math.round(downloadPct)}%</span>
                </div>
                {downloadTotal > 0 && (
                  <div className="text-[10px] text-[color:var(--color-muted)]">
                    {formatBytes(downloadBytes)} / {formatBytes(downloadTotal)}
                  </div>
                )}
              </div>
            </div>
          )}


          <Dock
            items={[
              { label: 'Ajustes', icon: null as any, onClick: () => { if (!token) { toast.error('Debes iniciar sesión'); return } setSettingsOpen(true) } },
              ...(token ? [
                { label: 'Perfil', icon: null as any, onClick: () => setShowUserModal(true) },
                { label: 'Cerrar sesión', icon: null as any, onClick: logout }
              ] : [
                { label: 'Iniciar sesión', icon: null as any, onClick: () => setShowLogin(true) },
                { label: 'Registrarse', icon: null as any, onClick: () => setShowRegister(true) }
              ])
            ]}
            userAvatar={userAvatar}
            filter={filter}
            onChangeFilter={(f) => { 
              if (!token && (f === 'favorite' || f === 'documents')) { 
                toast.error('Debes iniciar sesión para acceder a esta sección'); 
                return 
              } 
              setFilter(f) 
            }}
            disabledFavorites={!token}
            hasAuth={!!token}
          />
          <div className="px-3 pb-1 text-right text-[11px] text-[color:var(--color-muted)]" title='Versión de la app'>v{appVersion}</div>

          <OnboardingTour
            open={showTour}
            onClose={() => setShowTour(false)}
            onComplete={async () => {
              try {
                await (window as any).electronAPI?.setPreferences?.({ firstRunGuideDone: true })
              } catch {}
              setShowTour(false)
            }}
          />

          {globalLoading && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[20000]">
              <div className="glass p-4">Procesando...</div>
            </div>
          )}

          {isQuick && (
            <SearchQuickSwitcher
              open={quickOpen}
              query={search}
              onQueryChange={setSearch}
              onClose={() => { try { window.close() } catch {}; setQuickOpen(false) }}
            />
          )}
        </AppShell>
      </motion.div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => {
            setItemToDelete(contextMenu.item)
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      <DeleteModal
        isOpen={!!itemToDelete}
        isLoading={deletingLoading}
        onConfirm={async () => {
          if (itemToDelete && itemToDelete.id) {
            try {
              setDeletingLoading(true)
              const res = await (window as any).electronAPI.deleteHistoryItem(itemToDelete.id)
              if (res?.success) {
                toast.success('Elemento eliminado')
              } else {
                toast.error('Error al eliminar')
              }
            } catch {
              toast.error('Error al eliminar')
            }
          }
          setItemToDelete(null)
          setDeletingLoading(false)
        }}
        onCancel={() => setItemToDelete(null)}
      />
      <AboutModal
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
        version={appVersion}
      />
    </>
  )
}

// componentes de tarjeta y código movidos a ./components

export default App
