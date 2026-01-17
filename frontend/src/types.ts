export type HistoryItem = {
  id?: string
  value: string
  favorite: boolean
  imagePath?: string
  previewPath?: string
  originalPath?: string
}

export type FilterType = 'all' | 'text' | 'image' | 'favorite' | 'documents'
