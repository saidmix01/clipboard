import { useState, useEffect } from 'react'
import {
  MoonIcon,
  SunIcon,
  TrashIcon,
  GlobeAltIcon,
  ComputerDesktopIcon,
  CloudArrowUpIcon,
  KeyIcon,
  PaintBrushIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { notify, notifySuccess, notifyError } from '../utils/notify'

export default function SettingsWindow() {
  const { t, i18n } = useTranslation()
  const [darkMode, setDarkMode] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  const [shortcutModifier, setShortcutModifier] = useState('Alt')
  const [shortcutKey, setShortcutKey] = useState('X')
  const [recording, setRecording] = useState<'modifier' | 'key' | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStats, setSyncStats] = useState<any>(null)
  const [appVersion, setAppVersion] = useState('')

  const [colorPrimary, setColorPrimary] = useState('#4f46e5')
  const [colorSecondary, setColorSecondary] = useState('#22c55e')
  const [fontSize, setFontSize] = useState(13)

  // Initialize theme on mount
  useEffect(() => {
    const load = async () => {
      const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
      const isDark = stored === 'true'
      setDarkMode(isDark)
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')

      const version = await (window as any).electronAPI?.getAppVersion?.()
      if (version) setAppVersion(version)

      try {
        const prefs = await (window as any).electronAPI?.getPreferences?.()
        if (prefs) {
          setStartMinimized(!!prefs.startMinimized)
          if (prefs.globalShortcut) {
            const parts = prefs.globalShortcut.split('+')
            if (parts.length >= 2) {
              setShortcutKey(parts[parts.length - 1])
              setShortcutModifier(parts[0])
            }
          }
          // Parse theme from JSON
          let theme: any = {}
          if (prefs.theme) {
            try { theme = typeof prefs.theme === 'string' ? JSON.parse(prefs.theme) : prefs.theme } catch {}
          }
          if (theme.primary) { setColorPrimary(theme.primary); document.documentElement.style.setProperty('--color-primary', theme.primary) }
          if (theme.secondary) { setColorSecondary(theme.secondary); document.documentElement.style.setProperty('--color-secondary', theme.secondary) }
          if (theme.bg) { document.documentElement.style.setProperty('--color-bg', theme.bg) }
          if (theme.surface) { document.documentElement.style.setProperty('--color-surface', theme.surface) }
          if (theme.text) { document.documentElement.style.setProperty('--color-text', theme.text) }
          if (theme.fontSize) { setFontSize(Number(theme.fontSize)); document.documentElement.style.setProperty('--font-size-card', `${theme.fontSize}px`) }
        }
      } catch {}

      loadSyncStats()
    }
    load()
  }, [])

  const loadSyncStats = async () => {
    try {
      const stats = await (window as any).electronAPI?.getSyncStats?.()
      if (stats) { setSyncStats(stats); setIsSyncing(stats.isRunning) }
    } catch {}
  }

  useEffect(() => {
    const unsub = (window as any).electronAPI?.onSyncStats?.((stats: any) => {
      setSyncStats(stats); setIsSyncing(stats.isRunning)
    })
    return () => unsub?.()
  }, [])

  const toggleDark = () => {
    const next = !darkMode
    setDarkMode(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    ;(window as any).electronAPI?.setConfig?.('darkMode', next.toString())
  }

  const toggleStartMinimized = async () => {
    const val = !startMinimized
    setStartMinimized(val)
    await (window as any).electronAPI?.setPreferences?.({ startMinimized: val })
  }

  const changeLanguage = async (lang: string) => {
    i18n.changeLanguage(lang)
    await (window as any).electronAPI?.setPreferences?.({ language: lang })
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    notify(t('settings.syncing', 'Syncing...'))
    try {
      const result = await Promise.race([
        (window as any).electronAPI?.syncNow?.(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))
      ])
      if (result) { setSyncStats(result); notifySuccess(t('notifications.sync_completed', 'Sync completed')) }
      else notifyError(t('notifications.sync_failed', 'Sync failed'))
    } catch { notifyError(t('notifications.sync_failed', 'Sync failed')) }
    finally { setIsSyncing(false) }
  }

  const handleClearHistory = async () => {
    await (window as any).electronAPI?.clearHistory?.()
    notifySuccess(t('notifications.history_cleared', 'Historial limpiado'))
  }

  const handleColorChange = async (key: string, val: string) => {
    if (key === 'colorPrimary') { setColorPrimary(val); document.documentElement.style.setProperty('--color-primary', val) }
    if (key === 'colorSecondary') { setColorSecondary(val); document.documentElement.style.setProperty('--color-secondary', val) }
    await (window as any).electronAPI?.setPreferences?.({ [key]: val })
  }

  const handleFontSizeChange = async (delta: number) => {
    const s = Math.min(Math.max(fontSize + delta, 10), 20)
    setFontSize(s)
    document.documentElement.style.setProperty('--font-size-card', `${s}px`)
    await (window as any).electronAPI?.setPreferences?.({ fontSize: s })
  }

  const formatLastSync = (ts: number | null) => {
    if (!ts) return t('settings.never_synced', 'Never')
    const diff = Math.floor((Date.now() - ts) / 60000)
    if (diff < 1) return t('time.now', 'Now')
    if (diff < 60) return t('time.mins_ago', '{{mins}} min ago', { mins: diff })
    const hours = Math.floor(diff / 60)
    if (hours < 24) return t('time.hours_ago', '{{hours}}h ago', { hours })
    return new Date(ts).toLocaleDateString()
  }

  // Keyboard shortcut recording
  useEffect(() => {
    if (!recording) return
    const handler = async (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      if (recording === 'modifier' && ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        const mod = e.key === 'Meta' ? 'Command' : e.key
        setShortcutModifier(mod)
        await (window as any).electronAPI?.setPreferences?.({ globalShortcut: `${mod}+${shortcutKey}` })
        setRecording(null)
      } else if (recording === 'key' && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        const k = e.key === ' ' ? 'Space' : e.key.toUpperCase()
        setShortcutKey(k)
        await (window as any).electronAPI?.setPreferences?.({ globalShortcut: `${shortcutModifier}+${k}` })
        setRecording(null)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording, shortcutModifier, shortcutKey])

  const closeWindow = () => {
    ;(window as any).electronAPI?.closeWindow?.()
  }

  return (
    <div className="w-screen h-screen bg-zinc-100 dark:bg-neutral-900 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl">

      {/* Custom title bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 drag_region shrink-0">
        <div className="flex items-center gap-2 no_drag">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.212-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          <h1 className="text-sm font-semibold">{t('settings.title', 'Configuración')}</h1>
        </div>
        <div className="flex items-center gap-2 no_drag">
          {appVersion && <span className="text-[11px] text-zinc-400">v{appVersion}</span>}
          <button onClick={closeWindow} className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-red-500 transition-colors" aria-label="Close">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

        {/* Sync */}
        <Section title={t('settings.sync_now', 'Sincronización')} icon={<CloudArrowUpIcon className="w-4 h-4" />}>
          <button onClick={handleSyncNow} disabled={isSyncing} className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50">
            <span>{isSyncing ? t('settings.syncing', 'Syncing...') : t('settings.sync_now', 'Sync now')}</span>
            {syncStats?.itemsPending > 0 && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-500 text-white">{syncStats.itemsPending}</span>}
          </button>
          {syncStats?.lastSyncAt && <p className="px-3 text-[11px] text-zinc-500">{formatLastSync(syncStats.lastSyncAt)}</p>}
        </Section>

        {/* Appearance */}
        <Section title={t('settings.appearance', 'Apariencia')} icon={<PaintBrushIcon className="w-4 h-4" />}>
          <Row onClick={toggleDark}>
            <span className="flex items-center gap-2 text-sm">
              {darkMode ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
              {darkMode ? t('settings.light_mode', 'Light mode') : t('settings.dark_mode', 'Dark mode')}
            </span>
          </Row>
          <div className="px-3 py-2.5">
            <p className="text-xs text-zinc-500 mb-2">{t('settings.font_size', 'Font size')}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => handleFontSizeChange(-1)} className="w-7 h-7 flex items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">−</button>
              <span className="text-xs font-mono w-10 text-center">{fontSize}px</span>
              <button onClick={() => handleFontSizeChange(1)} className="w-7 h-7 flex items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">+</button>
            </div>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-xs text-zinc-500 mb-2">{t('settings.customization', 'Colors')}</p>
            <div className="flex gap-4">
              <ColorPicker label="Primary" value={colorPrimary} onChange={(v) => handleColorChange('colorPrimary', v)} />
              <ColorPicker label="Secondary" value={colorSecondary} onChange={(v) => handleColorChange('colorSecondary', v)} />
            </div>
          </div>
        </Section>

        {/* General */}
        <Section title={t('settings.general', 'General')} icon={<ComputerDesktopIcon className="w-4 h-4" />}>
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-sm">{t('settings.start_minimized', 'Iniciar minimizado')}</span>
            <Toggle checked={startMinimized} onChange={toggleStartMinimized} />
          </div>
          <div className="px-3 py-2.5">
            <p className="text-sm mb-2">{t('settings.language', 'Idioma')}</p>
            <div className="flex gap-2">
              <LangBtn active={i18n.language.startsWith('en')} onClick={() => changeLanguage('en')} label="English" />
              <LangBtn active={i18n.language.startsWith('es')} onClick={() => changeLanguage('es')} label="Español" />
            </div>
          </div>
        </Section>

        {/* Shortcut */}
        <Section title={t('settings.shortcut_toggle', 'Atajo global')} icon={<KeyIcon className="w-4 h-4" />}>
          <div className="px-3 py-2.5 flex items-center gap-2">
            <button onClick={() => setRecording('modifier')} className={`px-3 py-1.5 rounded-md border text-sm font-mono transition-colors ${recording === 'modifier' ? 'bg-indigo-500 text-white border-indigo-500' : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              {recording === 'modifier' ? '...' : shortcutModifier}
            </button>
            <span className="text-zinc-400">+</span>
            <button onClick={() => setRecording('key')} className={`px-3 py-1.5 rounded-md border text-sm font-mono transition-colors ${recording === 'key' ? 'bg-indigo-500 text-white border-indigo-500' : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              {recording === 'key' ? '...' : shortcutKey}
            </button>
          </div>
          <p className="px-3 pb-2 text-[11px] text-zinc-500">{t('settings.shortcut_desc', 'Click the button then press the desired key')}</p>
        </Section>

        {/* Danger zone */}
        <Section title={t('settings.danger_zone', 'Danger zone')} icon={<TrashIcon className="w-4 h-4 text-red-500" />} danger>
          <button onClick={handleClearHistory} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
            <TrashIcon className="w-4 h-4" />
            {t('settings.clear_history', 'Limpiar todo el historial')}
          </button>
        </Section>

        {/* About */}
        <Section title={t('settings.about', 'Acerca de')} icon={<InformationCircleIcon className="w-4 h-4" />}>
          <div className="px-3 py-2.5 text-sm text-zinc-500">
            <p className="text-zinc-900 dark:text-zinc-100 font-medium">CopyFy++ v{appVersion}</p>
            <p className="text-xs mt-1">{t('about.description', 'Clipboard manager with cloud sync')}</p>
          </div>
        </Section>

      </div>
    </div>
  )
}

/* ─── Sub-components ─── */

function Section({ title, icon, children, danger }: { title: string; icon: React.ReactNode; children: React.ReactNode; danger?: boolean }) {
  return (
    <div>
      <div className={`flex items-center gap-2 mb-1.5 ${danger ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
        {icon}
        <h2 className="text-[11px] font-semibold uppercase tracking-wider">{title}</h2>
      </div>
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
        {children}
      </div>
    </div>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left">
      {children}
    </button>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function LangBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${active ? 'bg-indigo-500 text-white border-indigo-500' : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
      <GlobeAltIcon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-7 cursor-pointer bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-0.5" />
      <span className="text-[11px] text-zinc-500">{label}</span>
    </div>
  )
}
