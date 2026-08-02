import { useEffect } from 'react'

interface Props {
  darkMode: boolean
  children: React.ReactNode
}

export default function AppShell({ darkMode, children }: Props) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  return (
    <div className="w-screen h-screen flex flex-col bg-[color:var(--color-surface)] text-[color:var(--color-text)] overflow-hidden rounded-xl border border-[color:var(--color-border)] shadow-2xl transition-colors duration-200">
      {children}
    </div>
  )
}
