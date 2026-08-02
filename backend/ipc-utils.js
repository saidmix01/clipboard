"use strict";
/**
 * Utilidades para normalizar datos de DB al shape esperado por el renderer via IPC.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeItemForIPC = normalizeItemForIPC;
exports.normalizeForIPC = normalizeForIPC;
function normalizeItemForIPC(i) {
    return {
        id: i.id,
        value: i.value,
        type: i.type,
        favorite: i.favorite,
        createdAt: i.createdAt,
        imagePath: i.type === 'image' &&
            typeof i.value === 'string' &&
            i.value.startsWith('[LOCAL_IMAGE]:')
            ? i.value.replace('[LOCAL_IMAGE]:', '')
            : null
    };
}
function normalizeForIPC(items) {
    return items.map(normalizeItemForIPC);
}
