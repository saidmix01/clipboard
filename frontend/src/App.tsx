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

  return (
    <>
      <Toaster position='top-center' />

      <div
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
          className='card shadow rounded-4 border border-dark position-relative'
          style={{
            width: '400px',
            height: '500px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'white'
          }}
        >
          {/* Encabezado */}
          <div className='card-header d-flex justify-content-between align-items-center drag-region bg-white border-bottom'>
            <h5 className='mb-0'>📋 Copyfy++</h5>
            <button
              onClick={() => {
                ;(window as any).electronAPI?.clearHistory?.()
                toast.success('Historial eliminado')
              }}
              title='Borrar historial'
              className='btn btn-sm btn-outline-danger no-drag'
            >
              🗑️
            </button>
          </div>

          {/* Buscador */}
          <div className='p-3 border-bottom bg-white'>
            <input
              type='text'
              placeholder='Buscar en el historial...'
              value={search}
              onChange={e => setSearch(e.target.value)}
              className='form-control form-control-sm'
            />
          </div>

          {/* Lista del historial */}
          <div className='flex-grow-1 overflow-auto p-3 bg-white'>
            {filteredHistory.length === 0 ? (
              <p className='text-muted text-center small mb-0'>
                Sin coincidencias
              </p>
            ) : (
              filteredHistory.map((item, idx) => {
                if (typeof item === 'string' && item.startsWith('data:image')) {
                  // Imagen
                  return (
                    <div
                      key={idx}
                      className='mb-2 p-2 border rounded cursor-pointer bg-light'
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
                  // Código
                  return (
                    <div
                      key={idx}
                      className='mb-2 p-2 border rounded bg-light cursor-pointer'
                      onClick={() => {
                        ;(window as any).electronAPI?.copyText(item)
                        toast.success('Código copiado al portapapeles')
                        setTimeout(() => {
                          ;(window as any).electronAPI?.hideWindow?.()
                        }, 500)
                      }}
                    >
                      <CodeBlock code={item} />
                    </div>
                  )
                } else {
                  // Texto con botón flotante visible al hover
                  return (
                    <div
                      key={idx}
                      className='position-relative mb-2'
                      style={{
                        paddingRight: '36px'
                      }}
                      onMouseEnter={() =>
                        document
                          .getElementById(`translate-btn-${idx}`)
                          ?.classList.remove('d-none')
                      }
                      onMouseLeave={() =>
                        document
                          .getElementById(`translate-btn-${idx}`)
                          ?.classList.add('d-none')
                      }
                    >
                      {/* Botón flotante */}
                      <button
                        id={`translate-btn-${idx}`}
                        className='btn btn-sm btn-outline-secondary no-drag position-absolute d-none'
                        style={{
                          top: '50%',
                          right: '4px',
                          transform: 'translateY(-50%)',
                          padding: '2px 4px',
                          background: 'white',
                          borderRadius: '8px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                          zIndex: 10
                        }}
                        title='Traducir al inglés'
                        onClick={async e => {
                          e.stopPropagation()
                          const translated = await (
                            window as any
                          ).electronAPI.translateToEnglish(item)
                          if (translated && typeof translated === 'string') {
                            ;(window as any).electronAPI.copyText(translated)
                            toast.success('Texto traducido y copiado')
                            setTimeout(() => {
                              ;(window as any).electronAPI?.hideWindow?.()
                            }, 500)
                          } else {
                            toast.error('Error al traducir')
                          }
                        }}
                      >
                        <img
                          src='https://flagcdn.com/w40/gb.png'
                          alt='Traducir al inglés'
                          style={{ width: '18px', height: '13px' }}
                        />
                      </button>

                      <div
                        className='list-group-item list-group-item-action rounded cursor-pointer border no-drag'
                        style={{
                          fontSize: '0.875rem',
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word'
                        }}
                        onClick={() => {
                          ;(window as any).electronAPI?.copyText(item)
                          toast.success('Copiado al portapapeles')
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
