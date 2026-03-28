import { useEffect, useRef, useState, memo } from 'react'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { StarIcon as StarOutline, TrashIcon, EyeIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarSolid } from '@heroicons/react/24/solid'
import type { HistoryItem } from '../types'
import { useTranslation } from 'react-i18next'
import LazyImage from './LazyImage'

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
    <pre className="code-block m-0 p-0 bg-transparent">
      <code ref={ref} className="language-javascript text-[12px] leading-[1.3] font-mono p-0 bg-transparent" style={{ background: 'transparent' }}>{code}</code>
    </pre>
  )
}

type Props = {
  item: HistoryItem
  selected: boolean
  onCopy: () => void
  onToggleFavorite: () => void
  onDelete?: () => void
  highlightMatch: (text: string, query: string) => React.ReactNode[] | string
  search: string
  canFavorite?: boolean
  canOpenModal?: boolean
  onContextMenu?: (e: React.MouseEvent) => void
}

function Card({ item, selected, onCopy, onToggleFavorite, onDelete, highlightMatch, search, canFavorite = true, canOpenModal = true, onContextMenu }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  
  const isImage = item.value.startsWith('data:image') || !!(item as any).imagePath || item.value.startsWith('[LOCAL_IMAGE]:') || !!item.previewPath || !!item.originalPath
  const isCode = !isImage && isCodeSnippet(item.value)

  // Resolve image paths
  // Prioridad: previewPath > imagePath > originalPath > value (data URL o [LOCAL_IMAGE]:)
  let previewPath: string | undefined = item.previewPath
  let originalPath: string | undefined = item.originalPath
  let imagePath: string | undefined = item.imagePath

  // Si no hay previewPath/originalPath pero hay imagePath, usarlo como originalPath
  if (!originalPath && imagePath) {
    originalPath = imagePath
  }

  // Si el value es [LOCAL_IMAGE]:path, extraer el path
  if (item.value.startsWith('[LOCAL_IMAGE]:')) {
    const extractedPath = item.value.replace('[LOCAL_IMAGE]:', '')
    if (!originalPath) originalPath = extractedPath
    if (!imagePath) imagePath = extractedPath
  }

  // Para data URLs antiguas, mantener compatibilidad pero preferir paths
  let legacyImageSrc: string | null = null
  if (item.value.startsWith('data:image') && !previewPath && !originalPath && !imagePath) {
    legacyImageSrc = item.value
  } else if ((item as any).imagePath && !previewPath && !originalPath) {
    legacyImageSrc = `local-image://${String((item as any).imagePath)}`
  } else if (item.value.startsWith('[LOCAL_IMAGE]:') && !previewPath && !originalPath) {
    legacyImageSrc = `local-image://${item.value.replace('[LOCAL_IMAGE]:', '')}`
  }

  const handleCopy = (e: React.MouseEvent) => {
    setCopied(true)
    setTimeout(() => setCopied(false), 400)
    onCopy()
  }

  return (
    <div
      className={`group relative mb-1.5 p-2 rounded-[var(--radius-card)] border transition-all duration-150 ease-out select-none
        ${item.favorite 
          ? 'bg-[color:var(--color-accent)]/5 border-[color:var(--color-accent)]/30' 
          : 'bg-[color:var(--color-surface)] border-[color:var(--color-border)]'
        }
        ${selected ? 'ring-1 ring-[color:var(--color-primary)] border-[color:var(--color-primary)]' : ''}
        ${copied ? 'bg-[color:var(--color-secondary)]/10 border-[color:var(--color-secondary)]' : 'hover:bg-black/5 dark:hover:bg-[#2a2a2a]'}
      `}
      style={{ cursor: 'pointer', overflow: 'hidden', boxShadow: 'var(--shadow-soft)' }}
      onClick={handleCopy}
      onContextMenu={onContextMenu}
    >
      <div className="relative z-10">
        {isImage ? (
          <div className="relative rounded-[calc(var(--radius-card)-2px)] overflow-hidden">
            {(previewPath || originalPath || imagePath) ? (
              <LazyImage
                previewPath={previewPath}
                originalPath={originalPath}
                imagePath={imagePath}
                alt="imagen"
                className="max-w-full w-full object-cover"
                style={{ maxHeight: expanded ? undefined : 80 }}
              />
            ) : legacyImageSrc ? (
              <img
                src={legacyImageSrc}
                alt="imagen"
                className="max-w-full w-full object-cover"
                style={{ maxHeight: expanded ? undefined : 80 }}
              />
            ) : null}
            {!expanded && <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />}
          </div>
        ) : isCode ? (
          <div className="relative rounded-[calc(var(--radius-card)-2px)] overflow-hidden bg-black/5 dark:bg-white/5 border border-[color:var(--color-border)]/30 p-1">
            <div style={{ maxHeight: expanded ? undefined : 60, overflow: 'hidden' }}>
              <CodeBlock code={item.value} />
            </div>
            {!expanded && <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[color:var(--color-surface)] to-transparent pointer-events-none" />}
          </div>
        ) : (
          <div 
            className="text-[color:var(--color-text)] break-words text-[13px] leading-[1.4] font-medium" 
            style={{ 
              display: '-webkit-box', 
              WebkitLineClamp: expanded ? 'unset' : 2, 
              WebkitBoxOrient: 'vertical', 
              overflow: 'hidden' 
            }}
          >
            {highlightMatch(item.value, search)}
          </div>
        )}
      </div>

      {/* Floating Action Buttons */}
      <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
        {(item.value.length > 200 || isImage || isCode) && (
          <button
            className="p-1 rounded-[var(--radius-button)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)] text-[color:var(--color-muted)] hover:text-white transition-colors shadow-sm"
            title={expanded ? t('see_less') : t('see_more')}
            onClick={(e) => {
              e.stopPropagation()
              if (canOpenModal && isImage) {
                 let path = item.value
                 if (item.value.startsWith('[LOCAL_IMAGE]:')) {
                     path = `local-image://${item.value.replace('[LOCAL_IMAGE]:', '')}`
                 } else if ((item as any).imagePath) {
                     path = `local-image://${(item as any).imagePath}`
                 }
                 (window as any).electronAPI?.openOCRWindow?.(path)
                 return 
              }
              if (canOpenModal || isCode) { 
                  (window as any).electronAPI?.openCodeEditor?.(item.value); 
                  return 
              }
              setExpanded(!expanded)
            }}
          >
            <EyeIcon className="w-3.5 h-3.5" />
          </button>
        )}
        {canFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
            title={t('favorite')}
            className={`p-1 rounded-[var(--radius-button)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-accent)] hover:text-white hover:border-[color:var(--color-accent)] transition-colors shadow-sm
              ${item.favorite ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-muted)]'}
            `}
          >
            {item.favorite ? <StarSolid className="w-3.5 h-3.5" /> : <StarOutline className="w-3.5 h-3.5" />}
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title={t('delete.title')}
            className="p-1 rounded-[var(--radius-button)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:bg-red-500 hover:text-white hover:border-red-500 text-[color:var(--color-muted)] transition-colors shadow-sm"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// Memoizar Card para evitar re-renders innecesarios
// Usar item.id como clave estable si está disponible
export default memo(Card, (prevProps, nextProps) => {
  // Comparación personalizada para optimizar re-renders
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.favorite === nextProps.item.favorite &&
    prevProps.selected === nextProps.selected &&
    prevProps.search === nextProps.search &&
    prevProps.item.value === nextProps.item.value &&
    prevProps.item.previewPath === nextProps.item.previewPath &&
    prevProps.item.originalPath === nextProps.item.originalPath &&
    prevProps.item.imagePath === nextProps.item.imagePath
  )
})
