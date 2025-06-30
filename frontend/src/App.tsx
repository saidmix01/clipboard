import { useEffect, useState, useRef } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css' // Puedes cambiar el estilo si luego quieres otro

function isCodeSnippet (text: string): boolean {
  const trimmed = text.trim()

  // Detectar JSON válido
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      return true
    }
  } catch (_) {}

  // Detectar estructuras de código comunes
  const hasCodeIndicators = [
    ';',
    '{',
    '}',
    '=>',
    'function',
    'const ',
    'let ',
    'class ',
    'import ',
    'export ',
    'return ',
    '//',
    '/*',
    '*/'
  ].some(keyword => text.includes(keyword))

  const lines = text.split('\n')

  // Al menos 3 líneas y algún símbolo sospechoso
  const looksMultilineCode =
    lines.length > 2 && lines.some(line => /[{;}=]/.test(line.trim()))

  return hasCodeIndicators || looksMultilineCode
}

type HistoryItem = {
  value: string
  favorite: boolean
}

function App () {
  const [history, setHistory] = useState<HistoryItem[]>([])
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
  const filteredHistory = [...history]
    .filter(
      item =>
        typeof item.value === 'string' &&
        item.value.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => Number(b.favorite) - Number(a.favorite)) // ⭐ favoritos primero
    .slice(0, 50)

  // Escuchar actualizaciones del portapapeles
  useEffect(() => {
    if ((window as any).electronAPI?.onClipboardUpdate) {
      ;(window as any).electronAPI.onClipboardUpdate((data: any[]) => {
        setHistory(data) // ✅ ya viene bien formado desde Electron
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

  function ExpandableCard ({
    content,
    darkMode,
    search,
    onCopy,
    onToggleFavorite,
    item
  }: {
    content: string
    darkMode: boolean
    search: string
    onCopy: () => void
    onToggleFavorite: () => void
    item: {
      value: string
      favorite: boolean
    }
  }) {
    const [expanded, setExpanded] = useState(false)

    const isImage = content.startsWith('data:image')
    const isCode = isCodeSnippet(content)

    const wrapperStyle: React.CSSProperties = {
      maxHeight: expanded ? 'none' : '150px',
      overflow: 'hidden',
      position: 'relative'
    }

    const buttonStyle: React.CSSProperties = {
      position: 'absolute',
      bottom: 0,
      left: 0,
      width: '100%',
      textAlign: 'center',
      background: darkMode ? '#333' : '#fff',
      color: darkMode ? '#ccc' : '#000',
      fontSize: '0.75rem',
      cursor: 'pointer'
    }

    return (
      <div
        className={`mb-2 p-2 border rounded position-relative ${
          darkMode ? 'bg-secondary text-white border-light' : 'bg-light'
        }`}
        onClick={onCopy}
        style={{
          cursor: 'pointer'
        }}
      >
        <div style={wrapperStyle}>
          {isImage ? (
            <img src={content} alt='imagen' style={{ maxWidth: '100%' }} />
          ) : isCode ? (
            <CodeBlock code={content} />
          ) : (
            <div
              className={`${darkMode ? 'text-white' : 'text-dark'} small`}
              style={{
                overflowWrap: 'break-word',
                wordBreak: 'break-word'
              }}
            >
              {highlightMatch(content, search)}
            </div>
          )}
        </div>

        <button
          onClick={e => {
            e.stopPropagation()
            onToggleFavorite()
          }}
          className={`btn btn-sm ${
            item.favorite ? 'btn-warning' : 'btn-outline-warning'
          }`}
          title='Marcar como favorito'
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            zIndex: 10
          }}
        >
          ⭐
        </button>

        {content.length > 300 && (
          <div
            style={buttonStyle}
            onClick={e => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? '▲ Ver menos' : '▼ Ver más'}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <Toaster position='top-center' />

      <div
        className='d-flex justify-content-center'
        style={{
          background: darkMode ? '#161616' : 'transparent',
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
          className={`card shadow rounded-1 position-relative card-glass ${
            darkMode ? 'text-white border-secondary' : 'text-dark border-dark'
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
            className={`card-header d-flex align-items-center justify-content-between card-glass p-2 ${
              darkMode ? 'border-secondary' : 'border-bottom'
            }`}
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
                onClick={() => {
                  toast('Buscando actualizaciones...')
                  ;(window as any).electronAPI?.forceUpdate?.()
                }}
                title='Buscar actualizaciones'
                className='btn btn-sm btn-outline-success'
              >
                🔄
              </button>
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
          <div className={`p-3 border-bottom card-glass`}>
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
              darkMode ? 'text-white' : 'text-dark'
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
                return (
                  <ExpandableCard
                    key={idx}
                    content={item.value}
                    darkMode={darkMode}
                    search={search}
                    onCopy={() => {
                      if (
                        typeof item.value === 'string' &&
                        item.value.startsWith('data:image')
                      ) {
                        ;(window as any).electronAPI?.copyImage?.(item.value)
                        setTimeout(() => {
                          ;(window as any).electronAPI.pasteImage()
                        }, 300)
                        toast.success('Imagen copiada al portapapeles')
                      } else {
                        ;(window as any).electronAPI?.copyText(item.value)
                        setTimeout(() => {
                          ;(window as any).electronAPI?.pasteText()
                        }, 100)
                        toast.success('Pegado automáticamente')
                      }
                      setTimeout(() => {
                        ;(window as any).electronAPI?.hideWindow?.()
                      }, 500)
                    }}
                    item={item}
                    onToggleFavorite={() => {
                      const newHistory = [...history]
                      newHistory[idx].favorite = !newHistory[idx].favorite
                      setHistory(newHistory)

                      // Si deseas persistir, también llama a:
                      ;(window as any).electronAPI?.toggleFavorite?.(item.value)
                    }}
                  />
                )
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
