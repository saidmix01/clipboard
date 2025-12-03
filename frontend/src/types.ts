export type HistoryItem = {
  id?: string
  value: string
  favorite: boolean
}

export type FilterType = 'all' | 'text' | 'image' | 'favorite'
