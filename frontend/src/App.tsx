import { useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Cog6ToothIcon, UserCircleIcon, ArrowRightStartOnRectangleIcon, ArrowLeftEndOnRectangleIcon, UserPlusIcon, DocumentPlusIcon } from '@heroicons/react/24/outline'
import LoginModal from './Login'
import UserModal from './UserModal'
import AppShell from './components/AppShell'
import TopBar from './components/TopBar'
import Dock from './components/Dock'
import HistoryList, { type HistoryListRef } from './components/HistoryList'
import FileList from './components/FileList'
import SettingsMenu from './components/SettingsMenu'
import AboutModal from './components/AboutModal'
import OnboardingTour from './components/OnboardingTour'
import ContextMenu from './components/ContextMenu'
import DeleteModal from './components/DeleteModal'
import OCRModal from './components/OCRModal'
import DeviceRegistrationModal from './components/DeviceRegistrationModal'
import DeviceSelectionModal from './components/DeviceSelectionModal'
import SharingManager, { type SharingManagerRef } from './components/SharingManager'
import ShareItemModal from './components/ShareItemModal'
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
  const historyListRef = useRef<HistoryListRef>(null)
  const sharingManagerRef = useRef<SharingManagerRef | null>(null)
  
  const { t } = useTranslation()
  const [darkMode, setDarkMode] = useState<boolean>(false)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [aboutOpen, setAboutOpen] = useState<boolean>(false)
  const [showLogin, setShowLogin] = useState<boolean>(false)
  const [showRegister, setShowRegister] = useState<boolean>(false)
  const [showUserModal, setShowUserModal] = useState<boolean>(false)
  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | undefined>(undefined)
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined)
  const [globalLoading, setGlobalLoading] = useState<boolean>(false)
  const [globalLoadingMsg, setGlobalLoadingMsg] = useState<string>('')
  const [appVersion, setAppVersion] = useState<string>('')
  const [showTour, setShowTour] = useState<boolean>(false)
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, item: HistoryItem} | null>(null)
  const [itemToDelete, setItemToDelete] = useState<HistoryItem | null>(null)
  const [deletingLoading, setDeletingLoading] = useState<boolean>(false)
  const [ocrImage, setOcrImage] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [showDeviceSelection, setShowDeviceSelection] = useState<boolean>(false)
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false)
  
  // Sharing state
  const [itemToShare, setItemToShare] = useState<HistoryItem | null>(null)

  // Files state
  const [files, setFiles] = useState<any[]>([])
  const [storage, setStorage] = useState<any>(null)

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
             
             if (u) {
                setUserId(u.id || u.userId)
                if (u.email) setUserEmail(u.email)
                if (u.avatarUrl) {
                  setUserAvatar(resolveAvatar(u.avatarUrl))
                } else {
                  setUserAvatar(null)
                }
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

  // Reset UI state when window is shown (on open)
  useEffect(() => {
    if ((window as any).electronAPI?.onUiReset) {
      const off = (window as any).electronAPI.onUiReset(() => {
        console.log('UI Reset triggered by window show')
        
        // Reset search completely
        setSearch('')
        setIsSearchFocused(false)
        if (searchInputRef.current) {
          searchInputRef.current.blur()
          searchInputRef.current.value = '' // Force clear
        }

        // Close all modals
        setSettingsOpen(false)
        setAboutOpen(false)
        setShowLogin(false)
        setShowRegister(false)
        setShowUserModal(false)
        setContextMenu(null)
        setItemToDelete(null)
        setOcrImage(null)
        setShowDeviceSelection(false)
        setShowTour(false)
      })
      return () => { try { off?.() } catch {} }
    }
  }, [])

  // Global search shortcut (Ctrl+F / Cmd+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (searchInputRef.current) {
          searchInputRef.current.focus()
          searchInputRef.current.select()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // File fetching
  const fetchFiles = useCallback(async () => {
    setListLoading(true)
    try {
        const res = await (window as any).electronAPI?.listFiles?.()
        console.log("Fetch files response:", res) // Debug
        
        if (res && typeof res === 'object') {
            let targetData = res;
            
            // Check for nested "data" property (common in backend responses)
            if (res.data) {
                // If res.data has items, use it
                if (res.data.items || res.data.storage) {
                    targetData = res.data;
                }
                // Double nested check: res.data.data (axios response + backend response wrapper)
                else if (res.data.data && (res.data.data.items || res.data.data.storage)) {
                    targetData = res.data.data;
                }
            }
            
            // Ensure items is an array
            const items = Array.isArray(targetData.items) ? targetData.items : [];
            setFiles(items)
            
            if (targetData.storage) {
                setStorage(targetData.storage)
            }
        } else {
            // Handle undefined or null response
            console.warn("listFiles returned invalid response:", res);
            setFiles([]);
        }
    } catch (e) {
        console.error(e)
        setFiles([]);
    } finally {
        setListLoading(false)
    }
  }, [])

  // Centralized Data Fetching
  const fetchData = useCallback(async (isLoadMore = false) => {
      if (filter === 'documents') {
          fetchFiles()
          return
      }

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
        <mark key={idx} className='bg-[color:var(--color-primary)] text-white font-semibold rounded px-0.5'>{part}</mark>
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
            
            const isFirstSync = !dev?.LastSync;
            if (isFirstSync) {
                setGlobalLoadingMsg(t('device.syncing_initial') || 'Sincronizando dispositivo...')
                setGlobalLoading(true)
                // If it's a new device with no previous sync, wait for sync to complete
                fetchData(false)
            } else {
                setGlobalLoadingMsg('')
                setGlobalLoading(true)
                fetchData(false).finally(() => setGlobalLoading(false))
            }
        })
        return () => { try { off?.() } catch {} }
    }
  }, [fetchData])

  // Listen for device sync completed
  useEffect(() => {
    if ((window as any).electronAPI?.onDeviceSyncCompleted) {
        const off = (window as any).electronAPI.onDeviceSyncCompleted((dev: any) => {
            console.log('Device initial sync completed:', dev?.Name)
            setGlobalLoading(false)
            setGlobalLoadingMsg('')
            fetchData(false)
        })
        return () => { try { off?.() } catch {} }
    }
  }, [fetchData])

  // Sync Listener
  useEffect(() => {
    if ((window as any).electronAPI?.onDevicesSyncComplete) {
      const off = (window as any).electronAPI.onDevicesSyncComplete((_devices: any[]) => {
          setShowDeviceSelection(true)
          toast.success(t('device.sync_complete') || 'Sincronización de dispositivos completada')
      })
      return () => { try { off?.() } catch {} }
    }
  }, [t])

  const logout = async () => {
    setToken(null)
    setUserId(undefined)
    setUserEmail(undefined)
    await (window as any).electronAPI?.removeConfig?.('session')
    toast.success(t('notifications.session_closed'))
  }

  const handleLoginSuccess = (newToken: string, user?: any) => {
    setToken(newToken)
    setUserId(user?.id || user?.userId)
    setUserEmail(user?.email)
    ;(window as any).electronAPI?.setAuthToken?.(newToken)
    if (user?.avatarUrl) {
      setUserAvatar(resolveAvatar(user.avatarUrl))
    } else {
      loadSession()
    }
  }

  // Handle sharing an item
  const handleShareItem = (item: HistoryItem) => {
    setItemToShare(item);
  };

  const handleUpload = async () => {
    const path = await (window as any).electronAPI?.selectFile?.()
    if (!path) return
    
    const toastId = toast.loading('Subiendo archivo...')
    try {
        const res = await (window as any).electronAPI?.uploadFile?.(path)
        if (res && res.success) {
            toast.success('Archivo subido correctamente', { id: toastId })
            fetchFiles()
        } else {
            toast.error('Error al subir archivo: ' + (res?.error || 'Desconocido'), { id: toastId })
        }
    } catch (e) {
        toast.error('Error al subir archivo', { id: toastId })
    }
  }

  const handleDeleteFile = async (file: any) => {
      if (!confirm('¿Eliminar archivo?')) return
      const toastId = toast.loading('Eliminando...')
      try {
          const res = await (window as any).electronAPI?.deleteFile?.(file.id)
          if (res && res.success) {
              toast.success('Archivo eliminado', { id: toastId })
              setFiles(prev => prev.filter(f => f.id !== file.id))
          } else {
              toast.error('Error al eliminar', { id: toastId })
          }
      } catch (e) {
          toast.error('Error al eliminar', { id: toastId })
      }
  }

  return (
    <>
      <Toaster position='top-center' />
      <SharingManager
        ref={sharingManagerRef}
        currentUserId={userId}
        currentUserEmail={userEmail}
        currentUserToken={token}
        onItemAdded={(item) => {
          // When a shared item is accepted, add it to the local history
          console.log('Shared item added:', item);
          // TODO: Actually add to displayed items
          // For now, just show a toast
          toast.success('Item compartido agregado a tu historial');
        }}
      >
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}>
        <AppShell darkMode={darkMode}>
          <TopBar 
            actions={[
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
          />
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
          
          {/* Overlay for search focus */}
          <div 
            className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 backdrop-blur-[1px]
              ${isSearchFocused ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
            `}
            onClick={() => {
              setIsSearchFocused(false)
              searchInputRef.current?.blur()
            }}
          />

          <div className="px-3 pt-3 pb-2 relative z-50">
            <input
              type='text'
              placeholder={t('search_placeholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || e.key === 'Enter') {
                  e.preventDefault()
                  setIsSearchFocused(false)
                  searchInputRef.current?.blur()
                  historyListRef.current?.focus()
                }
              }}
              ref={searchInputRef}
              autoFocus
              className={`w-full px-3 h-[36px] rounded-[var(--radius-input)] outline-none transition-colors duration-100 text-[13px] font-medium placeholder:font-normal
                ${isSearchFocused 
                  ? 'bg-[color:var(--color-surface)] text-[color:var(--color-text)] ring-1 ring-[color:var(--color-primary)] border border-[color:var(--color-primary)]' 
                  : 'bg-[color:var(--color-surface)] text-[color:var(--color-text)] border border-[color:var(--color-border)] hover:border-[color:var(--color-muted)]'
                }
              `}
            />
          </div>

          <LoginModal
              isOpen={showLogin}
              onClose={() => setShowLogin(false)}
              onLoginSuccess={handleLoginSuccess}
              mode='login'
              onGlobalLoading={(v) => { setGlobalLoadingMsg(''); setGlobalLoading(v); }}
            />
            <LoginModal
              isOpen={showRegister}
              onClose={() => setShowRegister(false)}
              onLoginSuccess={handleLoginSuccess}
              mode='register'
              onGlobalLoading={(v) => { setGlobalLoadingMsg(''); setGlobalLoading(v); }}
            />
            <UserModal
              isOpen={showUserModal}
              onClose={() => setShowUserModal(false)}
            />

          {filter === 'documents' ? (
             <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-3 py-2 flex justify-between items-center border-b border-[color:var(--color-border)]">
                    <span className="text-sm font-medium text-[color:var(--color-text)]">Mis Documentos</span>
                    <button 
                        onClick={handleUpload}
                        className="flex items-center gap-1 px-2 py-1 bg-[color:var(--color-primary)] text-white rounded-md text-xs hover:opacity-90 transition"
                    >
                        <DocumentPlusIcon className="w-4 h-4" />
                        <span>Subir</span>
                    </button>
                </div>
                <FileList 
                    items={files} 
                    storage={storage} 
                    onDelete={handleDeleteFile}
                    onDownload={(item) => {
                        (window as any).electronAPI?.downloadFile?.(item.id, item.originalName)
                    }}
                />
             </div>
          ) : (
          <HistoryList
            ref={historyListRef}
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
            onShare={handleShareItem}
            highlightMatch={highlightMatch}
            canFavorite={true}
            canOpenModal={true}
          />
          )}

          <Dock
            items={[]}
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
                // The onDeviceChanged listener will handle the loading state and data fetching
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
              <div className="glass p-4 flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-2 border-[color:var(--color-primary)] border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sm font-medium">{globalLoadingMsg || t('ui.processing')}</div>
              </div>
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
      
      {/* Share Item Modal */}
      {itemToShare && (
        <ShareItemModal
          isOpen={!!itemToShare}
          onClose={() => setItemToShare(null)}
          item={itemToShare}
          onShare={async (receiverEmail: string, metadata?: any) => {
            try {
              if (sharingManagerRef.current) {
                const sharingId = await sharingManagerRef.current.sendClipboardItem(
                  receiverEmail,
                  {
                    type: itemToShare.type || 'text',
                    value: itemToShare.value,
                    meta: itemToShare.meta || {}
                  },
                  metadata
                );
                toast.success(t('sharing.success_message') || 'Item shared successfully!');
                console.log('Item shared with ID:', sharingId);
              } else {
                toast.error('Sharing service not available');
              }
            } catch (error: any) {
              console.error('Error sharing item:', error);
              toast.error(error.message || t('sharing.error_share_failed') || 'Failed to share item');
            } finally {
              setItemToShare(null);
            }
          }}
          currentUserEmail={userEmail}
        />
      )}
      
      </SharingManager>
    </>
  )
}

export default App
