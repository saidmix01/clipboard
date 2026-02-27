import { useState, useEffect } from 'react'
import DetailsModal from './DetailsModal'
import { ArrowPathIcon, MoonIcon, SunIcon, TrashIcon, InformationCircleIcon, Cog6ToothIcon, ChevronLeftIcon, GlobeAltIcon, ComputerDesktopIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

type Props = {
  open: boolean
  darkMode: boolean
  onClose: () => void
  onForceUpdate: () => void
  onToggleDark: () => void
  onClearHistory: () => void
  onOpenAbout: () => void
  onChangeDevice?: () => void
  onSyncNow?: () => void
}

export default function SettingsMenu({ open, darkMode, onClose, onForceUpdate, onToggleDark, onClearHistory, onOpenAbout, onChangeDevice }: Props) {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<'main' | 'general'>('main')
  const [startMinimized, setStartMinimized] = useState(false)
  const [shortcutModifier, setShortcutModifier] = useState('Alt')
  const [shortcutKey, setShortcutKey] = useState('X')
  const [recording, setRecording] = useState<'modifier' | 'key' | null>(null)
  
  // Sync state
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStats, setSyncStats] = useState<any>(null)
  
  const [colorPrimary, setColorPrimary] = useState('#0a84ff')
  const [colorSecondary, setColorSecondary] = useState('#34c759')
  const [colorBg, setColorBg] = useState('#f6f6f7')
  const [colorSurface, setColorSurface] = useState('#ffffff')
  const [colorText, setColorText] = useState('#1f2937')
  const [fontSize, setFontSize] = useState(14)

  useEffect(() => {
    if (open) {
      setView('main')
      setRecording(null)
      
      // Load sync stats
      loadSyncStats()
      
      try {
        ;(window as any).electronAPI?.getPreferences?.().then((prefs: any) => {
          setStartMinimized(!!prefs?.startMinimized)
          if (prefs?.globalShortcut) {
            const parts = prefs.globalShortcut.split('+')
            if (parts.length >= 2) {
                setShortcutKey(parts[parts.length - 1])
                const mods = parts.slice(0, parts.length - 1)
                setShortcutModifier(mods[0])
            }
          }
          if (prefs?.colorPrimary) setColorPrimary(prefs.colorPrimary)
          else {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
            if (v) setColorPrimary(v)
          }
          if (prefs?.colorSecondary) setColorSecondary(prefs.colorSecondary)
          else {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--color-secondary').trim()
            if (v) setColorSecondary(v)
          }
          if (prefs?.colorBg) setColorBg(prefs.colorBg)
          else {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
            if (v) setColorBg(v)
          }
          if (prefs?.colorSurface) setColorSurface(prefs.colorSurface)
          else {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim()
            if (v) setColorSurface(v)
          }
          if (prefs?.colorText) setColorText(prefs.colorText)
          else {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim()
            if (v) setColorText(v)
          }
          if (prefs?.fontSize) setFontSize(Number(prefs.fontSize))
          else {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--font-size-card').trim()
            const n = parseInt(v)
            if (!isNaN(n)) setFontSize(n)
          }
        })
      } catch {}
    }
  }, [open])

  // Listen to sync stats updates
  useEffect(() => {
    if (!open) return
    
    const unsubscribe = (window as any).electronAPI?.onSyncStats?.((stats: any) => {
      setSyncStats(stats)
      setIsSyncing(stats.isRunning)
    })
    
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [open])

  const loadSyncStats = async () => {
    try {
      const stats = await (window as any).electronAPI?.getSyncStats?.()
      if (stats) {
        setSyncStats(stats)
        setIsSyncing(stats.isRunning)
      }
    } catch (e) {
      console.error('Error loading sync stats:', e)
    }
  }

  const handleSyncNow = async () => {
    try {
      setIsSyncing(true)
      toast.loading(t('settings.syncing'), { id: 'sync-toast' })
      
      // Verificar que la API existe
      if (!(window as any).electronAPI?.syncNow) {
        throw new Error('Sync API not available')
      }
      
      // Timeout de 30 segundos
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Sync timeout')), 30000)
      })
      
      const syncPromise = (window as any).electronAPI.syncNow()
      
      const result = await Promise.race([syncPromise, timeoutPromise])
      
      if (result) {
        setSyncStats(result)
        toast.success(t('notifications.sync_completed'), { id: 'sync-toast' })
      } else {
        toast.error(t('notifications.sync_failed'), { id: 'sync-toast' })
      }
    } catch (e: any) {
      console.error('Error syncing:', e)
      const errorMsg = e.message === 'Sync timeout' 
        ? 'Timeout: La sincronización está tardando demasiado'
        : e.message === 'Sync API not available'
        ? 'API de sincronización no disponible. Recompila el proyecto.'
        : t('notifications.sync_failed')
      toast.error(errorMsg, { id: 'sync-toast' })
    } finally {
      setIsSyncing(false)
    }
  }

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return t('settings.never_synced')
    
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return t('settings.last_sync', { time: 'hace un momento' })
    if (diffMins < 60) return t('settings.last_sync', { time: `hace ${diffMins} min` })
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return t('settings.last_sync', { time: `hace ${diffHours}h` })
    
    return t('settings.last_sync', { time: date.toLocaleDateString() })
  }

  useEffect(() => {
    if (!recording) return

    const handler = async (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(null)
        return
      }

      if (recording === 'modifier') {
        const key = e.key
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
          let mod = key
          if (mod === 'Meta') mod = 'Command'
          setShortcutModifier(mod)
          const newShortcut = `${mod}+${shortcutKey}`
          await (window as any).electronAPI?.setPreferences?.({ globalShortcut: newShortcut })
          setRecording(null)
        }
      } else if (recording === 'key') {
        const key = e.key
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
          let k = key.toUpperCase()
          if (key === ' ') k = 'Space'
          setShortcutKey(k)
          const newShortcut = `${shortcutModifier}+${k}`
          await (window as any).electronAPI?.setPreferences?.({ globalShortcut: newShortcut })
          setRecording(null)
        }
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording]) // Correcto, quitamos las dependencias que no cambian dentro del efecto

  const toggleStartMinimized = async () => {
    const newVal = !startMinimized
    setStartMinimized(newVal)
    try {
      await (window as any).electronAPI?.setPreferences?.({ startMinimized: newVal })
    } catch {}
  }
  
  const handleColorChange = async (key: 'colorPrimary' | 'colorSecondary' | 'colorBg' | 'colorSurface' | 'colorText', val: string) => {
    if (key === 'colorPrimary') setColorPrimary(val)
    else if (key === 'colorSecondary') setColorSecondary(val)
    else if (key === 'colorBg') setColorBg(val)
    else if (key === 'colorSurface') setColorSurface(val)
    else setColorText(val)
    
    // Aplicar inmediatamente
    let prop = ''
    if (key === 'colorPrimary') prop = '--color-primary'
    else if (key === 'colorSecondary') prop = '--color-secondary'
    else if (key === 'colorBg') prop = '--color-bg'
    else if (key === 'colorSurface') prop = '--color-surface'
    else prop = '--color-text'

    document.documentElement.style.setProperty(prop, val)
    
    try {
      await (window as any).electronAPI?.setPreferences?.({ [key]: val })
    } catch {}
  }

  const handleFontSizeChange = async (delta: number) => {
    const newSize = Math.min(Math.max(fontSize + delta, 10), 24)
    setFontSize(newSize)
    document.documentElement.style.setProperty('--font-size-card', `${newSize}px`)
    try {
      await (window as any).electronAPI?.setPreferences?.({ fontSize: newSize })
    } catch {}
  }

  const resetColors = async () => {
    document.documentElement.style.removeProperty('--color-primary')
    document.documentElement.style.removeProperty('--color-secondary')
    document.documentElement.style.removeProperty('--color-bg')
    document.documentElement.style.removeProperty('--color-surface')
    document.documentElement.style.removeProperty('--color-text')
    document.documentElement.style.removeProperty('--font-size-card')
    setColorPrimary('#0a84ff')
    setColorSecondary('#34c759')
    setColorBg('#f6f6f7')
    setColorSurface('#ffffff')
    setColorText('#1f2937')
    setFontSize(14)
    try {
      await (window as any).electronAPI?.setPreferences?.({ 
        colorPrimary: undefined, 
        colorSecondary: undefined,
        colorBg: undefined,
        colorSurface: undefined,
        colorText: undefined,
        fontSize: undefined
      })
    } catch {}
  }

  const changeLanguage = async (lang: string) => {
    i18n.changeLanguage(lang)
    try {
      await (window as any).electronAPI?.setPreferences?.({ language: lang })
    } catch {}
  }

  const menuBtnClass = `flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors duration-200 hover:text-white`
  

  const MouseOver = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--color-primary)'
    e.currentTarget.style.color = '#ffffff'
  }
  const MouseOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent'
    e.currentTarget.style.color = 'var(--color-text)'
  }

  if (!open) return null

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="p-1">
        {view === 'main' ? (
          <>
            <h3 className="m-0 text-[color:var(--color-text)]">{t('settings.title')}</h3>
            <div className="flex flex-col mt-2">
              {/* Sync Now Button */}
              <button 
                className={`${menuBtnClass} ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                onMouseEnter={!isSyncing ? MouseOver : undefined} 
                onMouseLeave={!isSyncing ? MouseOut : undefined} 
                onClick={handleSyncNow}
                disabled={isSyncing}
              >
                <CloudArrowUpIcon className={`w-5 h-5 ${isSyncing ? 'animate-bounce' : ''}`} />
                <div className="flex flex-col items-start flex-1">
                  <span>{isSyncing ? t('settings.syncing') : t('settings.sync_now')}</span>
                  {syncStats && (
                    <span className="text-xs opacity-70">
                      {syncStats.lastSyncAt 
                        ? formatLastSync(syncStats.lastSyncAt)
                        : t('settings.never_synced')
                      }
                    </span>
                  )}
                </div>
                {syncStats && syncStats.itemsPending > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-[color:var(--color-primary)] text-white">
                    {syncStats.itemsPending}
                  </span>
                )}
              </button>
              
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onChangeDevice}>
                <ComputerDesktopIcon className="w-5 h-5" />
                <span>{t('device.title')}</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={() => setView('general')}>
                <Cog6ToothIcon className="w-5 h-5" />
                <span>{t('settings.general')}</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onForceUpdate}>
                <ArrowPathIcon className="w-5 h-5" />
                <span>{t('settings.check_updates')}</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onClearHistory}>
                <TrashIcon className="w-5 h-5" />
                <span>{t('settings.clear_history')}</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onOpenAbout}>
                <InformationCircleIcon className="w-5 h-5" />
                <span>{t('settings.about')}</span>
              </button>
            </div>
          </>
        ) : (
          <>
             <div className="flex items-center gap-2 mb-4">
               <button onClick={() => setView('main')} className="p-1 rounded-full hover:text-white" onMouseEnter={MouseOver} onMouseLeave={MouseOut}>
                 <ChevronLeftIcon className="w-5 h-5" />
               </button>
               <h3 className="m-0 text-[color:var(--color-text)]">{t('settings.general')}</h3>
             </div>
             <div className="flex flex-col gap-6 px-2">
               {/* Inicio minimizado */}
               <div className="flex flex-col gap-2">
                 <div className="flex items-center justify-between">
                   <span className="text-[color:var(--color-text)]">{t('settings.start_minimized')}</span>
                   <button 
                     onClick={toggleStartMinimized}
                     className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors`}
                     style={{ backgroundColor: startMinimized ? 'var(--color-primary)' : 'var(--color-muted)' }}
                   >
                     <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${startMinimized ? 'translate-x-6' : 'translate-x-1'}`} />
                   </button>
                 </div>
                 <p className="text-xs text-[color:var(--color-muted)]">
                   {t('settings.start_minimized_desc')}
                 </p>
               </div>

               {/* Atajo de teclado */}
               <div className="flex flex-col gap-2">
                 <span className="text-[color:var(--color-text)]">{t('settings.shortcut_toggle')}</span>
                 <div className="flex items-center gap-2">
                   <button 
                     className={`px-3 py-1.5 rounded border ${recording === 'modifier' ? 'bg-[color:var(--color-primary)] text-white' : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]'}`}
                     style={recording === 'modifier' ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : {}}
                     onClick={() => setRecording('modifier')}
                   >
                     {recording === 'modifier' ? '...' : shortcutModifier}
                   </button>
                   <span className="text-[color:var(--color-muted)]">+</span>
                   <button 
                     className={`px-3 py-1.5 rounded border ${recording === 'key' ? 'bg-[color:var(--color-primary)] text-white' : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]'}`}
                     style={recording === 'key' ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : {}}
                     onClick={() => setRecording('key')}
                   >
                     {recording === 'key' ? '...' : shortcutKey}
                   </button>
                 </div>
                 <p className="text-xs text-[color:var(--color-muted)]">
                   {t('settings.shortcut_desc')}
                 </p>
               </div>

               {/* Idioma */}
               <div className="flex flex-col gap-2">
                  <span className="text-[color:var(--color-text)]">{t('settings.language')}</span>
                  <div className="flex items-center gap-2">
                    <button 
                      className={`flex items-center gap-2 px-3 py-1.5 rounded border ${i18n.language.startsWith('en') ? 'bg-[color:var(--color-primary)] text-white' : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]'}`}
                      style={i18n.language.startsWith('en') ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : {}}
                      onClick={() => changeLanguage('en')}
                    >
                      <GlobeAltIcon className="w-4 h-4" />
                      {t('settings.lang_en')}
                    </button>
                    <button 
                      className={`flex items-center gap-2 px-3 py-1.5 rounded border ${i18n.language.startsWith('es') ? 'bg-[color:var(--color-primary)] text-white' : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]'}`}
                      style={i18n.language.startsWith('es') ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : {}}
                      onClick={() => changeLanguage('es')}
                    >
                      <GlobeAltIcon className="w-4 h-4" />
                      {t('settings.lang_es')}
                    </button>
                  </div>
               </div>

               {/* Personalización de colores */}
               <div className="flex flex-col gap-3">
                 <div className="flex items-center justify-between">
                   <span className="text-[color:var(--color-text)]">{t('settings.customization')}</span>
                   <div className="flex items-center gap-2">
                    <button 
                        onClick={onToggleDark}
                        className="p-1 rounded hover:bg-[color:var(--color-bg)] text-[color:var(--color-text)]"
                        title={darkMode ? t('settings.light_mode') : t('settings.dark_mode')}
                      >
                        {darkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                      </button>
                     <button 
                       onClick={resetColors} 
                       className="px-2 py-1 text-xs rounded border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface)] transition-colors text-[color:var(--color-text)]"
                       title={t('settings.reset_colors')}
                     >
                       {t('settings.reset_colors')}
                     </button>
                   </div>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">{t('settings.primary')}</label>
                     <div className="flex items-center gap-2">
                       <input 
                         type="color" 
                         value={colorPrimary}
                         onChange={e => handleColorChange('colorPrimary', e.target.value)}
                         className="h-8 w-12 cursor-pointer bg-transparent border-none p-0"
                       />
                       <span className="text-xs font-mono text-[color:var(--color-muted)]">{colorPrimary}</span>
                     </div>
                   </div>
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">{t('settings.secondary')}</label>
                     <div className="flex items-center gap-2">
                       <input 
                         type="color" 
                         value={colorSecondary}
                         onChange={e => handleColorChange('colorSecondary', e.target.value)}
                         className="h-8 w-12 cursor-pointer bg-transparent border-none p-0"
                       />
                       <span className="text-xs font-mono text-[color:var(--color-muted)]">{colorSecondary}</span>
                     </div>
                   </div>
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">{t('settings.bg_app')}</label>
                     <div className="flex items-center gap-2">
                       <input 
                         type="color" 
                         value={colorSurface}
                         onChange={e => handleColorChange('colorSurface', e.target.value)}
                         className="h-8 w-12 cursor-pointer bg-transparent border-none p-0"
                       />
                       <span className="text-xs font-mono text-[color:var(--color-muted)]">{colorSurface}</span>
                     </div>
                   </div>
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">{t('settings.bg_base')}</label>
                     <div className="flex items-center gap-2">
                       <input 
                         type="color" 
                         value={colorBg}
                         onChange={e => handleColorChange('colorBg', e.target.value)}
                         className="h-8 w-12 cursor-pointer bg-transparent border-none p-0"
                       />
                       <span className="text-xs font-mono text-[color:var(--color-muted)]">{colorBg}</span>
                     </div>
                   </div>
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">{t('settings.text')}</label>
                     <div className="flex items-center gap-2">
                       <input 
                         type="color" 
                         value={colorText}
                         onChange={e => handleColorChange('colorText', e.target.value)}
                         className="h-8 w-12 cursor-pointer bg-transparent border-none p-0"
                       />
                       <span className="text-xs font-mono text-[color:var(--color-muted)]">{colorText}</span>
                     </div>
                   </div>
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">{t('settings.font_size')}</label>
                     <div className="flex items-center gap-2 h-8">
                       <button 
                         onClick={() => handleFontSizeChange(-1)} 
                         className="w-6 h-6 flex items-center justify-center rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg)]"
                       >
                         -
                       </button>
                       <span className="text-xs font-mono w-8 text-center text-[color:var(--color-text)]">{fontSize}px</span>
                       <button 
                         onClick={() => handleFontSizeChange(1)} 
                         className="w-6 h-6 flex items-center justify-center rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg)]"
                       >
                         +
                       </button>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
          </>
        )}
      </div>
    </DetailsModal>
  )
}
