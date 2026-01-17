import { useRef, useEffect } from 'react'
import Card from './Card'
import type { HistoryItem } from '../types'

type Props = {
  items: HistoryItem[]
  search: string
  selectedIndex: number
  onToggleFavorite: (item: HistoryItem) => void
  onCopy: (item: HistoryItem) => void
  highlightMatch: (text: string, query: string) => React.ReactNode[] | string
  canFavorite?: boolean
  canOpenModal?: boolean
  onContextMenu?: (e: React.MouseEvent, item: HistoryItem) => void
}

export default function HistoryList({ items, search, selectedIndex, onToggleFavorite, onCopy, highlightMatch, canFavorite, canOpenModal, onContextMenu }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

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

  return (
    <div ref={containerRef} className="flex-1 overflow-auto px-2 py-2 text-[color:var(--color-text)]" style={{ scrollbarWidth: 'thin' }}>
      {items.length === 0 ? (
        <p className="text-center text-xs text-[color:var(--color-muted)]">Sin coincidencias</p>
      ) : (
        items.map((item, idx) => {
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
                highlightMatch={highlightMatch}
                canFavorite={!!canFavorite}
                canOpenModal={!!canOpenModal}
                onContextMenu={(e) => onContextMenu?.(e, item)}
              />
            </div>
          )
        })
      )}
    </div>
  )
}
