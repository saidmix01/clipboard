import { useEffect, useState, useRef } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css' // Puedes cambiar el estilo si luego quieres otro

function isCodeSnippet (text: string): boolean {
  return (
    text.includes(';') ||
    text.includes('{') ||
    text.includes('=>') ||
    text.includes('function') ||
    text.includes('const ') ||
    text.includes('let ') ||
    text.includes('class ') ||
    text.includes('import ') ||
    text.split('\n').length > 2
  )
}

function App () {
  const [history, setHistory] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text

    const regex = new RegExp(`(${query})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, idx) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={idx} className='bg-yellow-200 font-semibold rounded'>
          {part}
        </mark>
      ) : (
        <span key={idx}>{part}</span>
      )
    )
  }

  //Filtro
  const filteredHistory = history
    .filter(item => item.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 50) // ✅ solo 50 ítems visibles

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

  //dark mode
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('darkMode')
    return stored === 'true' // si existe y es "true", activa el modo oscuro
  })

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString())
  }, [darkMode])

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode)
  }, [darkMode])

  return (
    <>
      <Toaster position='top-center' />

      <div
        className='d-flex justify-content-center'
        style={{
          background: darkMode ? '#121212' : 'transparent',
          width: '100vw',
          height: '100vh',
          margin: 0,
          padding: 0,
          overflow: 'hidden',
          alignItems: 'center',
          display: 'flex'
        }}
      >
        <div
          className={`card shadow rounded-1 position-relative ${
            darkMode
              ? 'bg-dark text-white border-secondary'
              : 'bg-white border-dark'
          }`}
          style={{
            width: '400px',
            height: '500px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Encabezado */}
          <div
            className={`card-header d-flex align-items-center justify-content-between ${
              darkMode ? 'bg-dark border-secondary' : 'bg-white border-bottom'
            } p-2`}
          >
            <div
              style={
                {
                  WebkitAppRegion: 'drag',
                  userSelect: 'none',
                  flexGrow: 1
                } as any
              }
            >
              <h5 className='mb-0'>📋 Copyfy++</h5>
            </div>

            <div
              className='d-flex gap-2'
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <button
                onClick={() => setDarkMode(prev => !prev)}
                title='Modo oscuro'
                className='btn btn-sm btn-outline-primary'
              >
                {darkMode ? '🌞' : '🌙'}
              </button>

              <button
                onClick={() => {
                  ;(window as any).electronAPI?.clearHistory?.()
                  toast.success('Historial eliminado')
                }}
                title='Borrar historial'
                className='btn btn-sm btn-outline-danger'
              >
                🗑️
              </button>

              <button
                onClick={() => (window as any).electronAPI?.hideWindow?.()}
                title='Ocultar ventana'
                className='btn btn-sm btn-outline-secondary'
              >
                ❌
              </button>
            </div>
          </div>

          {/* Buscador */}
          <div
            className={`p-3 border-bottom ${
              darkMode ? 'bg-dark border-secondary' : 'bg-white'
            }`}
          >
            <input
              type='text'
              placeholder='Buscar en el historial...'
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`form-control form-control-sm ${
                darkMode ? 'bg-dark text-white border-secondary' : ''
              }`}
            />
          </div>

          {/* Lista del historial */}
          <div
            className={`flex-grow-1 overflow-auto p-3 ${
              darkMode ? 'bg-dark text-white' : 'bg-white'
            }`}
            style={{
              scrollbarColor: darkMode ? '#666 #222' : undefined,
              scrollbarWidth: 'thin'
            }}
          >
            {filteredHistory.length === 0 ? (
              <p className='text-muted text-center small mb-0'>
                Sin coincidencias
              </p>
            ) : (
              filteredHistory.map((item, idx) => {
                if (typeof item === 'string' && item.startsWith('data:image')) {
                  return (
                    <div
                      key={idx}
                      className={`mb-2 p-2 border rounded cursor-pointer ${
                        darkMode
                          ? 'bg-secondary text-white border-light'
                          : 'bg-light'
                      }`}
                      onClick={() => {
                        ;(window as any).electronAPI?.copyImage?.(item)
                        toast.success('Imagen copiada al portapapeles')
                        setTimeout(() => {
                          ;(window as any).electronAPI?.hideWindow?.()
                        }, 500)
                      }}
                    >
                      <img
                        src={item}
                        alt='imagen'
                        style={{ maxWidth: '100%' }}
                      />
                    </div>
                  )
                } else if (typeof item === 'string' && isCodeSnippet(item)) {
                  return (
                    <div
                      key={idx}
                      className={`mb-2 p-2 border rounded cursor-pointer ${
                        darkMode
                          ? 'bg-secondary text-white border-light'
                          : 'bg-light'
                      }`}
                      onClick={() => {
                        ;(window as any).electronAPI?.copyText(item)
                        setTimeout(() => {
                          ;(window as any).electronAPI?.pasteText()
                        }, 100)
                        toast.success('Pegado automáticamente')
                        setTimeout(() => {
                          ;(window as any).electronAPI?.hideWindow?.()
                        }, 500)
                      }}
                    >
                      <CodeBlock code={item} />
                    </div>
                  )
                } else {
                  return (
                    <div key={idx} className='mb-2'>
                      <div
                        className={`list-group-item list-group-item-action rounded cursor-pointer border no-drag ${
                          darkMode ? 'bg-dark text-white border-secondary' : ''
                        }`}
                        style={{
                          fontSize: '0.875rem',
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word'
                        }}
                        onClick={() => {
                          ;(window as any).electronAPI?.copyText(item)
                          setTimeout(() => {
                            ;(window as any).electronAPI?.pasteText()
                          }, 100)
                          toast.success('Pegado automáticamente')
                          setTimeout(() => {
                            ;(window as any).electronAPI?.hideWindow?.()
                          }, 500)
                        }}
                      >
                        {highlightMatch(
                          item.length > 120 ? item.slice(0, 120) + '…' : item,
                          search
                        )}
                      </div>
                    </div>
                  )
                }
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function CodeBlock ({ code }: { code: string }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (ref.current) {
      hljs.highlightElement(ref.current)
    }
  }, [code])

  return (
    <pre className='bg-light p-2 rounded' style={{ fontSize: '0.8rem' }}>
      <code ref={ref} className='language-javascript'>
        {code}
      </code>
    </pre>
  )
}

export default App
