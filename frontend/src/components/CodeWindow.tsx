import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { notifySuccess } from '../utils/notify'
import WindowShell from './WindowShell'

export default function CodeWindow() {
  const [content, setContent] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [theme, setTheme] = useState<'vs-dark' | 'light'>('vs-dark')

  useEffect(() => {
    // Sync theme with system
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
        setTheme('vs-dark')
    } else {
        setTheme('light')
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
                setTheme(isDark ? 'vs-dark' : 'light')
            }
        })
    })
    
    observer.observe(document.documentElement, { attributes: true })

    // Setup listener
    const cleanup = (window as any).electronAPI?.onCodeLoadContent?.((text: string) => {
        console.log('Received content:', text.substring(0, 50) + '...')
        setContent(text)
        detectLanguage(text)
    })
    
    // Signal ready
    setTimeout(() => {
        console.log('Signaling ready...')
        ;(window as any).electronAPI?.signalCodeReady?.()
    }, 500)
    
    return () => {
        if (typeof cleanup === 'function') cleanup()
        observer.disconnect()
    }
  }, [])

  const detectLanguage = (text: string) => {
      // Simple heuristic
      if (text.trim().startsWith('<') || text.includes('</div>')) setLanguage('html')
      else if (text.includes('function') || text.includes('const ') || text.includes('=>')) setLanguage('javascript')
      else if (text.includes('import ') && text.includes('from ')) setLanguage('typescript')
      else if (text.trim().startsWith('{') || text.trim().startsWith('[')) setLanguage('json')
      else if (text.includes('class ') && text.includes('public ')) setLanguage('java')
      else if (text.includes('#include')) setLanguage('cpp')
      else if (text.includes('def ')) setLanguage('python')
      else setLanguage('plaintext')
  }

  const handleCopy = () => {
      ;(window as any).electronAPI?.copyText?.(content)
      notifySuccess('Copiado al portapapeles')
  }

  return (
    <WindowShell title="Editor de Código">
      <div className="flex flex-col h-full">
          {/* Toolbar */}
          <div className="h-12 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)] flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-4">
                  <select 
                    value={language} 
                    onChange={e => setLanguage(e.target.value)}
                    className="bg-[color:var(--color-bg)] text-[color:var(--color-text)] text-xs px-3 py-1.5 rounded-[var(--radius-input)] border border-[color:var(--color-border)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)]"
                  >
                      <option value="plaintext">Plain Text</option>
                      <option value="javascript">JavaScript</option>
                      <option value="typescript">TypeScript</option>
                      <option value="html">HTML</option>
                      <option value="css">CSS</option>
                      <option value="json">JSON</option>
                      <option value="python">Python</option>
                      <option value="java">Java</option>
                      <option value="cpp">C++</option>
                      <option value="sql">SQL</option>
                      <option value="xml">XML</option>
                      <option value="markdown">Markdown</option>
                  </select>
              </div>
              
              <div className="flex items-center gap-2">
                  <button 
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[color:var(--color-primary)] hover:bg-blue-600 rounded-[var(--radius-button)] text-xs font-medium text-white transition-colors duration-100"
                  >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                      Copiar
                  </button>
              </div>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-hidden relative">
              <Editor
                height="100%"
                language={language}
                value={content}
                theme={theme}
                onChange={(val) => setContent(val || '')}
                options={{
                    minimap: { enabled: true },
                    fontSize: 14,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    padding: { top: 16, bottom: 16 },
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                }}
              />
          </div>
          
          {/* Status Bar */}
          <div className="h-6 bg-[color:var(--color-primary)] text-white text-[10px] flex items-center px-4 justify-between shrink-0">
              <div>Length: {content.length} chars</div>
              <div className="uppercase">{language}</div>
          </div>
      </div>
    </WindowShell>
  )
}
