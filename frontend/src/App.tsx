import { useEffect, useState } from 'react'

function App () {
  const [history, setHistory] = useState<string[]>([])

  // Escuchar actualizaciones del portapapeles
  useEffect(() => {
    if ((window as any).electronAPI?.onClipboardUpdate) {
      ;(window as any).electronAPI.onClipboardUpdate((data: string[]) => {
        setHistory(data)
      })
    }
  }, [])

  // Cerrar con Escape
  useEffect(() => {
    const escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.close()
      }
    }
    window.addEventListener('keydown', escListener)
    return () => window.removeEventListener('keydown', escListener)
  }, [])

  return (
    <div className='h-screen w-screen bg-gray-50 p-4 overflow-hidden'>
      <div className='h-full w-full flex flex-col rounded-lg shadow-xl bg-white border border-gray-200 overflow-hidden'>
        <div className='px-4 py-2 border-b'>
          <div className='px-4 py-2 border-b cursor-move select-none drag-region'>
            <h1 className='text-base font-medium text-gray-700'>
              📋 Historial
            </h1>
          </div>
        </div>

        <div className='flex-1 overflow-y-auto p-3 space-y-2'>
          {history.length === 0 && (
            <p className='text-center text-gray-400 mt-8'>
              Aún no has copiado texto.
            </p>
          )}

          {history.map((item, idx) => (
            <div
              key={idx}
              className='bg-gray-100 hover:bg-gray-200 transition-colors border border-gray-300 p-2 rounded-md shadow-sm text-sm text-gray-800 cursor-pointer'
            >
              {item.length > 120 ? item.slice(0, 120) + '…' : item}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
