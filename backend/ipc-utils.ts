/**
 * Utilidades para normalizar datos de DB al shape esperado por el renderer via IPC.
 */

export interface IPCClipboardItem {
  id: string | undefined
  value: string
  type: string
  favorite: boolean
  createdAt: string | undefined
  imagePath: string | null
}

export function normalizeItemForIPC(i: any): IPCClipboardItem {
  return {
    id: i.id,
    value: i.value,
    type: i.type,
    favorite: i.favorite,
    createdAt: i.createdAt,
    imagePath:
      i.type === 'image' &&
      typeof i.value === 'string' &&
      i.value.startsWith('[LOCAL_IMAGE]:')
        ? i.value.replace('[LOCAL_IMAGE]:', '')
        : null
  }
}

export function normalizeForIPC(items: any[]): IPCClipboardItem[] {
  return items.map(normalizeItemForIPC)
}
