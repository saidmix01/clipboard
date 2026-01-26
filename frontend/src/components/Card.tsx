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

  return (
    <div
      className={`relative mb-2 p-2 rounded-[12px] border border-[color:var(--color-border)] ${selected ? 'ring-2 ring-[color:var(--color-primary)]' : ''}`}
      style={{ cursor: 'pointer', backgroundColor: 'var(--color-surface)', overflow: 'hidden' }}
      onClick={onCopy}
      onContextMenu={onContextMenu}
    >
      <div>
        {isImage ? (
          // Usar LazyImage si hay paths en disco, sino usar img legacy para data URLs
          (previewPath || originalPath || imagePath) ? (
            <LazyImage
              previewPath={previewPath}
              originalPath={originalPath}
              imagePath={imagePath}
              alt="imagen"
              className="max-w-full rounded-[10px]"
              style={{ maxHeight: expanded ? undefined : 120, objectFit: 'cover' }}
            />
          ) : legacyImageSrc ? (
            <img
              src={legacyImageSrc}
              alt="imagen"
              className="max-w-full rounded-[10px]"
              style={{ maxHeight: expanded ? undefined : 120, objectFit: 'cover' }}
            />
          ) : null
        ) : isCode ? (
          <div style={{ maxHeight: expanded ? undefined : 120, overflow: 'hidden' }}>
            <CodeBlock code={item.value} />
          </div>
        ) : (
          <div className="text-[color:var(--color-text)] break-words" style={{ fontSize: 'var(--font-size-card)', maxHeight: expanded ? undefined : 120, overflow: 'hidden' }}>
            {highlightMatch(item.value, search)}
          </div>
        )}
      </div>

      <div
        className="-mx-2 -mb-2 mt-2 flex items-center justify-between text-xs py-1 px-2 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
      >
        {(item.value.length > 300 || isImage || isCode) && (
          <button
            className="p-1 rounded-md hover:bg-[color:var(--color-bg)] transition-colors"
            title={expanded ? t('see_less') : t('see_more')}
            onClick={(e) => {
              e.stopPropagation()
              if (canOpenModal && isImage) {
                 // Open OCR Window
                 // Resolve path logic similar to above
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
            style={{ color: 'var(--color-text)' }}
          >
            <EyeIcon className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              title={t('delete.title')}
              className="p-1 rounded-md hover:bg-[color:var(--color-bg)] transition-colors"
              style={{ color: '#ef4444' }}
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
          {canFavorite && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
              title={t('favorite')}
              className="p-1 rounded-md hover:bg-[color:var(--color-bg)] transition-colors"
              style={{ color: item.favorite ? 'var(--color-accent)' : 'gray' }}
            >
              {item.favorite ? <StarSolid className="w-4 h-4" /> : <StarOutline className="w-4 h-4" />}
            </button>
          )}
        </div>
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
