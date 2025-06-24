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
        ;(window as any).electronAPI?.hideWindow?.() // ✅ llama a backend para ocultar
      }
    }
    window.addEventListener('keydown', escListener)
    return () => window.removeEventListener('keydown', escListener)
  }, [])

  const testClick = () => {
    console.log('¡Clic en botón de prueba!')
  }

  return (
    <div className='h-screen w-screen bg-gray-50 p-4 overflow-hidden'>
      <div className='h-full w-full flex flex-col rounded-lg shadow-xl bg-white border border-gray-200 overflow-hidden'>
        <div className='px-4 py-2 border-b'>
          <div className='px-4 py-2 border-b cursor-move select-none drag-region'>
            <h5 className='text-base font-medium text-gray-700'>
              📋 Historial
            </h5>
          </div>
        </div>
        <button
          onClick={testClick}
          className='bg-blue-500 text-white px-4 py-1 rounded mb-4'
        >
          Probar clic
        </button>
        <div className='flex-1 overflow-y-auto p-3 space-y-2'>
          {history.map((item, idx) => (
            <div
              key={idx}
              className='bg-gray-100 hover:bg-gray-200 transition-colors border border-gray-300 p-2 rounded-md shadow-sm text-sm text-gray-800 cursor-pointer'
              onClick={() => {
                console.log('Click en:', item)
                ;(window as any).electronAPI?.copyText(item)
              }}
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
