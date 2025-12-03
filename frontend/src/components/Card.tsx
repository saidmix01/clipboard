import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { StarIcon as StarOutline } from '@heroicons/react/24/outline'
import { StarIcon as StarSolid } from '@heroicons/react/24/solid'
import type { HistoryItem } from '../types'

function isCodeSnippet(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith('data:image')) return false
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) return true
  } catch {}
  const hasCodeIndicators = ['{','}','=>','function','const ','let ','class ','import ','export ','return ','//','/*','*/'].some(k => text.includes(k))
  const lines = text.split('\n')
  const looksMultilineCode = lines.length > 2 && lines.some(l => /[{};=]/.test(l.trim()))
  return hasCodeIndicators || looksMultilineCode
}

function CodeBlock({ code }: { code: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (ref.current) hljs.highlightElement(ref.current) }, [code])
  return (
    <pre className="code-block">
      <code ref={ref} className="language-javascript">{code}</code>
    </pre>
  )
}

type Props = {
  item: HistoryItem
  selected: boolean
  onCopy: () => void
  onToggleFavorite: () => void
  highlightMatch: (text: string, query: string) => React.ReactNode[] | string
  darkMode: boolean
  search: string
}

export default function Card({ item, selected, onCopy, onToggleFavorite, highlightMatch, darkMode, search }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isImage = item.value.startsWith('data:image')
  const isCode = isCodeSnippet(item.value)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.9, 0.38, 1] }}
      className={`relative mb-2 p-2 rounded-[12px] border border-[color:var(--color-border)] ${selected ? 'ring-2 ring-[color:var(--color-primary)]' : ''}`}
      style={{ cursor: 'pointer', backgroundColor: 'var(--color-surface)' }}
      onClick={onCopy}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
        title="Marcar como favorito"
        className="absolute top-1 right-1 p-1 rounded-md hover:bg-[color:var(--color-bg)]"
        style={{ color: item.favorite ? 'var(--color-accent)' : 'gray' }}
      >
        {item.favorite ? <StarSolid className="w-5 h-5" /> : <StarOutline className="w-5 h-5" />}
      </button>

      <div>
        {isImage ? (
          <img src={item.value} alt="imagen" className="max-w-full rounded-[10px]" />
        ) : isCode ? (
          <CodeBlock code={item.value} />
        ) : (
          <div className="text-sm text-[color:var(--color-text)] break-words">
            {highlightMatch(item.value, search)}
          </div>
        )}
      </div>

      {item.value.length > 300 && (
        <div
          className="absolute left-0 bottom-0 w-full text-center text-xs py-1 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
          onClick={(e) => {
            e.stopPropagation()
            if (isImage) { (window as any).electronAPI?.openImageViewer?.(item.value); return }
            if (isCode) { (window as any).electronAPI?.openCodeEditor?.(item.value); return }
            setExpanded(!expanded)
          }}
        >
          {expanded ? '▲ Ver menos' : '▼ Ver más'}
        </div>
      )}
    </motion.div>
  )
}
