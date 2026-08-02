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
  UserCircleIcon,
  Cog6ToothIcon,
  PlusIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { notify, notifySuccess, notifyError } from '../utils/notify'
import { backendRequest } from '../api/backend'

type TabId = 'general' | 'devices' | 'profile'

export default function SettingsWindow() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    const load = async () => {
      const version = await (window as any).electronAPI?.getAppVersion?.()
      if (version) setAppVersion(version)
    }
    load()
  }, [])

  const closeWindow = () => {
    ;(window as any).electronAPI?.closeWindow?.()
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: t('settings.tab_general', 'Settings'), icon: <Cog6ToothIcon className="w-4 h-4" /> },
    { id: 'devices', label: t('settings.tab_devices', 'Devices'), icon: <ComputerDesktopIcon className="w-4 h-4" /> },
    { id: 'profile', label: t('settings.tab_profile', 'Profile'), icon: <UserCircleIcon className="w-4 h-4" /> },
  ]

  return (
    <div className="w-screen h-screen bg-zinc-100 dark:bg-neutral-900 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl">
      {/* Custom title bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 drag_region shrink-0">
        <div className="flex items-center gap-2 no_drag">
          <Cog6ToothIcon className="w-4 h-4 text-indigo-500" />
          <h1 className="text-sm font-semibold">{t('settings.title', 'Settings')}</h1>
        </div>
        <div className="flex items-center gap-2 no_drag">
          {appVersion && <span className="text-[11px] text-zinc-400">v{appVersion}</span>}
          <button onClick={closeWindow} className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-red-500 transition-colors" aria-label="Close">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar tabs */}
        <nav className="w-44 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-neutral-950 py-3 px-2 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'devices' && <DevicesTab />}
          {activeTab === 'profile' && <ProfileTab />}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   GENERAL TAB — Sync, appearance, shortcuts, language, danger zone
   ═══════════════════════════════════════════════════════════════════ */

function GeneralTab() {
  const { t, i18n } = useTranslation()
  const [darkMode, setDarkMode] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  const [shortcutModifier, setShortcutModifier] = useState('Alt')
  const [shortcutKey, setShortcutKey] = useState('X')
  const [recording, setRecording] = useState<'modifier' | 'key' | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStats, setSyncStats] = useState<any>(null)
  const [colorPrimary, setColorPrimary] = useState('#4f46e5')
  const [colorSecondary, setColorSecondary] = useState('#22c55e')
  const [fontSize, setFontSize] = useState(13)

  useEffect(() => {
    const load = async () => {
      const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
      setDarkMode(stored === 'true')
      document.documentElement.setAttribute('data-theme', stored === 'true' ? 'dark' : 'light')
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
          let theme: any = {}
          if (prefs.theme) {
            try { theme = typeof prefs.theme === 'string' ? JSON.parse(prefs.theme) : prefs.theme } catch {}
          }
          if (theme.primary) { setColorPrimary(theme.primary); document.documentElement.style.setProperty('--color-primary', theme.primary) }
          if (theme.secondary) { setColorSecondary(theme.secondary); document.documentElement.style.setProperty('--color-secondary', theme.secondary) }
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
    notifySuccess(t('notifications.history_cleared', 'History cleared'))
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
    if (diff < 1) return t('settings.last_sync_just_now', 'just now')
    if (diff < 60) return t('settings.last_sync_mins', '{{mins}} min ago', { mins: diff })
    const hours = Math.floor(diff / 60)
    if (hours < 24) return t('settings.last_sync_hours', '{{hours}}h ago', { hours })
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

  return (
    <div className="space-y-6">
      {/* Sync */}
      <Section title={t('settings.sync_now', 'Sync')} icon={<CloudArrowUpIcon className="w-4 h-4" />}>
        <button onClick={handleSyncNow} disabled={isSyncing} className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50">
          <span>{isSyncing ? t('settings.syncing', 'Syncing...') : t('settings.sync_now', 'Sync now')}</span>
          {syncStats?.itemsPending > 0 && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-500 text-white">{syncStats.itemsPending}</span>}
        </button>
        {syncStats?.lastSyncAt && <p className="px-3 text-[11px] text-zinc-500">{formatLastSync(syncStats.lastSyncAt)}</p>}
      </Section>

      {/* Appearance */}
      <Section title={t('settings.appearance', 'Appearance')} icon={<PaintBrushIcon className="w-4 h-4" />}>
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
          <span className="text-sm">{t('settings.start_minimized', 'Start minimized')}</span>
          <Toggle checked={startMinimized} onChange={toggleStartMinimized} />
        </div>
        <div className="px-3 py-2.5">
          <p className="text-sm mb-2">{t('settings.language', 'Language')}</p>
          <div className="flex gap-2">
            <LangBtn active={i18n.language.startsWith('en')} onClick={() => changeLanguage('en')} label="English" />
            <LangBtn active={i18n.language.startsWith('es')} onClick={() => changeLanguage('es')} label="Español" />
          </div>
        </div>
      </Section>

      {/* Shortcut */}
      <Section title={t('settings.shortcut_toggle', 'Global shortcut')} icon={<KeyIcon className="w-4 h-4" />}>
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
          {t('settings.clear_history', 'Clear all history')}
        </button>
      </Section>

      {/* About */}
      <Section title={t('settings.about', 'About')} icon={<InformationCircleIcon className="w-4 h-4" />}>
        <div className="px-3 py-2.5 text-sm text-zinc-500">
          <p className="text-zinc-900 dark:text-zinc-100 font-medium">CopyFy++</p>
          <p className="text-xs mt-1">{t('about.description', 'Clipboard manager with cloud sync')}</p>
        </div>
      </Section>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   DEVICES TAB — List, select, and create devices
   ═══════════════════════════════════════════════════════════════════ */

function DevicesTab() {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<any[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'list' | 'create'>('list')
  const [newDeviceName, setNewDeviceName] = useState('')

  useEffect(() => { loadDevices() }, [])

  const loadDevices = async () => {
    try {
      setLoading(true)
      const all = await (window as any).electronAPI?.getAllDevices?.()
      const current = await (window as any).electronAPI?.getActiveDevice?.()
      setDevices(all || [])
      if (current) setCurrentDeviceId(current.Id)
    } catch {
      // Silently fail — user may not be logged in
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = async (device: any) => {
    try {
      setLoading(true)
      await (window as any).electronAPI?.setActiveDevice?.(device.Id)
      setCurrentDeviceId(device.Id)
      notifySuccess(t('device.apply'))
    } catch (e) {
      notifyError('Error changing device')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDeviceName.trim()) return
    try {
      setLoading(true)
      await (window as any).electronAPI?.registerNewDevice?.(newDeviceName)
      notifySuccess(t('device.created'))
      setView('list')
      setNewDeviceName('')
      loadDevices()
    } catch {
      notifyError(t('device.create_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ComputerDesktopIcon className="w-5 h-5 text-indigo-500" />
          <h2 className="text-base font-semibold">{t('device.title', 'Devices')}</h2>
        </div>
        {view === 'list' && (
          <button onClick={() => setView('create')} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition-colors">
            <PlusIcon className="w-4 h-4" />
            {t('device.new_device', 'New device')}
          </button>
        )}
      </div>

      {view === 'list' ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">{t('device.select_label', 'Select a device to view its clipboard')}</p>
          {loading && devices.length === 0 ? (
            <p className="text-center text-xs text-zinc-400 py-4">{t('ui.loading', 'Loading...')}</p>
          ) : devices.length === 0 ? (
            <p className="text-center text-xs text-zinc-400 py-4">{t('device.no_devices', 'No devices')}</p>
          ) : (
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
              {devices.map((dev) => (
                <button
                  key={dev.Id}
                  onClick={() => handleSelect(dev)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    dev.Id === currentDeviceId
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{dev.Name}</span>
                    <span className="text-[10px] text-zinc-400">{dev.OsName} • {new Date(dev.UpdatedAt).toLocaleDateString()}</span>
                  </div>
                  {dev.Id === currentDeviceId && <CheckCircleIcon className="w-5 h-5 text-indigo-500" />}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleCreate} className="space-y-3">
          <p className="text-sm text-zinc-500">{t('device.register_desc', 'Assign a name to register a new device.')}</p>
          <input
            type="text"
            value={newDeviceName}
            onChange={(e) => setNewDeviceName(e.target.value)}
            placeholder={t('device.name_placeholder', 'E.g. Work Laptop')}
            className="w-full px-3 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setView('list')} className="flex-1 h-9 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              {t('device.cancel', 'Cancel')}
            </button>
            <button type="submit" disabled={loading || !newDeviceName.trim()} className="flex-1 h-9 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
              {loading ? '...' : t('device.apply', 'Create')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   PROFILE TAB — User name, avatar, password change
   ═══════════════════════════════════════════════════════════════════ */

function ProfileTab() {
  const { t } = useTranslation()
  const [user, setUser] = useState<any>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => { loadUser() }, [])

  const loadUser = async () => {
    try {
      setLoadingUser(true)
      const res: any = await backendRequest('/users/me')
      const payload = res?.data?.user || res?.data || res?.user || res
      if (payload) {
        setUser(payload)
        setName(payload.name || '')
        if (payload.avatarUrl) {
          // Resolve avatar URL
          const url = payload.avatarUrl.startsWith('http') ? payload.avatarUrl : `https://backend-copyfy.onrender.com/${payload.avatarUrl.replace(/^\//, '')}`
          setAvatarPreview(url)
        }
      }
    } catch {
      // Silently fail — user is not logged in, no notification needed
      setUser(null)
    } finally {
      setLoadingUser(false)
    }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAvatarFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setAvatarPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password && password !== confirmPassword) {
      notifyError(t('auth.error_password_mismatch', 'Passwords do not match'))
      return
    }
    try {
      setLoading(true)
      const updateData: any = {}
      if (name !== user?.name) updateData.name = name
      if (password) updateData.password = password

      if (Object.keys(updateData).length > 0) {
        await backendRequest('/users/me', 'PUT', updateData)
      }

      // Avatar upload if file selected
      if (avatarFile) {
        // Read file as base64 and send via backend request
        const reader = new FileReader()
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(avatarFile)
        })
        const base64 = await base64Promise
        await backendRequest('/users/me/avatar', 'POST', { avatar: base64, mimeType: avatarFile.type })
      }

      notifySuccess(t('user.update', 'Profile updated'))
      setPassword('')
      setConfirmPassword('')
      setAvatarFile(null)
      loadUser()
    } catch (err: any) {
      notifyError(t('user.error_update', 'Could not update'))
    } finally {
      setLoading(false)
    }
  }

  if (loadingUser) {
    return <p className="text-center text-sm text-zinc-400 py-8">{t('ui.loading', 'Loading...')}</p>
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <UserCircleIcon className="w-12 h-12 text-zinc-300" />
        <p className="text-sm text-zinc-500">{t('user.not_authenticated', 'Not authenticated')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <UserCircleIcon className="w-5 h-5 text-indigo-500" />
        <h2 className="text-base font-semibold">{t('user.title', 'User Profile')}</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full border-2 border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <UserCircleIcon className="w-10 h-10 text-zinc-400" />
            )}
          </div>
          <div>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors">
              {t('user.choose_image', 'Choose image')}
              <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </label>
            <p className="text-[10px] text-zinc-400 mt-1">{user.email}</p>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">{t('user.name_label', 'Name')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">{t('user.password_label', 'Password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('user.new_password_placeholder', 'New password (leave blank to keep)')}
            className="w-full px-3 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {password && (
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">{t('user.confirm_password_placeholder', 'Confirm password')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('user.confirm_password_placeholder', 'Confirm password')}
              className="w-full px-3 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full h-9 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {loading ? '...' : t('user.update', 'Update')}
        </button>
      </form>
    </div>
  )
}

/* ─── Shared Sub-components ─── */

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
