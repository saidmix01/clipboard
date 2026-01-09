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
  const [colorBg, setColorBg] = useState('#f6f6f7')
  const [colorSurface, setColorSurface] = useState('#ffffff')
  const [colorText, setColorText] = useState('#1f2937')
  const [fontSize, setFontSize] = useState(14)

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

  const menuBtnClass = `flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors duration-200 hover:text-white`
  const getHoverStyle = (active: boolean = false) => ({
    backgroundColor: active ? 'var(--color-primary)' : undefined,
    color: active ? '#ffffff' : undefined,
    '--hover-bg': 'var(--color-primary)'
  } as React.CSSProperties)

  const MouseOver = (e: React.MouseEvent) => {
    e.currentTarget.style.backgroundColor = 'var(--color-primary)'
    e.currentTarget.style.color = '#ffffff'
  }
  const MouseOut = (e: React.MouseEvent) => {
    e.currentTarget.style.backgroundColor = 'transparent'
    e.currentTarget.style.color = 'var(--color-text)'
  }

  if (!open) return null

  return (
    <DetailsModal open={open} onClose={onClose}>
      <div className="p-1">
        {view === 'main' ? (
          <>
            <h3 className="m-0 text-[color:var(--color-text)]">Ajustes</h3>
            <div className="flex flex-col mt-2">
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={() => setView('general')}>
                <Cog6ToothIcon className="w-5 h-5" />
                <span>Configuración general</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onSyncNow}>
                <CloudArrowDownIcon className="w-5 h-5" />
                <span>Sincronizar ahora</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onChangeDevice}>
                <ComputerDesktopIcon className="w-5 h-5" />
                <span>Cambiar dispositivo</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onForceUpdate}>
                <ArrowPathIcon className="w-5 h-5" />
                <span>Buscar actualizaciones</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onToggleDark}>
                {darkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                <span>{darkMode ? 'Modo claro' : 'Modo oscuro'}</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onClearHistory}>
                <TrashIcon className="w-5 h-5" />
                <span>Borrar historial</span>
              </button>
              <button className={menuBtnClass} onMouseEnter={MouseOver} onMouseLeave={MouseOut} onClick={onOpenAbout}>
                <InformationCircleIcon className="w-5 h-5" />
                <span>Acerca de</span>
              </button>
            </div>
          </>
        ) : (
          <>
             <div className="flex items-center gap-2 mb-4">
               <button onClick={() => setView('main')} className="p-1 rounded-full hover:text-white" onMouseEnter={MouseOver} onMouseLeave={MouseOut}>
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
                     className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors`}
                     style={{ backgroundColor: startMinimized ? 'var(--color-primary)' : 'var(--color-muted)' }}
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
                   Haz clic en el botón y presiona la nueva tecla. Esc para cancelar.
                 </p>
               </div>

               {/* Personalización de colores */}
               <div className="flex flex-col gap-3">
                 <div className="flex items-center justify-between">
                   <span className="text-[color:var(--color-text)]">Personalización</span>
                   <button 
                     onClick={resetColors} 
                     className="px-2 py-1 text-xs rounded border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface)] transition-colors text-[color:var(--color-text)]"
                     title="Restaurar colores por defecto"
                   >
                     Resetear colores
                   </button>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                   <div className="flex flex-col gap-1">
                     <label className="text-xs text-[color:var(--color-muted)]">Primario</label>
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
                     <label className="text-xs text-[color:var(--color-muted)]">Secundario</label>
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
                     <label className="text-xs text-[color:var(--color-muted)]">Fondo (App)</label>
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
                     <label className="text-xs text-[color:var(--color-muted)]">Fondo (Base)</label>
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
                     <label className="text-xs text-[color:var(--color-muted)]">Texto</label>
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
                     <label className="text-xs text-[color:var(--color-muted)]">Tamaño fuente</label>
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
