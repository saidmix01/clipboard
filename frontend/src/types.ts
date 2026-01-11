export type HistoryItem = {
  id?: string
  value: string
  favorite: boolean
  imagePath?: string
}

export type FilterType = 'all' | 'text' | 'image' | 'favorite' | 'documents'
