/**
 * ipc-utils.ts
 * Utilidades compartidas para normalizar datos antes de enviarlos al renderer via IPC.
 * Usado por main.ts y BackendDaemon.ts para evitar duplicación y circular imports.
 */

export interface IPCClipboardItem {
  id: string | undefined
  value: string
  type: string
  favorite: boolean
  createdAt: string | undefined
  imagePath: string | null
}

/**
 * Normaliza un item de DB (campos PascalCase de sql.js) al shape
 * que espera el renderer (HistoryItem en types.ts).
 */
export function normalizeItemForIPC(i: any): IPCClipboardItem {
  return {
    id: i.id,
    value: i.value,
    type: i.type,           // 'text' | 'image' — requerido por HistoryItem
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

/**
 * Normaliza un array de items.
 */
export function normalizeForIPC(items: any[]): IPCClipboardItem[] {
  return items.map(normalizeItemForIPC)
}
