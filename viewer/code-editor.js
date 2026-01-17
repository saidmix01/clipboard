const { ipcRenderer, clipboard } = require('electron')
const { Buffer } = require('buffer')

const editor = document.getElementById('editor')
const gutter = document.getElementById('gutter')
const btnClose = document.getElementById('close')
const btnCopy = document.getElementById('copy')
const statusEl = document.getElementById('status')
const titleEl = document.getElementById('title')
const hintEl = document.getElementById('hint')

const translations = {
  es: {
    title: 'Editor avanzado',
    copy: 'Copiar',
    loading: 'Cargando…',
    ready: 'Listo',
    hint: 'Esc para cerrar · Ctrl/Cmd+C para copiar'
  },
  en: {
    title: 'Advanced Editor',
    copy: 'Copy',
    loading: 'Loading...',
    ready: 'Ready',
    hint: 'Esc to close · Ctrl/Cmd+C to copy'
  }
}

// Detectar idioma
const params = new URLSearchParams(window.location.search)
const lang = params.get('lang') || 'en'
const t = translations[lang.startsWith('es') ? 'es' : 'en']

// Aplicar traducciones iniciales
if (titleEl) titleEl.textContent = t.title
if (btnCopy) btnCopy.textContent = t.copy
if (statusEl) statusEl.textContent = t.loading
if (hintEl) hintEl.textContent = t.hint

function getText () { return editor ? String(editor.textContent || '') : '' }
function setText (t_val) { 
  if (editor) { 
    editor.textContent = String(t_val || '')
    updateLines()
    if (statusEl) statusEl.textContent = t.ready 
  } 
}
function updateLines () { if (!gutter || !editor) return; const lines = getText().split('\n'); gutter.textContent = lines.map((_, i) => String(i + 1)).join('\n'); gutter.scrollTop = editor.scrollTop }
function handleKey (e) { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') } }
function syncFromEditor () { if (!gutter || !editor) return; const st = editor.scrollTop; if (gutter.scrollTop !== st) gutter.scrollTop = st }
function syncFromGutter () { if (!gutter || !editor) return; const st = gutter.scrollTop; if (editor.scrollTop !== st) editor.scrollTop = st }

document.addEventListener('keydown', e => { if (e.key === 'Escape') { window.close() } })
if (btnClose) { btnClose.addEventListener('click', () => window.close()) }
if (btnCopy) { btnCopy.addEventListener('click', () => { try { clipboard.writeText(getText()) } catch {} }) }
if (editor) { editor.addEventListener('input', updateLines); editor.addEventListener('keydown', handleKey); editor.addEventListener('scroll', syncFromEditor) }
if (gutter) { gutter.addEventListener('scroll', syncFromGutter) }

ipcRenderer.on('set-content', (_, b64) => { try { const text = Buffer.from(String(b64 || ''), 'base64').toString('utf-8'); setText(text) } catch { setText('') } })
