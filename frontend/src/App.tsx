import { useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { motion } from 'framer-motion'
import { FaStar, FaSignInAlt, FaSignOutAlt, FaUserPlus, FaUserCircle, FaCog } from 'react-icons/fa'
import LoginModal from './Login'
import UserModal from './UserModal'
import { API_BASE } from './config'

function isCodeSnippet (text: string): boolean {
  const trimmed = text.trim()

  if (trimmed.startsWith('data:image')) return false

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      return true
    }
  } catch (_) {}

  const hasCodeIndicators = [
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
    lines.length > 2 && lines.some(line => /[{};=]/.test(line.trim()))

  return hasCodeIndicators || looksMultilineCode
}

type HistoryItem = {
  id?: string
  value: string
  favorite: boolean
}

function App () {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [search, setSearch] = useState<string>('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<boolean>(false)

  const logout = () => {
    setToken(null)
    localStorage.removeItem('x-token')
    localStorage.removeItem('session')
    ;(window as any).electronAPI?.setAuthToken?.('')
    toast.success('Sesión cerrada')
  }

  async function refreshAuthToken () {
    try {
      const raw = localStorage.getItem('session')
      if (!raw) return
      const sess = JSON.parse(raw)
      const rt = sess?.refreshToken
      if (!rt) return
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt })
      })
      const data = await res.json()
      const payload = (data && typeof data === 'object' ? (data.data ?? data) : {}) as any
      const success = (data && typeof data === 'object' ? data.success : undefined)
      const newToken = payload?.token
      const newRefresh = payload?.refreshToken
      if ((success ?? res.ok) && newToken) {
        handleLoginSuccess(newToken)
        const newSession = { ...sess, token: newToken, refreshToken: newRefresh || rt }
        localStorage.setItem('session', JSON.stringify(newSession))
      }
    } catch {}
  }

  const handleLoginSuccess = (newToken: string) => {
    setToken(newToken)
    localStorage.setItem('x-token', newToken)

    if ((window as any).electronAPI?.setAuthToken) {
      ;(window as any).electronAPI?.setAuthToken(newToken)
    }

    try {
      setTimeout(() => {
        ;(window as any).electronAPI?.registerDevice?.('')
      }, 200)
    } catch {}
  }

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

  let filteredHistory = [...history]
    .filter(item => {
      const isImage = item.value.startsWith('data:image')
      const isFavorite = item.favorite

      if (filter === 'text' && isImage) return false
      if (filter === 'image' && !isImage) return false
      if (filter === 'favorite' && !isFavorite) return false

      return item.value.toLowerCase().includes(search.toLowerCase())
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite))

  if (!search.trim()) {
    filteredHistory = filteredHistory.slice(0, 50)
  }

  useEffect(() => {
    const token = localStorage.getItem('x-token')
    if (token) {
      handleLoginSuccess(token)
      ;(window as any).electronAPI?.setAuthToken(token)
    } else {
      const raw = localStorage.getItem('session')
      if (raw) {
        try {
          const sess = JSON.parse(raw)
          if (sess?.token) handleLoginSuccess(sess.token)
          if (sess?.refreshToken) refreshAuthToken()
        } catch {}
      }
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      refreshAuthToken()
    }, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const fetchMe = async () => {
      try {
        setAvatarError(false)
        if (!token) { setUserAvatar(null); return }
        const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        const payload: any = (data && typeof data === 'object' ? (data.data ?? data) : {})
        const u = payload?.user
        const src: string | undefined = u?.avatarUrl
        const resolve = (s?: string | null): string | null => {
          if (!s) return null
          let v = String(s).replace(/\\/g, '/')
          if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v
          if (v.startsWith('/')) return `${API_BASE}${v}`
          if (v.startsWith('uploads/')) return `${API_BASE}/${v}`
          if (v.includes('/uploads/')) return `${API_BASE}${v.substring(v.indexOf('/uploads/'))}`
          return `${API_BASE}/uploads/${v}`
        }
        setUserAvatar(resolve(src))
      } catch {
        setUserAvatar(null)
      }
    }
    fetchMe()
  }, [token])

  useEffect(() => {
    if (!showUserModal && token) {
      (async () => {
        try {
          setAvatarError(false)
          const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
          const data = await res.json()
          const payload: any = (data && typeof data === 'object' ? (data.data ?? data) : {})
          const u = payload?.user
          const src: string | undefined = u?.avatarUrl
          const resolve = (s?: string | null): string | null => {
            if (!s) return null
            let v = String(s).replace(/\\/g, '/')
            if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v
            if (v.startsWith('/')) return `${API_BASE}${v}`
            if (v.startsWith('uploads/')) return `${API_BASE}/${v}`
            if (v.includes('/uploads/')) return `${API_BASE}${v.substring(v.indexOf('/uploads/'))}`
            return `${API_BASE}/uploads/${v}`
          }
          setUserAvatar(resolve(src))
        } catch {}
      })()
    }
  }, [showUserModal, token])

  useEffect(() => {
    if ((window as any).electronAPI?.onClipboardUpdate) {
      ;(window as any).electronAPI.onClipboardUpdate((data: HistoryItem[]) => {
        setHistory(data)
      })
    }
  }, [])

  useEffect(() => {
    if ((window as any).electronAPI?.getClipboardHistory) {
      ;(window as any).electronAPI.getClipboardHistory().then((data: HistoryItem[]) => {
        if (Array.isArray(data)) setHistory(data)
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
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)

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
              style={{ position: 'relative', zIndex: 2000 }}
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
                <>
                  <button
                    className={`btn btn-sm ${token ? 'btn-outline-warning' : 'btn-outline-primary'}`}
                    onClick={() => (token ? logout() : setShowLogin(true))}
                    title={token ? 'Cerrar sesión' : 'Iniciar sesión'}
                  >
                    {token ? <FaSignOutAlt size={20} /> : <FaSignInAlt size={20} />}
                  </button>
                  {!token && (
                    <button
                      className='btn btn-sm btn-outline-success'
                      onClick={() => setShowRegister(true)}
                      title='Registrarse'
                    >
                      <FaUserPlus size={20} />
                    </button>
                  )}
                  {token && (
                    <button
                      className='btn btn-sm btn-outline-info'
                      onClick={() => setShowUserModal(true)}
                      title='Datos del usuario'
                    >
                      {userAvatar && !avatarError ? (
                        <img src={userAvatar} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} onError={() => setAvatarError(true)} />
                      ) : (
                        <FaUserCircle size={22} />
                      )}
                    </button>
                  )}
                </>
                <div className='position-relative' style={{ WebkitAppRegion: 'no-drag' } as any}>
                  <button
                    onClick={() => setSettingsOpen(prev => !prev)}
                    title='Configuración'
                    className='btn btn-sm btn-outline-secondary'
                  >
                    <FaCog size={22} />
                  </button>
                  {settingsOpen && (
                    <div
                      className='shadow rounded border'
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 'calc(100% + 4px)',
                        zIndex: 1000,
                        background: darkMode ? '#333' : '#fff'
                      }}
                    >
                      <div className='d-flex flex-column p-2 gap-2' style={{ minWidth: '200px' }}>
                        <button
                          onClick={() => {
                            setSettingsOpen(false)
                            toast('Buscando actualizaciones...')
                            ;(window as any).electronAPI?.forceUpdate?.()
                          }}
                          className='btn btn-sm btn-outline-success text-start'
                          title='Buscar actualizaciones'
                        >
                          🔄 Buscar actualizaciones
                        </button>
                        <button
                          onClick={() => {
                            setSettingsOpen(false)
                            setDarkMode(prev => !prev)
                          }}
                          className='btn btn-sm btn-outline-primary text-start'
                          title='Modo oscuro'
                        >
                          {darkMode ? '🌞' : '🌙'} Modo oscuro
                        </button>
                        <button
                          onClick={() => {
                            setSettingsOpen(false)
                            ;(window as any).electronAPI?.clearHistory?.()
                            toast.success('Historial eliminado')
                          }}
                          className='btn btn-sm btn-outline-danger text-start'
                          title='Borrar historial'
                        >
                          🗑️ Borrar historial
                        </button>
                      </div>
                    </div>
                  )}
                </div>

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

            <LoginModal
              isOpen={showLogin}
              onClose={() => setShowLogin(false)}
              onLoginSuccess={handleLoginSuccess}
              isDarkMode={darkMode}
              mode='login'
              onGlobalLoading={setGlobalLoading}
            />
            <LoginModal
              isOpen={showRegister}
              onClose={() => setShowRegister(false)}
              onLoginSuccess={handleLoginSuccess}
              isDarkMode={darkMode}
              mode='register'
              onGlobalLoading={setGlobalLoading}
            />
            <UserModal
              isOpen={showUserModal}
              onClose={() => setShowUserModal(false)}
              isDarkMode={darkMode}
            />

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
                              item
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
            {globalLoading && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 20000
                }}
              >
                <div
                  className='rounded shadow'
                  style={{
                    padding: 16,
                    background: darkMode ? '#222' : '#fff',
                    color: darkMode ? '#eee' : '#000'
                  }}
                >
                  Procesando...
                </div>
              </div>
            )}
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
          <img
            src={content}
            alt='imagen'
            style={{ maxWidth: '100%' }}
          />
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
        <FaStar size={24} />
      </button>

      

      {content.length > 300 && (
        <div
          style={buttonStyle}
          onClick={e => {
            e.stopPropagation()
            if (isImage) {
              ;(window as any).electronAPI?.openImageViewer?.(content)
              return
            }
            if (isCode) {
              ;(window as any).electronAPI?.openCodeEditor?.(content)
              return
            }
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
