import { useEffect, useState, useRef } from 'react'
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
import SidebarFilters from './components/SidebarFilters'
import SearchQuickSwitcher from './components/SearchQuickSwitcher'
import SettingsMenu from './components/SettingsMenu'
import OnboardingTour from './components/OnboardingTour'
import type { HistoryItem, FilterType } from './types'


// tipos movidos a ./types

function App () {
  const [, setHistory] = useState<HistoryItem[]>([])
  const [search, setSearch] = useState<string>('')
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
      if (!raw) return
      const sess = JSON.parse(raw)
      const rt = sess?.refreshToken
      if (!rt) return
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
      }
    } catch {}
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

  const [filter, setFilter] = useState<FilterType>('all')
  const [displayed, setDisplayed] = useState<HistoryItem[]>([])
  const [listLoading, setListLoading] = useState<boolean>(false)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [syncPct, setSyncPct] = useState<number>(0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('session')
      if (raw) {
        const sess = JSON.parse(raw)
        if (sess?.refreshToken) { refreshAuthToken(); return }
        if (sess?.token) {
          handleLoginSuccess(sess.token)
          ;(window as any).electronAPI?.setAuthToken(sess.token)
          return
        }
      }
    } catch {}
    const token = localStorage.getItem('x-token')
    if (token) {
      handleLoginSuccess(token)
      ;(window as any).electronAPI?.setAuthToken(token)
    }
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
      ;(window as any).electronAPI.onClipboardUpdate((data: HistoryItem[]) => {
        setHistory(data)
        const q = search.trim()
        setListLoading(true)
        if (q.length === 0) {
          const payload = { filter, limit: 50 }
          Promise.resolve((window as any).electronAPI?.listRecent?.(payload))
            .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
            .finally(() => setListLoading(false))
        } else {
          const payload = { query: q, filter }
          Promise.resolve((window as any).electronAPI?.searchHistory?.(payload))
            .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
            .finally(() => setListLoading(false))
        }
      })
    }
  }, [])

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
  const [showDeviceSwitch, setShowDeviceSwitch] = useState<boolean>(false)
  const [quickOpen, setQuickOpen] = useState<boolean>(false)

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
    const handler = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === 'k'
      const meta = e.ctrlKey || e.metaKey
      if (isK && meta) {
        e.preventDefault()
        setQuickOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const q = search.trim()
    setListLoading(true)
    if (q.length === 0) {
      const payload = { filter, limit: 50 }
      Promise.resolve((window as any).electronAPI?.listRecent?.(payload))
        .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
        .finally(() => setListLoading(false))
    } else {
      const payload = { query: q, filter }
      Promise.resolve((window as any).electronAPI?.searchHistory?.(payload))
        .then((res: HistoryItem[]) => { if (Array.isArray(res)) setDisplayed(res) })
        .finally(() => setListLoading(false))
    }
  }, [search, filter])

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}>
        <Toaster position='top-center' />
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
                setGlobalLoading(true)
                toast('Sincronizando…')
                const dev = await (window as any).electronAPI?.getActiveDevice?.()
                const hist = await (window as any).electronAPI?.loadDeviceHistory?.(dev || '')
                if (Array.isArray(hist)) {
                  setHistory(hist)
                  toast.success('Sincronización completada')
                } else {
                  toast.error('No se pudo obtener el historial')
                }
              } catch {
                toast.error('Error al sincronizar')
              } finally {
                setGlobalLoading(false)
              }
            }}
          />
          <div className="px-3 pt-1">
            <input
              type='text'
              placeholder='Buscar en el historial…'
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-[color:var(--color-text)] outline-none"
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

          <SidebarFilters filter={filter} onChange={setFilter} />

          <HistoryList
            items={displayed}
            search={search}
            selectedIndex={selectedIndex}
            onToggleFavorite={(item) => {
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
          />
          {listLoading && (
            <div className="px-3 py-1 text-[color:var(--color-muted)] text-xs">Cargando…</div>
          )}
          {syncing && (
            <div className="fixed top-2 right-2 z-[20000] glass px-3 py-2">
              <div className="spinner"><span className="ring"></span><span>Sincronizando… {Math.round(syncPct)}%</span></div>
            </div>
          )}

          <div className="text-right px-2 pb-1 text-[11px] text-[color:var(--color-muted)] mt-1" title='Versión de la app'>v{appVersion}</div>

          <Dock
            items={[
              { label: 'Copiar', icon: null as any, onClick: () => toast('Selecciona un elemento para copiar') },
              { label: 'Pegar', icon: null as any, onClick: () => (window as any).electronAPI?.pasteText?.() },
              { label: 'Favoritos', icon: null as any, onClick: () => setFilter('favorite') },
              { label: 'Ajustes', icon: null as any, onClick: () => setSettingsOpen(true) },
              ...(token ? [
                { label: 'Perfil', icon: null as any, onClick: () => setShowUserModal(true) },
                { label: 'Cerrar sesión', icon: null as any, onClick: logout }
              ] : [
                { label: 'Iniciar sesión', icon: null as any, onClick: () => setShowLogin(true) },
                { label: 'Registrarse', icon: null as any, onClick: () => setShowRegister(true) }
              ])
            ]}
            userAvatar={userAvatar}
          />

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

          <SearchQuickSwitcher open={quickOpen} query={search} onQueryChange={setSearch} onClose={() => setQuickOpen(false)} />
        </AppShell>
      </motion.div>
    </>
  )
}

// componentes de tarjeta y código movidos a ./components

export default App
