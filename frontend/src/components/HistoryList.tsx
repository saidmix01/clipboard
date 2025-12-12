import { useRef } from 'react'
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
}

export default function HistoryList({ items, search, selectedIndex, onToggleFavorite, onCopy, highlightMatch, canFavorite, canOpenModal }: Props) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  return (
    <div className="flex-1 overflow-auto px-2 py-2 text-[color:var(--color-text)]" style={{ scrollbarWidth: 'thin' }}>
      {items.length === 0 ? (
        <p className="text-center text-xs text-[color:var(--color-muted)]">Sin coincidencias</p>
      ) : (
        items.map((item, idx) => (
          <div key={idx} ref={el => { itemRefs.current[idx] = el }}>
            <Card
              item={item}
              search={search}
              selected={idx === selectedIndex}
              onToggleFavorite={() => onToggleFavorite(item)}
              onCopy={() => onCopy(item)}
              highlightMatch={highlightMatch}
              canFavorite={!!canFavorite}
              canOpenModal={!!canOpenModal}
            />
          </div>
        ))
      )}
    </div>
  )
}
