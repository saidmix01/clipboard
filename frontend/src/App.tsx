import { useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { notify, notifySuccess, notifyError } from './utils/notify'
import { useTranslation } from 'react-i18next'
import { DocumentPlusIcon } from '@heroicons/react/24/outline'
import AppShell from './components/AppShell'
import TopBar from './components/TopBar'
import Dock from './components/Dock'
import HistoryList, { type HistoryListRef } from './components/HistoryList'
import FileList from './components/FileList'
import AboutModal from './components/AboutModal'
import OnboardingTour from './components/OnboardingTour'
import ContextMenu from './components/ContextMenu'
import DeleteModal from './components/DeleteModal'
import OCRModal from './components/OCRModal'
import DeviceRegistrationModal from './components/DeviceRegistrationModal'
import DeviceSelectionModal from './components/DeviceSelectionModal'
import type { HistoryItem, FilterType } from './types'
import { backendRequest } from './api/backend'

function App () {
  const [filter, setFilter] = useState<FilterType>('all')
  const [displayed, setDisplayed] = useState<HistoryItem[]>([])
  const [, setListLoading] = useState<boolean>(false)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false)
  const [page, setPage] = useState<number>(0)
  const PAGE_SIZE = 20

  const [search, setSearch] = useState<string>('')
  const historyListRef = useRef<HistoryListRef>(null)
  
  const { t } = useTranslation()
  const [darkMode, setDarkMode] = useState<boolean>(false)
  const [aboutOpen, setAboutOpen] = useState<boolean>(false)
  const [token, setToken] = useState<string | null>(null)
  const [globalLoading, setGlobalLoading] = useState<boolean>(false)
  const [globalLoadingMsg, setGlobalLoadingMsg] = useState<string>('')
  const [appVersion, setAppVersion] = useState<string>('')
  const [showTour, setShowTour] = useState<boolean>(false)
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, item: HistoryItem} | null>(null)
  const [itemToDelete, setItemToDelete] = useState<HistoryItem | null>(null)
  const [deletingLoading, setDeletingLoading] = useState<boolean>(false)
  const [ocrImage, setOcrImage] = useState<string | null>(null)
  const [showDeviceSelection, setShowDeviceSelection] = useState<boolean>(false)

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
          
          // Fetch user profile
          try {
             const userData: any = await backendRequest('/users/me')
             const payload = (userData && typeof userData === 'object' ? (userData.data ?? userData) : {}) as any
             const u = payload?.user
             
             if (u && u.avatarUrl) {
                // Avatar available — could be shown in TopBar
             }
          } catch (err) {
             // Non-critical — user profile fetch failure doesn't block the app
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
        setSearch('')
        setAboutOpen(false)
        setContextMenu(null)
        setItemToDelete(null)
        setOcrImage(null)
        setShowDeviceSelection(false)
        setShowTour(false)
      })
      return () => off?.()
    }
  }, [])

  // Global search shortcut (Ctrl+F / Cmd+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        // Focus the search input inside TopBar
        const searchInput = document.querySelector<HTMLInputElement>('input[type="text"]')
        searchInput?.focus()
        searchInput?.select()
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
            const currentDevice = await (window as any).electronAPI?.getActiveDevice?.()
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
          // Siempre re-fetch desde la fuente para respetar filtros actuales
          // (deviceId, search, tipo). El broadcast ya lleva datos normalizados
          // pero fetchData aplica los filtros correctos del estado local.
          fetchData(false)
      })
      // off() es ahora una función real — preload.ts retorna el removeListener
      return () => off?.()
    }
  }, [fetchData])

  const highlightMatch = useCallback((text: string, query: string): ReactNode[] | string => {
    const q = query?.trim()
    if (!q) return text
    // Escapamos los caracteres especiales de regex. Sin esto, buscar algo como
    // "(", "[" o "\" lanzaba una excepción al construir el RegExp y podía tumbar
    // el render de la lista completa.
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    return text.split(regex).map((part, idx) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={idx} className='bg-[color:var(--color-primary)] text-white font-semibold rounded px-0.5'>{part}</mark>
      ) : (
        <span key={idx}>{part}</span>
      )
    )
  }, [])

  // Dark Mode + Preferences
  useEffect(() => {
    async function loadDarkMode() {
        const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
        if (stored === 'true') setDarkMode(true)
    }
    async function loadPreferences() {
      try {
        const prefs = await (window as any).electronAPI?.getPreferences?.()
        if (prefs) {
          const root = document.documentElement
          // Theme is stored as JSON string in the 'theme' field
          let theme: any = {}
          if (prefs.theme) {
            try { theme = typeof prefs.theme === 'string' ? JSON.parse(prefs.theme) : prefs.theme } catch {}
          }
          if (theme.primary) root.style.setProperty('--color-primary', theme.primary)
          if (theme.secondary) root.style.setProperty('--color-secondary', theme.secondary)
          if (theme.bg) root.style.setProperty('--color-bg', theme.bg)
          if (theme.surface) root.style.setProperty('--color-surface', theme.surface)
          if (theme.text) root.style.setProperty('--color-text', theme.text)
          if (theme.fontSize) root.style.setProperty('--font-size-card', `${theme.fontSize}px`)
        }
      } catch {}
    }
    loadDarkMode()
    loadPreferences()
  }, [])

  // Listen for theme changes from tray
  useEffect(() => {
    if ((window as any).electronAPI?.onThemeChanged) {
      const off = (window as any).electronAPI.onThemeChanged((isDark: boolean) => {
        setDarkMode(isDark)
      })
      return () => off?.()
    }
  }, [])

  // Listen for preference changes from settings window
  useEffect(() => {
    if ((window as any).electronAPI?.onPreferencesChanged) {
      const off = (window as any).electronAPI.onPreferencesChanged((prefs: any) => {
        const root = document.documentElement
        if (prefs.colorPrimary) root.style.setProperty('--color-primary', prefs.colorPrimary)
        if (prefs.colorSecondary) root.style.setProperty('--color-secondary', prefs.colorSecondary)
        if (prefs.colorBg) root.style.setProperty('--color-bg', prefs.colorBg)
        if (prefs.colorSurface) root.style.setProperty('--color-surface', prefs.colorSurface)
        if (prefs.colorText) root.style.setProperty('--color-text', prefs.colorText)
        if (prefs.fontSize) root.style.setProperty('--font-size-card', `${prefs.fontSize}px`)
      })
      return () => off?.()
    }
  }, [])

  // Listen for session changes from tray (logout)
  useEffect(() => {
    if ((window as any).electronAPI?.onSessionChanged) {
      const off = (window as any).electronAPI.onSessionChanged((session: any) => {
        if (!session) {
          setToken(null)
        } else {
          loadSession()
        }
      })
      return () => off?.()
    }
  }, [loadSession])

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
            setDisplayed([])
            
            const isFirstSync = !dev?.LastSync;
            if (isFirstSync) {
                setGlobalLoadingMsg(t('device.syncing_initial') || 'Sincronizando dispositivo...')
                setGlobalLoading(true)
                fetchData(false)
            } else {
                setGlobalLoadingMsg('')
                setGlobalLoading(true)
                fetchData(false).finally(() => setGlobalLoading(false))
            }
        })
        return () => off?.()
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
        return () => off?.()
    }
  }, [fetchData])

  // Sync Listener
  useEffect(() => {
    if ((window as any).electronAPI?.onDevicesSyncComplete) {
      const off = (window as any).electronAPI.onDevicesSyncComplete((_devices: any[]) => {
          setShowDeviceSelection(true)
          notifySuccess(t('device.sync_complete') || 'Sincronización de dispositivos completada')
      })
      return () => off?.()
    }
  }, [t])

  const logout = useCallback(async () => {
    setToken(null)
    await (window as any).electronAPI?.removeConfig?.('session')
    notifySuccess(t('notifications.session_closed'))
  }, [t])

  // Expose logout for tray/admin panel usage
  useEffect(() => { (window as any).__copyfy_logout = logout }, [logout])

  const handleUpload = async () => {
    const path = await (window as any).electronAPI?.selectFile?.()
    if (!path) return
    
    notify(t('files.uploading'))
    try {
        const res = await (window as any).electronAPI?.uploadFile?.(path)
        if (res && res.success) {
            notifySuccess(t('files.uploaded'))
            fetchFiles()
        } else {
            notifyError(t('files.upload_error', { msg: res?.error || 'Unknown' }))
        }
    } catch (e) {
        notifyError(t('files.upload_error', { msg: '' }))
    }
  }

  // File deletion state
  const [fileToDelete, setFileToDelete] = useState<any | null>(null)

  const handleDeleteFile = async (file: any) => {
      setFileToDelete(file)
  }

  const confirmDeleteFile = async () => {
      if (!fileToDelete) return
      try {
          const res = await (window as any).electronAPI?.deleteFile?.(fileToDelete.id)
          if (res && res.success) {
              notifySuccess(t('files.deleted'))
              setFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
          } else {
              notifyError(t('files.delete_error'))
          }
      } catch (e) {
          notifyError(t('files.delete_error'))
      } finally {
          setFileToDelete(null)
      }
  }

  return (
    <>
      <div>
        <AppShell darkMode={darkMode}>
          <TopBar
            search={search}
            onSearchChange={setSearch}
            onClose={() => (window as any).electronAPI?.hideWindow?.()}
          />
          <Dock
            filter={filter}
            onChangeFilter={(f) => setFilter(f)}
            disabledFavorites={false}
            hasAuth={!!token}
          />

          {filter === 'documents' ? (
             <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-3 py-2 flex justify-between items-center border-b border-[color:var(--color-border)]">
                    <span className="text-sm font-medium text-[color:var(--color-text)]">{t('files.title')}</span>
                    <button 
                        onClick={handleUpload}
                        className="flex items-center gap-1 px-2 py-1 bg-[color:var(--color-primary)] text-white rounded-md text-xs hover:opacity-90 transition"
                    >
                        <DocumentPlusIcon className="w-4 h-4" />
                        <span>{t('files.upload')}</span>
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
            hasMore={hasMore}
            onLoadMore={loadMoreResults}
            isLoadingMore={isLoadingMore}
            onToggleFavorite={(item) => {
              (window as any).electronAPI?.toggleFavorite?.({ id: item.id, isFavorite: !item.favorite })
            }}
            onCopy={(item) => {
              const isImage = item.value.startsWith('data:image') || item.value.startsWith('[LOCAL_IMAGE]:') || !!(item as any).imagePath
              if (isImage) {
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
          )}

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
              <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-lg p-4 flex flex-col items-center gap-3 shadow-lg">
                <div className="w-5 h-5 border-2 border-[color:var(--color-primary)] border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sm font-medium text-[color:var(--color-text)]">{globalLoadingMsg || t('ui.processing')}</div>
              </div>
            </div>
          )}

          {/* Version */}
          <div className="px-4 py-1 text-[10px] text-[color:var(--color-muted)] text-right select-none">v{appVersion}</div>

        </AppShell>
      </div>

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
              notifySuccess(t('notifications.item_deleted'))
              // Manually remove from local state just in case the broadcast is slow or fails
              setDisplayed(prev => prev.filter(i => i.id !== itemToDelete.id))
            } catch {
              notifyError(t('notifications.delete_error'))
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
        onBack={() => { setAboutOpen(false) }}
      />
      
      <OCRModal
        isOpen={!!ocrImage}
        imageUrl={ocrImage}
        onClose={() => setOcrImage(null)}
      />

      {/* Delete file confirmation */}
      <DeleteModal
        open={!!fileToDelete}
        loading={false}
        onConfirm={confirmDeleteFile}
        onClose={() => setFileToDelete(null)}
      />
    </>
  )
}

export default App
