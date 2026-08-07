import { useEffect, useState, type ReactNode } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'

type Props = {
  children: ReactNode
  title: string
  onClose?: () => void
}

export default function WindowShell({ children, title, onClose }: Props) {
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    // Sync dark mode with main app setting
    async function loadTheme() {
        const stored = await (window as any).electronAPI?.getConfig?.('darkMode')
        if (stored === 'true') setDarkMode(true)
    }
    loadTheme()
  }, [])

  // Listen for theme changes from main process
  useEffect(() => {
    const off = (window as any).electronAPI?.onThemeChanged?.((isDark: boolean) => {
      setDarkMode(isDark)
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const handleClose = () => {
      if (onClose) onClose()
      else (window as any).electronAPI?.closeWindow?.()
  }

  return (
    <div className="flex flex-col h-screen w-full bg-transparent overflow-hidden p-2">
       {/* Card container matching AppShell style */}
       <div className="flex-1 flex flex-col bg-[color:var(--color-bg)] rounded-[var(--radius-modal)] border border-[color:var(--color-border)] shadow-2xl overflow-hidden relative">
           
           {/* Title Bar */}
           <div className="h-10 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)] flex items-center justify-between px-4 drag_region shrink-0">
               <div className="font-semibold text-sm text-[color:var(--color-text)] flex items-center gap-2">
                   {/* Icon based on title maybe? */}
                   {title}
               </div>
               <div className="flex items-center gap-2 no_drag">
                   <button 
                     onClick={handleClose}
                     className="p-1 rounded-full hover:bg-red-500 hover:text-white text-[color:var(--color-muted)] transition-colors"
                   >
                       <XMarkIcon className="w-4 h-4" />
                   </button>
               </div>
           </div>

           {/* Content */}
           <div className="flex-1 overflow-hidden relative">
               {children}
           </div>
       </div>
    </div>
  )
}
