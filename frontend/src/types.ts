export type ItemType = 'text' | 'image' | 'code' | 'file' | 'html'

export type HistoryItem = {
  id?: string
  type: ItemType
  value: string
  favorite: boolean
  createdAt?: string
  imagePath?: string
  previewPath?: string
  originalPath?: string
}

export type FilterType = 'all' | 'text' | 'image' | 'favorite' | 'documents'
