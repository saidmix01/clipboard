import { useEffect } from 'react'

type Props = {
  darkMode: boolean
  children: React.ReactNode
}

export default function AppShell({ darkMode, children }: Props) {
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  return (
    <div className="w-screen h-screen flex flex-col relative bg-transparent overflow-hidden">
      {/* Dark blur overlay to reduce background dominance */}
      <div className="absolute inset-0 bg-black/10 dark:bg-[#0a0a0a]/80 backdrop-blur-sm z-0 pointer-events-none transition-colors duration-300" />
      
      {/* Main Container */}
      <div className="glass relative z-10 w-full h-full flex flex-col overflow-hidden shadow-2xl border border-[color:var(--color-border)] rounded-none sm:rounded-[var(--radius-modal)]">
        {children}
      </div>
    </div>
  )
}
