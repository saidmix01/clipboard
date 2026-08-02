import { useEffect, useRef, useState, memo } from 'react'
import hljs from 'highlight.js'
import {
  StarIcon as StarOutline,
  TrashIcon,
  EyeIcon,
  Bars3BottomLeftIcon,
  CodeBracketIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline'
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
  } catch { /* not JSON */ }
  const codeIndicators = ['{', '}', '=>', 'function', 'const ', 'let ', 'class ', 'import ', 'export ', 'return ', '//', '/*', '*/']
  const hasCode = codeIndicators.some(k => text.includes(k))
  const lines = text.split('\n')
  const looksMultiline = lines.length > 2 && lines.some(l => /[{};=]/.test(l.trim()))
  return hasCode || looksMultiline
}

function CodeBlock({ code }: { code: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (ref.current) hljs.highlightElement(ref.current) }, [code])
  return (
    <pre className="m-0 p-0 bg-transparent overflow-hidden">
      <code
        ref={ref}
        className="text-[11px] leading-[1.5] font-mono p-0 !bg-transparent"
      >
        {code}
      </code>
    </pre>
  )
}

interface Props {
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

function Card({ item, selected, onCopy, onToggleFavorite, onDelete, highlightMatch, search, canFavorite = true, onContextMenu }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const isImage = item.value.startsWith('data:image') || !!(item as any).imagePath || item.value.startsWith('[LOCAL_IMAGE]:') || !!item.previewPath || !!item.originalPath
  const isCode = !isImage && isCodeSnippet(item.value)

  // Resolve image paths
  let previewPath: string | undefined = item.previewPath
  let originalPath: string | undefined = item.originalPath
  let imagePath: string | undefined = item.imagePath

  if (!originalPath && imagePath) originalPath = imagePath
  if (item.value.startsWith('[LOCAL_IMAGE]:')) {
    const extractedPath = item.value.replace('[LOCAL_IMAGE]:', '')
    if (!originalPath) originalPath = extractedPath
    if (!imagePath) imagePath = extractedPath
  }

  let legacyImageSrc: string | null = null
  if (item.value.startsWith('data:image') && !previewPath && !originalPath && !imagePath) {
    legacyImageSrc = item.value
  } else if ((item as any).imagePath && !previewPath && !originalPath) {
    legacyImageSrc = `local-image://${String((item as any).imagePath)}`
  } else if (item.value.startsWith('[LOCAL_IMAGE]:') && !previewPath && !originalPath) {
    legacyImageSrc = `local-image://${item.value.replace('[LOCAL_IMAGE]:', '')}`
  }

  const handleCopy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 500)
    onCopy()
  }

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isImage) {
      let path = item.value
      if (item.value.startsWith('[LOCAL_IMAGE]:')) {
        path = `local-image://${item.value.replace('[LOCAL_IMAGE]:', '')}`
      } else if ((item as any).imagePath) {
        path = `local-image://${(item as any).imagePath}`
      }
      ;(window as any).electronAPI?.openOCRWindow?.(path)
    } else {
      ;(window as any).electronAPI?.openCodeEditor?.(item.value)
    }
    ;(window as any).electronAPI?.hideWindow?.()
  }

  // Determine type color and icon
  let borderColor = 'border-transparent'
  let hoverBorderColor = 'hover:border-[color:var(--color-type-text)]'
  let TypeIcon = Bars3BottomLeftIcon
  let iconColor = 'text-[color:var(--color-type-text)]'

  if (isImage) {
    borderColor = selected ? 'border-[color:var(--color-type-image)]' : 'border-transparent'
    hoverBorderColor = 'hover:border-[color:var(--color-type-image)]'
    TypeIcon = PhotoIcon
    iconColor = 'text-[color:var(--color-type-image)]'
  } else if (isCode) {
    borderColor = selected ? 'border-[color:var(--color-type-code)]' : 'border-transparent'
    hoverBorderColor = 'hover:border-[color:var(--color-type-code)]'
    TypeIcon = CodeBracketIcon
    iconColor = 'text-[color:var(--color-type-code)]'
  } else {
    borderColor = selected ? 'border-[color:var(--color-type-text)]' : 'border-transparent'
  }

  // Time label
  const timeLabel = item.createdAt
    ? (() => {
        const date = new Date(item.createdAt)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        if (diffMins < 1) return t('time.now', 'Now')
        if (diffMins < 60) return t('time.mins_ago', '{{mins}} min ago', { mins: diffMins })
        const diffHours = Math.floor(diffMins / 60)
        if (diffHours < 24) return t('time.hours_ago', '{{hours}}h ago', { hours: diffHours })
        return date.toLocaleDateString([], { day: '2-digit', month: 'short' })
      })()
    : ''

  return (
    <div
      onClick={handleCopy}
      onContextMenu={onContextMenu}
      className={`
        group relative px-4 py-3 flex gap-3 cursor-pointer transition-colors duration-100 select-none
        border-l-2 ${borderColor} ${hoverBorderColor}
        ${copied
          ? 'bg-[color:var(--color-secondary)]/8'
          : 'hover:bg-[color:var(--color-surface-hover)]'
        }
        ${selected ? 'bg-[color:var(--color-surface-hover)]' : ''}
      `}
    >
      {/* Type icon */}
      <div className={`${iconColor} mt-0.5 shrink-0`}>
        <TypeIcon className="w-4 h-4" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-w-0">
        {isImage ? (
          <>
            <p className="text-[length:var(--font-size-card)] truncate text-[color:var(--color-text)]">
              {item.value.startsWith('[LOCAL_IMAGE]:')
                ? item.value.replace('[LOCAL_IMAGE]:', '').split(/[\\/]/).pop()
                : t('card.image_copied', 'Copied image')
              }
            </p>
            <div className="mt-2 h-16 w-24 rounded-md overflow-hidden border border-[color:var(--color-border)] bg-[color:var(--color-surface-hover)]">
              {(previewPath || originalPath || imagePath) ? (
                <LazyImage
                  previewPath={previewPath}
                  originalPath={originalPath}
                  imagePath={imagePath}
                  alt="preview"
                  className="w-full h-full object-cover"
                />
              ) : legacyImageSrc ? (
                <img src={legacyImageSrc} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[color:var(--color-muted)] text-xs">IMG</div>
              )}
            </div>
          </>
        ) : isCode ? (
          <div className="overflow-hidden rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] p-2" style={{ maxHeight: 64 }}>
            <CodeBlock code={item.value} />
          </div>
        ) : (
          <p
            className="text-[length:var(--font-size-card)] text-[color:var(--color-text)]"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {highlightMatch(item.value, search)}
          </p>
        )}

        {/* Metadata */}
        <p className="text-[11px] text-[color:var(--color-muted)] mt-1 flex items-center gap-1.5">
          {timeLabel && <span>{timeLabel}</span>}
          {isCode && <span>• Code</span>}
          {item.favorite && <StarSolid className="w-3 h-3 text-[color:var(--color-accent)] inline" />}
        </p>
      </div>

      {/* Hover actions */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
        <ActionBtn
          onClick={handleView}
          label={t('see_more', 'Ver')}
        >
          <EyeIcon className="w-3.5 h-3.5" />
        </ActionBtn>

        {canFavorite && (
          <ActionBtn
            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
            label={t('favorite', 'Favorito')}
            highlight={item.favorite}
          >
            {item.favorite
              ? <StarSolid className="w-3.5 h-3.5" />
              : <StarOutline className="w-3.5 h-3.5" />
            }
          </ActionBtn>
        )}

        {onDelete && (
          <ActionBtn
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            label={t('delete.title', 'Eliminar')}
            danger
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </ActionBtn>
        )}
      </div>
    </div>
  )
}

/* ─── Small action button ─── */
interface ActionBtnProps {
  onClick: (e: React.MouseEvent) => void
  label: string
  children: React.ReactNode
  highlight?: boolean
  danger?: boolean
}

function ActionBtn({ onClick, label, children, highlight, danger }: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`
        p-1.5 rounded shadow-sm border transition-colors duration-100
        bg-[color:var(--color-surface)] border-[color:var(--color-border)]
        ${danger
          ? 'text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-500/10'
          : highlight
            ? 'text-[color:var(--color-accent)] hover:bg-yellow-50 dark:hover:bg-yellow-500/10'
            : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-surface-hover)]'
        }
      `}
    >
      {children}
    </button>
  )
}

export default memo(Card, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.favorite === next.item.favorite &&
    prev.selected === next.selected &&
    prev.search === next.search &&
    prev.item.value === next.item.value &&
    prev.item.previewPath === next.item.previewPath &&
    prev.item.originalPath === next.item.originalPath &&
    prev.item.imagePath === next.item.imagePath
  )
})
