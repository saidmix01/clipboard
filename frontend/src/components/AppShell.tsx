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
    <div className="w-screen h-screen flex items-center justify-center bg-transparent">
      <div className="glass w-[420px] h-full flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
