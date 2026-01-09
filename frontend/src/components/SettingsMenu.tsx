import { useState, useEffect } from 'react'
import DetailsModal from './DetailsModal'
import { ComputerDesktopIcon, ArrowPathIcon, MoonIcon, SunIcon, TrashIcon, CloudArrowDownIcon, InformationCircleIcon, Cog6ToothIcon, ChevronLeftIcon } from '@heroicons/react/24/outline'

type Props = {
  open: boolean
  darkMode: boolean
  onClose: () => void
  onChangeDevice: () => void
  onForceUpdate: () => void
  onToggleDark: () => void
  onClearHistory: () => void
  onSyncNow: () => void
  onOpenAbout: () => void
}

export default function SettingsMenu({ open, darkMode, onClose, onChangeDevice, onForceUpdate, onToggleDark, onClearHistory, onSyncNow, onOpenAbout }: Props) {
  const [view, setView] = useState<'main' | 'general'>('main')
  const [startMinimized, setStartMinimized] = useState(false)
  const [shortcutModifier, setShortcutModifier] = useState('Alt')
  const [shortcutKey, setShortcutKey] = useState('X')
  const [recording, setRecording] = useState<'modifier' | 'key' | null>(null)
  
  const [colorPrimary, setColorPrimary] = useState('#0a84ff')
  const [colorSecondary, setColorSecondary] = useState('#34c759')

  useEffect(() => {
    if (open) {
      setView('main')
      setRecording(null)
      try {
        ;(window as any).electronAPI?.getPreferences?.().then((prefs: any) => {
          setStartMinimized(!!prefs?.startMinimized)
          if (prefs?.shortcutModifier) setShortcutModifier(prefs.shortcutModifier)
          if (prefs?.shortcutKey) setShortcutKey(prefs.shortcutKey)
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
        })
      } catch {}
    }
  }, [open])

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
          await (window as any).electronAPI?.setPreferences?.({ shortcutModifier: mod })
          setRecording(null)
        }
      } else if (recording === 'key') {
        const key = e.key
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
          let k = key.toUpperCase()
          if (key === ' ') k = 'Space'
          setShortcutKey(k)
          await (window as any).electronAPI?.setPreferences?.({ shortcutKey: k })
          setRecording(null)
        }
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording])

  const toggleStartMinimized = async () => {
    const newVal = !startMinimized
    setStartMinimized(newVal)
    try {
      await (window as any).electronAPI?.setPreferences?.({ startMinimized: newVal })
    } catch {}
  }
  
  const handleColorChange = async (key: 'colorPrimary' | 'colorSecondary' | 'colorBg' | 'colorSurface', val: string) => {
    if (key === 'colorPrimary') setColorPrimary(val)
    else if (key === 'colorSecondary') setColorSecondary(val)
    else if (key === 'colorBg') setColorBg(val)
    else setColorSurface(val)
    
    // Aplicar inmediatamente
    let prop = ''
    if (key === 'colorPrimary') prop = '--color-primary'
    else if (key === 'colorSecondary') prop = '--color-secondary'
    else if (key === 'colorBg') prop = '--color-bg'
    else prop = '--color-surface'

    document.documentElement.style.setProperty(prop, val)
    
    try {
      await (window as any).electronAPI?.setPreferences?.({ [key]: val })
    } catch {}
  }

  const resetColors = async () => {
    document.documentElement.style.removeProperty('--color-primary')
    document.documentElement.style.removeProperty('--color-secondary')
    document.documentElement.style.removeProperty('--color-bg')
    document.documentElement.style.removeProperty('--color-surface')
    setColorPrimary('#0a84ff')
    setColorSecondary('#34c759')
    setColorBg('#f6f6f7')
    setColorSurface('#ffffff')
    try {
      await (window as any).electronAPI?.setPreferences?.({ 
        colorPrimary: undefined, 
        colorSecondary: undefined,
        colorBg: undefined,
        colorSurface: undefined
      })
    } catch {}
  }

  if (!open) return null

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="p-1">
        {view === 'main' ? (
          <>
            <h3 className="m-0 text-[color:var(--color-text)]">Ajustes</h3>
            <div className="flex flex-col mt-2">
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={() => setView('general')}>
                <Cog6ToothIcon className="w-5 h-5" />
                <span>Configuración general</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onSyncNow}>
                <CloudArrowDownIcon className="w-5 h-5" />
                <span>Sincronizar ahora</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onChangeDevice}>
                <ComputerDesktopIcon className="w-5 h-5" />
                <span>Cambiar dispositivo</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onForceUpdate}>
                <ArrowPathIcon className="w-5 h-5" />
                <span>Buscar actualizaciones</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onToggleDark}>
                {darkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                <span>{darkMode ? 'Modo claro' : 'Modo oscuro'}</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onClearHistory}>
                <TrashIcon className="w-5 h-5" />
                <span>Borrar historial</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[color:var(--color-bg)]" onClick={onOpenAbout}>
                <InformationCircleIcon className="w-5 h-5" />
                <span>Acerca de</span>
              </button>
            </div>
          </>
        ) : (
          <>
             <div className="flex items-center gap-2 mb-4">
               <button onClick={() => setView('main')} className="p-1 rounded-full hover:bg-[color:var(--color-bg)]">
                 <ChevronLeftIcon className="w-5 h-5" />
               </button>
               <h3 className="m-0 text-[color:var(--color-text)]">Configuración general</h3>
             </div>
             <div className="flex flex-col gap-6 px-2">
               {/* Inicio minimizado */}
               <div className="flex flex-col gap-2">
                 <div className="flex items-center justify-between">
                   <span className="text-[color:var(--color-text)]">Iniciar minimizada</span>
                   <button 
                     onClick={toggleStartMinimized}
                     className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${startMinimized ? 'bg-blue-600' : 'bg-gray-400'}`}
                   >
                     <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${startMinimized ? 'translate-x-6' : 'translate-x-1'}`} />
                   </button>
                 </div>
                 <p className="text-xs text-[color:var(--color-muted)]">
                   Si está activado, la aplicación se iniciará en la bandeja del sistema sin mostrar la ventana principal.
                 </p>
               </div>

               {/* Atajo de teclado */}
               <div className="flex flex-col gap-2">
                 <span className="text-[color:var(--color-text)]">Atajo para mostrar/ocultar</span>
                 <div className="flex items-center gap-2">
                   <button 
                     className={`px-3 py-1.5 rounded border ${recording === 'modifier' ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]'}`}
                     onClick={() => setRecording('modifier')}
                   >
                     {recording === 'modifier' ? '...' : shortcutModifier}
                   </button>
                   <span className="text-[color:var(--color-muted)]">+</span>
                   <button 
                     className={`px-3 py-1.5 rounded border ${recording === 'key' ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]'}`}
                     onClick={() => setRecording('key')}
                   >
                     {recording === 'key' ? '...' : shortcutKey}
                   </button>
                 </div>
                 <p className="text-xs text-[color:var(--color-muted)]">
                   Haz clic en el botón y presiona la nueva tecla. Esc para cancelar.
                 </p>
               </div>

               {/* Personalización de colores */}
               <div className="flex flex-col gap-2">
                 <span className="text-[color:var(--color-text)]">Personalización</span>
                 <div className="flex items-center gap-4">
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">Color primario</label>
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
                     <label className="text-xs text-[color:var(--color-muted)]">Color secundario</label>
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
                 </div>
               </div>
             </div>
          </>
        )}
      </div>
    </DetailsModal>
  )
}
