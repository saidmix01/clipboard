import { useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { motion } from 'framer-motion'
import { FaStar } from 'react-icons/fa'

function isCodeSnippet (text: string): boolean {
  const trimmed = text.trim()

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      return true
    }
  } catch (_) {}

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
  const [search, setSearch] = useState<string>('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Ref para el contenedor scrollable y para cada item
  const containerScrollRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const highlightMatch = (
    text: string,
    query: string
  ): ReactNode[] | string => {
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

  const [filter, setFilter] = useState<'all' | 'text' | 'image' | 'favorite'>(
    'all'
  )

  const filteredHistory = [...history]
    .filter(item => {
      const isImage = item.value.startsWith('data:image')
      const isFavorite = item.favorite

      if (filter === 'all' && isFavorite) return false
      if (filter === 'text' && isImage) return false
      if (filter === 'image' && !isImage) return false
      if (filter === 'favorite' && !isFavorite) return false

      return item.value.toLowerCase().includes(search.toLowerCase())
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite))
    .slice(0, 50)

  useEffect(() => {
    if ((window as any).electronAPI?.onClipboardUpdate) {
      ;(window as any).electronAPI.onClipboardUpdate((data: HistoryItem[]) => {
        setHistory(data)
      })
    }
  }, [])

  useEffect(() => {
    const escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ;(window as any).electronAPI?.hideWindow?.()
      }
    }
    window.addEventListener('keydown', escListener)
    return () => window.removeEventListener('keydown', escListener)
  }, [])

  useEffect(() => {
    function handleClickOutside (event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        ;(window as any).electronAPI?.hideWindow?.()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('darkMode')
    return stored === 'true'
  })

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString())
  }, [darkMode])

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode)
  }, [darkMode])

  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    if ((window as any).electronAPI?.getAppVersion) {
      ;(window as any).electronAPI.getAppVersion().then(setAppVersion)
    }
  }, [])

  const [selectedIndex, setSelectedIndex] = useState<number>(-1)

  // Scroll automático cuando cambia selectedIndex
  useEffect(() => {
    const itemEl = itemRefs.current[selectedIndex]
    if (itemEl && itemEl.scrollIntoView) {
      itemEl.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      })
    }
  }, [selectedIndex, filteredHistory])

  useEffect(() => {
    const keyListener = (e: KeyboardEvent) => {
      if (filteredHistory.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredHistory.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev =>
          prev <= 0 ? filteredHistory.length - 1 : prev - 1
        )
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < filteredHistory.length) {
          const item = filteredHistory[selectedIndex]
          if (item.value.startsWith('data:image')) {
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
        }
      }
    }

    window.addEventListener('keydown', keyListener)
    return () => window.removeEventListener('keydown', keyListener)
  }, [filteredHistory, selectedIndex])

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <Toaster position='top-center' />

        <div
          ref={containerRef}
          className='d-flex justify-content-center'
          style={{
            background: 'transparent',
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
              height: '100%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Header */}
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

            {/* Search input */}
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

            {/* Filters */}
            <div
              className={`p-3 border-bottom card-glass`}
              style={{
                display: 'flex',
                justifyContent: 'space-between'
              }}
            >
              <button
                className={`btn btn-sm ${
                  filter === 'all' ? 'btn-secondary' : 'btn-outline-secondary'
                }`}
                onClick={() => setFilter('all')}
              >
                Todo
              </button>
              <button
                className={`btn btn-sm ${
                  filter === 'text' ? 'btn-secondary' : 'btn-outline-secondary'
                }`}
                onClick={() => setFilter('text')}
              >
                🔤 Texto
              </button>
              <button
                className={`btn btn-sm ${
                  filter === 'image' ? 'btn-secondary' : 'btn-outline-secondary'
                }`}
                onClick={() => setFilter('image')}
              >
                🖼️ Imagen
              </button>
              <button
                className={`btn btn-sm ${
                  filter === 'favorite'
                    ? 'btn-secondary'
                    : 'btn-outline-secondary'
                }`}
                onClick={() => setFilter('favorite')}
              >
                ⭐ Favoritos
              </button>
            </div>

            {/* Scroll container */}
            <div
              ref={containerScrollRef}
              className={`flex-grow-1 overflow-auto ${
                darkMode ? 'text-white' : 'text-dark'
              }`}
              style={{
                scrollbarColor: darkMode ? '#666 #222' : undefined,
                scrollbarWidth: 'thin',
                padding: '10px'
              }}
            >
              {filteredHistory.length === 0 ? (
                <p
                  className={`text-muted text-center small mb-0 no-match ${
                    darkMode ? 'dark-mode' : ''
                  }`}
                >
                  Sin coincidencias
                </p>
              ) : (
                filteredHistory.map((item, idx) => {
                  const isSelected = idx === selectedIndex
                  return (
                    <div
                      key={idx}
                      ref={el => {
                        itemRefs.current[idx] = el
                      }}
                    >
                      <ExpandableCard
                        content={item.value}
                        darkMode={darkMode}
                        search={search}
                        onCopy={() => {
                          if (item.value.startsWith('data:image')) {
                            ;(window as any).electronAPI?.copyImage?.(
                              item.value
                            )
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
                          const realIndex = history.findIndex(
                            h => h.value === item.value
                          )
                          if (realIndex !== -1) {
                            newHistory[realIndex].favorite =
                              !newHistory[realIndex].favorite
                            setHistory(newHistory)
                            ;(window as any).electronAPI?.toggleFavorite?.(
                              item.value
                            )
                          }
                        }}
                        selected={isSelected}
                        highlightMatch={highlightMatch}
                      />
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer version */}
            <div
              className='text-end px-2 pb-1'
              style={{
                fontSize: '0.7rem',
                color: darkMode ? '#ccc' : '#666',
                marginTop: '2px'
              }}
            >
              <span title='Versión de la app'>v{appVersion}</span>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

type ExpandableCardProps = {
  content: string
  darkMode: boolean
  search: string
  onCopy: () => void
  onToggleFavorite: () => void
  item: HistoryItem
  selected: boolean
  highlightMatch: (text: string, query: string) => React.ReactNode[] | string
}

function ExpandableCard ({
  content,
  darkMode,
  search,
  onCopy,
  onToggleFavorite,
  item,
  selected,
  highlightMatch
}: ExpandableCardProps) {
  const [expanded, setExpanded] = useState(false)

  const isImage = content.startsWith('data:image')
  const isCode = isCodeSnippet(content)

  const wrapperStyle: React.CSSProperties = {
    maxHeight: expanded ? 'none' : '150px',
    overflow: 'hidden',
    position: 'relative',
    outline: selected
      ? darkMode
        ? '2px solid orange'
        : '2px solid #007bff'
      : undefined
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
        darkMode ? 'text-white border-dark' : 'bg-light'
      }`}
      onClick={onCopy}
      style={{
        cursor: 'pointer',
        backgroundColor: darkMode ? '#3e3e3d' : '#dcdcdc',
        ...wrapperStyle
      }}
      tabIndex={0}
    >
      <div>
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
        title='Marcar como favorito'
        className='btn btn-sm'
        style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          zIndex: 10,
          backgroundColor: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: '1.3rem',
          cursor: 'pointer',
          color: item.favorite ? 'gold' : 'gray'
        }}
      >
        <FaStar />
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

function CodeBlock ({ code }: { code: string }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (ref.current) {
      hljs.highlightElement(ref.current)
    }
  }, [code])

  return (
    <pre className='code-block'>
      <code ref={ref} className='language-javascript'>
        {code}
      </code>
    </pre>
  )
}

export default App
