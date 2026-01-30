import { useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Cog6ToothIcon, UserCircleIcon, ArrowRightStartOnRectangleIcon, ArrowLeftEndOnRectangleIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import LoginModal from './Login'
import UserModal from './UserModal'
import AppShell from './components/AppShell'
import TopBar from './components/TopBar'
import Dock from './components/Dock'
import HistoryList from './components/HistoryList'
import SettingsMenu from './components/SettingsMenu'
import AboutModal from './components/AboutModal'
import OnboardingTour from './components/OnboardingTour'
import ContextMenu from './components/ContextMenu'
import DeleteModal from './components/DeleteModal'
import OCRModal from './components/OCRModal'
import DeviceRegistrationModal from './components/DeviceRegistrationModal'
import DeviceSelectionModal from './components/DeviceSelectionModal'
import type { HistoryItem, FilterType } from './types'
import { API_BASE } from './config'
import { backendRequest } from './api/backend'

const resolveAvatar = (s?: string | null): string | null => {
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

function App () {
  const [filter, setFilter] = useState<FilterType>('text')
  const [displayed, setDisplayed] = useState<HistoryItem[]>([])
  const [, setListLoading] = useState<boolean>(false)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false)
  const [page, setPage] = useState<number>(0)
  const PAGE_SIZE = 20

  const [search, setSearch] = useState<string>('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  
  const { t } = useTranslation()
  const [darkMode, setDarkMode] = useState<boolean>(false)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [aboutOpen, setAboutOpen] = useState<boolean>(false)
  const [showLogin, setShowLogin] = useState<boolean>(false)
  const [showRegister, setShowRegister] = useState<boolean>(false)
  const [showUserModal, setShowUserModal] = useState<boolean>(false)
  const [token, setToken] = useState<string | null>(null)
  const [globalLoading, setGlobalLoading] = useState<boolean>(false)
  const [appVersion, setAppVersion] = useState<string>('')
  const [showTour, setShowTour] = useState<boolean>(false)
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, item: HistoryItem} | null>(null)
  const [itemToDelete, setItemToDelete] = useState<HistoryItem | null>(null)
  const [deletingLoading, setDeletingLoading] = useState<boolean>(false)
  const [ocrImage, setOcrImage] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [showDeviceSelection, setShowDeviceSelection] = useState<boolean>(false)

  const loadSession = useCallback(async () => {
    try {
      const sessionStr = await (window as any).electronAPI?.getConfig?.('session')
      if (sessionStr) {
        const session = JSON.parse(sessionStr)
        if (session?.token) {
          setToken(session.token)
          // Also set legacy stub if needed, though backend request handles it via main process
          ;(window as any).electronAPI?.setAuthToken?.(session.token)
          
          // Fetch user profile from backend since local storage only has tokens now
          try {
             // We use the raw fetch here or backendRequest? 
             // backendRequest uses IPC to Main -> Axios
             const userData: any = await backendRequest('/users/me')
             // Response might be { success: true, data: { user: ... } } or just the user object depending on API
             // Based on UserModal, it seems response is { data: { user: ... } } or { user: ... }
             // UserModal: const payload = (data && typeof data === 'object' ? (data.data ?? data) : {}) as any
             // backendRequest returns response.data directly.
             
             const payload = (userData && typeof userData === 'object' ? (userData.data ?? userData) : {}) as any
             const u = payload?.user
             
             if (u && u.avatarUrl) {
                setUserAvatar(resolveAvatar(u.avatarUrl))
             } else {
                setUserAvatar(null)
             }
          } catch (err) {
             console.error('Failed to load user profile', err)
             // If 401, it might be cleared by now or we should clear it
             // But backendDaemon handles refresh.
          }
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    loadSession()
    // Signal main process that UI is ready to receive updates
    ;(window as any).electronAPI?.signalAppReady?.()
  }, [loadSession])

  // Centralized Data Fetching
  const fetchData = useCallback(async (isLoadMore = false) => {
      if (isLoadMore) {
          setIsLoadingMore(true)
      } else {
          setListLoading(true)
          setPage(0) // Reset page on new filter/search
      }

      try {
          const currentOffset = isLoadMore ? (page + 1) * PAGE_SIZE : 0
          
          // Build query object
          const queryOpts: any = {
              limit: PAGE_SIZE,
              offset: currentOffset,
              filter: {}
          }

          // Apply filters
          if (filter === 'favorite') queryOpts.filter.favorite = true
          // Backend supports type filter, but 'text' tab implies no images.
          // However, our backend SQL 'Type' is 'text' or 'image'.
          if (filter === 'image') queryOpts.filter.type = 'image'
          if (filter === 'text') queryOpts.filter.type = 'text'

          // Apply search (global)
          if (search.trim()) {
             queryOpts.filter.search = search
             // User said: "buscar si busque en todo" (search everything)
             // Override type filter for search if we want "search everything"
             delete queryOpts.filter.type 
          }

          // Get current selected device to filter history
          try {
            const currentDevice = await (window as any).electronAPI?.getCurrentDevice?.()
            if (currentDevice && currentDevice.Id) {
                queryOpts.filter.deviceId = currentDevice.Id
            }
          } catch (e) {
            console.error('Error getting current device for filter:', e)
          }

          const results = await (window as any).electronAPI?.getClipboardHistory?.(queryOpts)
          
          if (Array.isArray(results)) {
              if (isLoadMore) {
                  setDisplayed(prev => [...prev, ...results])
                  setPage(p => p + 1)
              } else {
                  setDisplayed(results)
              }
              setHasMore(results.length === PAGE_SIZE)
          }
      } catch (e) {
          console.error(e)
      } finally {
          setListLoading(false)
          setIsLoadingMore(false)
      }
  }, [search, filter, page])

  // Debounced Search
  useEffect(() => {
      const timer = setTimeout(() => {
          fetchData(false)
      }, 300)
      return () => clearTimeout(timer)
  }, [search, filter])

  // Load More Handler
  const loadMoreResults = () => {
      if (!hasMore || isLoadingMore) return
      fetchData(true)
  }

  // Background updates: Refresh completely to stay consistent?
  // Or just prepend? Prepending is hard with pagination.
  // Simplest is to re-fetch page 0.
  useEffect(() => {
    if ((window as any).electronAPI?.onClipboardUpdate) {
      const off = (window as any).electronAPI.onClipboardUpdate((_data: any) => {
          // Always fetch data from source to respect current filters (deviceId, search, etc.)
          // The data coming from backend broadcast might be unfiltered or stale regarding current view context.
          console.log('Clipboard update signal received, refreshing list...')
          fetchData(false)
      })
      return () => { try { off?.() } catch {} }
    }
  }, [fetchData])

  const highlightMatch = (text: string, query: string): ReactNode[] | string => {
    if (!query) return text
    const regex = new RegExp(`(${query})`, 'gi')
    return text.split(regex).map((part, idx) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={idx} className='bg-yellow-200 font-semibold rounded'>{part}</mark>
      ) : (
        <span key={idx}>{part}</span>
      )
    )
  }

  // Dark Mode
  useEffect(() => {
    async function loadDarkMode() {
        const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
        if (stored === 'true') setDarkMode(true)
    }
    loadDarkMode()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    ;(window as any).electronAPI?.setConfig?.('darkMode', darkMode.toString())
  }, [darkMode])

  // App Version
  useEffect(() => {
    ;(window as any).electronAPI?.getAppVersion?.().then(setAppVersion)
  }, [])

  // Active Device Check & Listener
  useEffect(() => {
    // 1. Check on startup if we need to select a device
    const checkDevice = async () => {
        const active = await (window as any).electronAPI?.getActiveDevice?.()
        if (!active) {
            const all = await (window as any).electronAPI?.getAllDevices?.()
            if (all && all.length > 1) {
                setShowDeviceSelection(true)
            } else if (all && all.length === 1) {
                 // Should be auto-selected by backend, but just in case
                 await (window as any).electronAPI?.setActiveDevice?.(all[0].Id)
            }
        }
    }
    checkDevice()

    // 2. Listen for changes
    if ((window as any).electronAPI?.onDeviceChanged) {
        const off = (window as any).electronAPI.onDeviceChanged((dev: any) => {
            console.log('Device changed to:', dev?.Name)
            // Refresh history immediately
            setDisplayed([])
            setGlobalLoading(true)
            fetchData(false).finally(() => setGlobalLoading(false))
        })
        return () => { try { off?.() } catch {} }
    }
  }, [fetchData])

  // Sync Listener
  useEffect(() => {
    if ((window as any).electronAPI?.onDevicesSyncComplete) {
      const off = (window as any).electronAPI.onDevicesSyncComplete(() => {
          setShowDeviceSelection(true)
          toast.success(t('device.sync_complete') || 'Sincronización de dispositivos completada')
      })
      return () => { try { off?.() } catch {} }
    }
  }, [t])

  const logout = async () => {
    setToken(null)
    await (window as any).electronAPI?.removeConfig?.('session')
    toast.success(t('notifications.session_closed'))
  }

  const handleLoginSuccess = (newToken: string, user?: any) => {
    setToken(newToken)
    ;(window as any).electronAPI?.setAuthToken?.(newToken)
    if (user?.avatarUrl) {
      setUserAvatar(resolveAvatar(user.avatarUrl))
    } else {
      loadSession()
    }
  }



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
            onChangeDevice={() => { setSettingsOpen(false); setShowDeviceSelection(true) }}
            onForceUpdate={() => { /* Removed */ }}
            onToggleDark={() => { setSettingsOpen(false); setDarkMode(prev => !prev) }}
            onClearHistory={() => { setSettingsOpen(false); (window as any).electronAPI?.clearHistory?.(); toast.success(t('notifications.history_cleared')) }}
            onSyncNow={() => { /* Removed */ }}
            onOpenAbout={() => { setSettingsOpen(false); setAboutOpen(true) }}
          />
          
          <div className="px-3 pt-1">
            <input
              type='text'
              placeholder={t('search_placeholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              ref={searchInputRef}
              autoFocus
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

          <HistoryList
            items={displayed}
            search={search}
            selectedIndex={-1}
            hasMore={false}
            onLoadMore={loadMoreResults}
            isLoadingMore={false}
            onToggleFavorite={(item) => {
              (window as any).electronAPI?.toggleFavorite?.({ id: item.id, isFavorite: !item.favorite })
            }}
            onCopy={(item) => {
              const isImage = item.value.startsWith('data:image') || item.value.startsWith('[LOCAL_IMAGE]:') || !!(item as any).imagePath
              if (isImage) {
                // Keep direct copy on card click? Or should card click also open OCR?
                // User said "al dar clic en el ojo del item ... abrir otra ventana"
                // The Card component's onCopy is the main click handler.
                // But the user specifically said "clic en el ojo".
                // So onCopy (main click) should probably just copy the image as before.
                ;(window as any).electronAPI?.copyImage?.(item.value)
                ;(window as any).electronAPI?.pasteText?.()
                setTimeout(() => { ;(window as any).electronAPI?.hideWindow?.() }, 100)
              } else {
                ;(window as any).electronAPI?.copyText(item.value)
                ;(window as any).electronAPI?.pasteText?.()
                setTimeout(() => { ;(window as any).electronAPI?.hideWindow?.() }, 100)
              }
            }}
            onDelete={(item) => {
              setItemToDelete(item)
            }}
            highlightMatch={highlightMatch}
            canFavorite={true}
            canOpenModal={true}
          />

          <Dock
            items={[
              { label: 'Ajustes', icon: <Cog6ToothIcon className="w-5 h-5" />, onClick: () => setSettingsOpen(true) },
              ...(token ? [
                { label: 'Perfil', icon: <UserCircleIcon className="w-5 h-5" />, onClick: () => setShowUserModal(true) },
                { label: 'Cerrar sesión', icon: <ArrowRightStartOnRectangleIcon className="w-5 h-5" />, onClick: logout }
              ] : [
                { label: 'Iniciar sesión', icon: <ArrowLeftEndOnRectangleIcon className="w-5 h-5" />, onClick: () => setShowLogin(true) },
                { label: 'Registrarse', icon: <UserPlusIcon className="w-5 h-5" />, onClick: () => setShowRegister(true) }
              ])
            ]}
            userAvatar={userAvatar}
            filter={filter}
            onChangeFilter={(f) => setFilter(f)}
            disabledFavorites={false}
            hasAuth={!!token}
          />
          <div className="px-3 pb-1 text-right text-[11px] text-[color:var(--color-muted)]" title='Versión de la app'>v{appVersion}</div>

          <DeviceRegistrationModal onSuccess={() => {
              // Refresh or just close
          }} />

          <DeviceSelectionModal
            open={showDeviceSelection}
            onClose={() => setShowDeviceSelection(false)}
            onSuccess={() => {
                setDisplayed([]) // Clear current list to verify update
                setGlobalLoading(true)
                setTimeout(() => {
                    fetchData(false).finally(() => setGlobalLoading(false))
                }, 500) // Small delay to ensure DB persistence if needed
            }}
          />

          <OnboardingTour
            open={showTour}
            onClose={() => setShowTour(false)}
            onComplete={async () => {
              try {
                await (window as any).electronAPI?.setConfig?.('firstRunGuideDone', 'true')
              } catch {}
              setShowTour(false)
            }}
          />

          {globalLoading && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[20000]">
              <div className="glass p-4">{t('ui.processing')}</div>
            </div>
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
            open={!!itemToDelete}
            loading={deletingLoading}
            onConfirm={async () => {
          if (itemToDelete && itemToDelete.id) {
            try {
              setDeletingLoading(true)
              // The backend now broadcasts the update, so we just need to wait for the call to finish
              await (window as any).electronAPI.deleteHistoryItem(itemToDelete.id)
              toast.success(t('notifications.item_deleted'))
              // Manually remove from local state just in case the broadcast is slow or fails
              setDisplayed(prev => prev.filter(i => i.id !== itemToDelete.id))
            } catch {
              toast.error(t('notifications.delete_error'))
            }
          }
          setItemToDelete(null)
          setDeletingLoading(false)
        }}
        onClose={() => setItemToDelete(null)}
      />
      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onBack={() => { setAboutOpen(false); setSettingsOpen(true) }}
      />
      
      <OCRModal
        isOpen={!!ocrImage}
        imageUrl={ocrImage}
        onClose={() => setOcrImage(null)}
      />
    </>
  )
}

export default App
