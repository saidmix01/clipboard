export type HistoryItem = {
  id?: string
  type?: 'text' | 'image' | 'html' | 'code' | 'file'
  value: string
  meta?: any
  favorite: boolean
  createdAt?: string
  imagePath?: string
  previewPath?: string
  originalPath?: string
}

export type FilterType = 'all' | 'text' | 'image' | 'favorite' | 'documents'
