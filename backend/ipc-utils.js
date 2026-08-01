"use strict";
/**
 * ipc-utils.ts
 * Utilidades compartidas para normalizar datos antes de enviarlos al renderer via IPC.
 * Usado por main.ts y BackendDaemon.ts para evitar duplicación y circular imports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeItemForIPC = normalizeItemForIPC;
exports.normalizeForIPC = normalizeForIPC;
/**
 * Normaliza un item de DB (campos PascalCase de sql.js) al shape
 * que espera el renderer (HistoryItem en types.ts).
 */
function normalizeItemForIPC(i) {
    return {
        id: i.id,
        value: i.value,
        type: i.type, // 'text' | 'image' — requerido por HistoryItem
        favorite: i.favorite,
        createdAt: i.createdAt,
        imagePath: i.type === 'image' &&
            typeof i.value === 'string' &&
            i.value.startsWith('[LOCAL_IMAGE]:')
            ? i.value.replace('[LOCAL_IMAGE]:', '')
            : null
    };
}
/**
 * Normaliza un array de items.
 */
function normalizeForIPC(items) {
    return items.map(normalizeItemForIPC);
}
