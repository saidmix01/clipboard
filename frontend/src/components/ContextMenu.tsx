import React, { useEffect, useRef } from 'react'

type Props = {
  x: number
  y: number
  onDelete: () => void
  onClose: () => void
}

export default function ContextMenu({ x, y, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Adjust position to not go off-screen (basic check)
  const style: React.CSSProperties = {
    top: y,
    left: x,
    position: 'fixed',
    zIndex: 9999,
  }

  return (
    <div
      ref={ref}
      className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] shadow-xl rounded-lg py-1 min-w-[150px] flex flex-col"
      style={style}
    >
      <button
        onClick={() => {
          onDelete()
          onClose()
        }}
        className="text-left px-4 py-2 text-sm text-red-500 hover:bg-[color:var(--color-bg)] transition-colors w-full flex items-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
        Eliminar
      </button>
    </div>
  )
}
