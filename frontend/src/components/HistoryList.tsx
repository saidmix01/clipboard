import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import Card from './Card'
import type { HistoryItem } from '../types'

export interface HistoryListRef {
  focus: () => void
}

type Props = {
  items: HistoryItem[]
  search: string
  selectedIndex: number
  onToggleFavorite: (item: HistoryItem) => void
  onCopy: (item: HistoryItem) => void
  onDelete?: (item: HistoryItem) => void
  highlightMatch: (text: string, query: string) => React.ReactNode[] | string
  canFavorite?: boolean
  canOpenModal?: boolean
  onContextMenu?: (e: React.MouseEvent, item: HistoryItem) => void
  hasMore?: boolean
  onLoadMore?: () => void
  isLoadingMore?: boolean
}

const HistoryList = forwardRef<HistoryListRef, Props>(({ items, search, selectedIndex, onToggleFavorite, onCopy, onDelete, highlightMatch, canFavorite, canOpenModal, onContextMenu, hasMore = false, onLoadMore, isLoadingMore = false }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useImperativeHandle(ref, () => ({
    focus: () => {
      containerRef.current?.focus()
    }
  }))

  useEffect(() => {
    if (items.length === 0) return
    
    // Si es el primer elemento, aseguramos scroll top absoluto para ver padding y todo
    if (selectedIndex === 0 && containerRef.current) {
      containerRef.current.scrollTop = 0
      return
    }

    // Para otros elementos, scrollIntoView normal
    const itemEl = itemRefs.current[selectedIndex]
    if (itemEl && itemEl.scrollIntoView) {
      itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [selectedIndex, items])

  // Infinite scroll: detectar cuando se llega al final
  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasMore || !onLoadMore || isLoadingMore) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // Cargar más cuando estamos a 200px del final
      if (scrollHeight - scrollTop - clientHeight < 200) {
        onLoadMore()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [hasMore, onLoadMore, isLoadingMore])

  return (
    <div ref={containerRef} tabIndex={-1} className="flex-1 overflow-auto px-2 py-2 text-[color:var(--color-text)] outline-none" style={{ scrollbarWidth: 'thin' }}>
      {items.length === 0 ? (
        <p className="text-center text-xs text-[color:var(--color-muted)]">Sin coincidencias</p>
      ) : (
        <>
          {items.map((item, idx) => {
            // Usar id si está disponible, sino usar índice como fallback
            // Para claves estables que eviten re-renders innecesarios
            const stableKey = item.id || `${item.value.slice(0, 50)}-${idx}`
            return (
              <div key={stableKey} ref={el => { itemRefs.current[idx] = el }}>
                <Card
                  item={item}
                  search={search}
                  selected={idx === selectedIndex}
                  onToggleFavorite={() => onToggleFavorite(item)}
                  onCopy={() => onCopy(item)}
                  onDelete={onDelete ? () => onDelete(item) : undefined}
                  highlightMatch={highlightMatch}
                  canFavorite={!!canFavorite}
                  canOpenModal={!!canOpenModal}
                  onContextMenu={(e) => onContextMenu?.(e, item)}
                />
              </div>
            )
          })}
          {hasMore && isLoadingMore && (
            <div className="text-center text-xs text-[color:var(--color-muted)] py-2">
              Cargando más resultados...
            </div>
          )}
        </>
      )}
    </div>
  )
})

export default HistoryList
