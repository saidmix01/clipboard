"use strict";
/**
 * SyncEngine - Motor de sincronización con la nube
 *
 * Responsabilidades:
 * - Orquestar sincronización bidireccional
 * - Gestionar cola de operaciones pendientes
 * - Manejar reintentos con backoff exponencial
 * - Resolver conflictos de datos
 * - Monitorear estado de red
 *
 * NO ejecuta en tiempo real, se ejecuta cada hora automáticamente
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncEngine = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ConflictResolver_1 = require("./ConflictResolver");
const NetworkMonitor_1 = require("./NetworkMonitor");
const BackendDaemon_1 = require("./BackendDaemon");
const db = require('../db');
class SyncEngine {
    constructor() {
        this.syncInterval = null;
        this.isRunning = false;
        this.stats = {
            lastSyncAt: null,
            itemsSynced: 0,
            itemsPending: 0,
            errors: 0,
            isRunning: false
        };
        this.conflictResolver = new ConflictResolver_1.ConflictResolver();
        this.networkMonitor = new NetworkMonitor_1.NetworkMonitor();
        this.backendDaemon = BackendDaemon_1.BackendDaemon.getInstance();
        this.setupNetworkMonitoring();
    }
    static getInstance() {
        if (!SyncEngine.instance) {
            SyncEngine.instance = new SyncEngine();
        }
        return SyncEngine.instance;
    }
    /**
     * Inicia el scheduler de sincronización automática cada hora
     */
    startScheduler() {
        if (this.syncInterval) {
            console.log('[SyncEngine] Scheduler already running');
            return;
        }
        console.log('[SyncEngine] Starting hourly sync scheduler');
        // Sincronización inicial inmediata (Inicio Automático)
        this.performSync().catch(err => {
            console.error('[SyncEngine] Initial sync failed:', err);
        });
        // Sincronización cada hora (3600000 ms)
        this.syncInterval = setInterval(() => {
            this.performSync().catch(err => {
                console.error('[SyncEngine] Scheduled sync failed:', err);
            });
        }, 3600000); // 1 hora
    }
    /**
     * Detiene el scheduler de sincronización
     */
    stopScheduler() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('[SyncEngine] Scheduler stopped');
        }
    }
    /**
     * Ejecuta sincronización manual (llamada por usuario)
     */
    async syncNow() {
        return this.performSync();
    }
    /**
     * Obtiene estadísticas de sincronización
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * Encola un item para sincronización
     * (Mantenido por compatibilidad, pero ahora la lógica principal lee Pending=1 de DB)
     */
    async enqueueItem(itemId, operation) {
        // La inserción en DB ya marca Pending=1, así que solo notificamos stats
        this.stats.itemsPending++;
        this.broadcastStats();
        // Opcional: Trigger sync inmediato si es crítico, o dejar al scheduler
        // Por ahora, confiamos en el scheduler o sync manual
    }
    /**
     * Proceso principal de sincronización
     * Implementa estrictamente el orden del ciclo:
     * 1. Verificar lock
     * 2. Verificar red
     * 3. Verificar autenticación
     * 4. PUSH (pending = 1)
     * 5. PULL (según lastSync)
     * 6. Resolver conflictos
     * 7. Actualizar lastSync
     * 8. Liberar lock
     */
    async performSync() {
        // 1. Verificar lock (no doble ejecución)
        if (this.isRunning) {
            console.log('[SyncEngine] Sync already in progress, skipping');
            return this.stats;
        }
        // 2. Verificar red
        if (!this.networkMonitor.isOnline()) {
            console.log('[SyncEngine] Offline, waiting for connection...');
            return this.stats;
        }
        // 3. Verificar autenticación
        const settings = db.getSettings();
        if (!settings.accessToken) {
            console.log('[SyncEngine] Not authenticated, skipping sync');
            return this.stats;
        }
        this.isRunning = true;
        this.stats.isRunning = true;
        this.broadcastStats();
        console.log('[SyncEngine] Starting sync cycle');
        try {
            // 4. PUSH (pending = 1)
            console.log('[SyncEngine] Phase 1: PUSH local changes...');
            await this.pushLocalChanges();
            // 5. PULL (según lastSync)
            console.log('[SyncEngine] Phase 2: PULL remote changes...');
            const pullSuccess = await this.pullRemoteChanges();
            // 6. Resolver conflictos si aplica
            console.log('[SyncEngine] Phase 3: Resolving conflicts...');
            await this.resolveConflicts();
            // 7. Actualizar lastSync del dispositivo
            // Solo si PULL fue exitoso (PUSH y Resolve son locales/mixtos, pero PULL define el estado remoto)
            if (pullSuccess) {
                const activeDevice = this.backendDaemon.getActiveDevice(); // O usar settings.selectedDeviceId
                // Asegurar que tenemos un deviceId válido
                const deviceId = activeDevice ? activeDevice.Id : settings.selectedDeviceId;
                if (deviceId) {
                    const now = new Date().toISOString();
                    db.updateDeviceLastSync(deviceId, now);
                    this.stats.lastSyncAt = Date.now();
                    console.log(`[SyncEngine] LastSync updated for device ${deviceId} to ${now}`);
                }
                else {
                    console.warn('[SyncEngine] Cannot update LastSync: No active device ID found');
                }
            }
            else {
                console.warn('[SyncEngine] Pull failed, skipping LastSync update');
            }
            console.log('[SyncEngine] Sync cycle completed');
        }
        catch (error) {
            console.error('[SyncEngine] Sync cycle failed:', error.message || error);
            this.stats.errors++;
        }
        finally {
            // 8. Liberar lock
            this.isRunning = false;
            this.stats.isRunning = false;
            this.broadcastStats();
        }
        return this.stats;
    }
    /**
     * FASE 1: Enviar cambios locales a la nube (PUSH)
     * Regla: Solo enviar registros con Pending = 1
     */
    async pushLocalChanges() {
        const settings = db.getSettings();
        const activeDeviceId = settings.selectedDeviceId;
        if (!activeDeviceId) {
            console.warn('[SyncEngine] No active device, skipping push');
            return;
        }
        // Obtener items pendientes directamente de la DB (source of truth)
        // Filtramos por dispositivo activo para cumplir la regla "No mezclar datos"
        const pendingItems = db.getPendingItems(activeDeviceId);
        if (pendingItems.length === 0) {
            console.log('[SyncEngine] No pending items to push for device ' + activeDeviceId);
            return;
        }
        console.log(`[SyncEngine] Found ${pendingItems.length} pending items to push for device ${activeDeviceId}`);
        let processed = 0;
        let errors = 0;
        for (const item of pendingItems) {
            try {
                // Asegurar que el item tiene el deviceId correcto (aunque el filtro ya lo garantiza)
                if (item.deviceId !== activeDeviceId) {
                    console.warn(`[SyncEngine] Skipping item ${item.id} because deviceId mismatch (${item.deviceId} != ${activeDeviceId})`);
                    continue;
                }
                console.log(`[SyncEngine] Pushing item ${item.id} (type: ${item.type}) to cloud...`);
                await this.sendItemToCloud(item);
                console.log(`[SyncEngine] Successfully pushed item ${item.id}`);
                // Regla: Después de éxito -> Pending debe pasar a 0
                db.markItemAsSynced(item.id);
                this.stats.itemsSynced++;
                this.stats.itemsPending = Math.max(0, this.stats.itemsPending - 1);
                processed++;
            }
            catch (error) {
                console.error(`[SyncEngine] Failed to push item ${item.id}:`, error.message);
                if (error.response) {
                    console.error(`[SyncEngine] Error details: Status ${error.response.status}, Data:`, JSON.stringify(error.response.data));
                }
                errors++;
                // Regla: Si falla -> mantener Pending = 1.
                this.stats.errors++;
            }
        }
        console.log(`[SyncEngine] Pushed ${processed} items (${errors} errors)`);
        if (processed > 0) {
            this.backendDaemon.notifyClipboardUpdate();
        }
    }
    /**
     * FASE 2: Recibir cambios remotos (PULL)
     * Regla:
     * - Caso 1: lastSync NULL -> GET all
     * - Caso 2: lastSync existe -> GET ?since=...
     */
    async pullRemoteChanges() {
        try {
            const settings = db.getSettings();
            // El deviceId debe ser el dispositivo actualmente seleccionado
            const deviceId = settings.selectedDeviceId;
            if (!deviceId) {
                console.warn('[SyncEngine] No selected device, skipping pull');
                return false;
            }
            // Cargar lastSync correspondiente a ese deviceId
            const lastSync = db.getDeviceLastSync(deviceId);
            const params = {
                deviceId: deviceId
            };
            if (lastSync) {
                // ... (lógica existente)
                params.since = lastSync;
                console.log(`[SyncEngine] Pulling changes for device ${deviceId} since ${lastSync}`);
            }
            else {
                console.log(`[SyncEngine] Pulling all changes for device ${deviceId} (first sync / full sync)`);
            }
            // GET {{base_url}}/clipboard
            console.log(`[SyncEngine] Fetching remote items with params:`, JSON.stringify(params));
            const response = await this.backendDaemon.request({
                method: 'GET',
                url: '/clipboard',
                params: params
            });
            if (!response.success) {
                console.warn('[SyncEngine] Failed to fetch remote changes:', response.error);
                if (response.status === 404) {
                    console.warn('[SyncEngine] Backend returned 404 for clipboard fetch. Maybe device has no items?');
                }
                return false;
            }
            // IMPORTANTE: El backend devuelve { success: true, data: { items: [...] } }
            // extractItemsFromResponse debe manejar esta estructura anidada.
            const remoteItems = this.extractItemsFromResponse(response.data);
            console.log(`[SyncEngine] Received ${remoteItems.length} remote items from backend`);
            // Debug: Mostrar estructura si está vacío pero response.data no lo está
            if (remoteItems.length === 0 && response.data) {
                console.log('[SyncEngine] Debug Response Data Keys:', Object.keys(response.data));
                if (response.data.data)
                    console.log('[SyncEngine] Debug Response.data.data Keys:', Object.keys(response.data.data));
            }
            if (remoteItems.length === 0) {
                console.log('[SyncEngine] No new items found on server.');
                return true; // Éxito, pero sin datos
            }
            // Aplicar cambios remotos
            let changesApplied = false;
            for (const remoteItem of remoteItems) {
                await this.applyRemoteChange(remoteItem);
                changesApplied = true;
            }
            if (changesApplied) {
                this.backendDaemon.notifyClipboardUpdate();
            }
            return true;
        }
        catch (error) {
            console.error('[SyncEngine] Error pulling remote changes:', error.message);
            return false;
        }
    }
    /**
     * FASE 3: Resolver conflictos
     */
    async resolveConflicts() {
        // Obtener items con conflictos (versión local != versión remota, marcados con Pending=2)
        const conflicts = await this.getConflictedItems();
        if (conflicts.length === 0)
            return;
        console.log(`[SyncEngine] Resolving ${conflicts.length} conflicts...`);
        for (const conflict of conflicts) {
            try {
                const resolved = this.conflictResolver.resolve(conflict.local, conflict.remote);
                // Asegurar campos
                if (resolved.value === undefined)
                    resolved.value = conflict.local.value || conflict.remote.value || '';
                if (resolved.type === undefined)
                    resolved.type = conflict.local.type || conflict.remote.type || 'text';
                if (resolved.deviceId === undefined)
                    resolved.deviceId = conflict.local.deviceId || conflict.remote.deviceId;
                await this.saveResolvedItem(resolved);
            }
            catch (error) {
                console.error('[SyncEngine] Failed to resolve conflict:', error);
                this.stats.errors++;
            }
        }
    }
    /**
     * Envía un item a la nube (PUSH)
     */
    async sendItemToCloud(item) {
        // Endpoint: POST {{base_url}}/clipboard
        // El deviceId debe ser el dispositivo actualmente seleccionado (o el del item si ya tiene dueño)
        // Regla: "El deviceId debe ser el dispositivo actualmente seleccionado" para PUSH.
        // Asumimos que el item.deviceId ya fue seteado correctamente al crear (ver db.insertItem).
        const settings = db.getSettings();
        const currentDeviceId = settings.selectedDeviceId;
        // Validación: si el item no tiene deviceId, asignarle el actual
        if (!item.deviceId && currentDeviceId) {
            item.deviceId = currentDeviceId;
        }
        let valueToSend = item.value;
        // Manejo especial para imágenes locales: Convertir a Base64
        if (item.type === 'image' && typeof item.value === 'string' && item.value.startsWith('[LOCAL_IMAGE]:')) {
            try {
                const localPath = item.value.replace('[LOCAL_IMAGE]:', '');
                if (fs.existsSync(localPath)) {
                    const imageBuffer = fs.readFileSync(localPath);
                    // Intentar detectar extensión, fallback a png
                    const ext = path.extname(localPath).slice(1) || 'png';
                    // Crear data URI
                    valueToSend = `data:image/${ext};base64,${imageBuffer.toString('base64')}`;
                    console.log(`[SyncEngine] Converted local image ${localPath} to Base64 for sync (${valueToSend.length} chars)`);
                }
                else {
                    console.warn(`[SyncEngine] Local image file not found: ${localPath}`);
                }
            }
            catch (err) {
                console.error('[SyncEngine] Error reading local image for sync:', err.message);
            }
        }
        const payload = {
            // id: item.id, // ID local (UUID)
            // El backend espera 'value', 'type', 'clientId', 'deviceId', 'createdAt', 'updatedAt'
            // Opcionalmente 'id' si el backend lo soporta para idempotencia
            id: item.id,
            type: item.type,
            value: valueToSend,
            deviceId: item.deviceId,
            clientId: item.deviceId, // Usar deviceId como clientId
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || new Date().toISOString()
        };
        // Asegurarnos de enviar el booleano correcto para favorite, en lugar de omitirlo si es falso
        payload.favorite = item.favorite === 1 || item.favorite === true;
        if (item.isDeleted)
            payload.deleted = true; // Si soportamos soft delete push
        // Intentar PUT primero
        const putResponse = await this.backendDaemon.request({
            method: 'PUT',
            url: `/clipboard/${item.id}`,
            data: payload
        });
        if (putResponse.success) {
            console.log(`[SyncEngine] PUT success for item ${item.id}`);
        }
        else {
            // Si falla con 404 (No existe) -> Crear con POST
            if (putResponse.status === 404) {
                console.log(`[SyncEngine] Item ${item.id} not found on server (404), trying POST to create...`);
                const postResponse = await this.backendDaemon.request({
                    method: 'POST',
                    url: '/clipboard',
                    data: payload
                });
                if (postResponse.success) {
                    console.log(`[SyncEngine] POST success for item ${item.id}`);
                }
                else {
                    throw new Error(postResponse.error || `POST failed with status ${postResponse.status}`);
                }
            }
            else {
                // Otro error, lanzar excepción para que el loop principal lo maneje
                throw new Error(putResponse.error || `PUT failed with status ${putResponse.status}`);
            }
        }
        // Sincronizar el estado de favorito explícitamente usando el nuevo endpoint
        // POST /clipboard/favorites/sync
        // Lo hacemos al final para garantizar que el item ya existe en el backend
        try {
            console.log(`[SyncEngine] Syncing favorite status for item ${item.id}...`);
            await this.backendDaemon.request({
                method: 'POST',
                url: '/clipboard/favorites/sync',
                data: {
                    deviceId: currentDeviceId,
                    itemId: item.id,
                    favorite: payload.favorite
                }
            });
            console.log(`[SyncEngine] Successfully synced favorite status for item ${item.id}`);
        }
        catch (favErr) {
            console.warn(`[SyncEngine] Could not sync favorite status for item ${item.id}:`, favErr.message);
        }
    }
    /**
     * Aplica un cambio remoto a la DB local
     */
    async applyRemoteChange(remoteItem) {
        // Mapear campos
        let value = remoteItem.value;
        // Manejo de imágenes remotas (Base64 -> Archivo Local)
        if (remoteItem.type === 'image' && typeof value === 'string' && value.startsWith('data:image')) {
            try {
                // Extraer data URI
                const matches = value.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const ext = matches[1];
                    const base64Data = matches[2];
                    const buffer = Buffer.from(base64Data, 'base64');
                    // Directorio de imágenes en userData
                    const userDataPath = electron_1.app.getPath('userData');
                    const imagesDir = path.join(userDataPath, 'synced_images');
                    if (!fs.existsSync(imagesDir)) {
                        fs.mkdirSync(imagesDir, { recursive: true });
                    }
                    const filename = `${remoteItem.id}.${ext}`;
                    const localPath = path.join(imagesDir, filename);
                    fs.writeFileSync(localPath, buffer);
                    // Actualizar valor a formato local
                    value = `[LOCAL_IMAGE]:${localPath}`;
                    console.log(`[SyncEngine] Saved remote image to ${localPath}`);
                }
            }
            catch (err) {
                console.error('[SyncEngine] Error saving remote image:', err.message);
            }
        }
        if (remoteItem.encrypted) {
            value = remoteItem.valueEnc || remoteItem.value;
        }
        const mappedItem = {
            id: remoteItem.id,
            value: value || '',
            type: remoteItem.type,
            deviceId: remoteItem.deviceId || remoteItem.clientId,
            createdAt: remoteItem.createdAt,
            updatedAt: remoteItem.updatedAt,
            version: remoteItem.version || 1,
            favorite: remoteItem.favorite || false,
            deleted: remoteItem.deleted || false,
            encrypted: remoteItem.encrypted || false,
            valueEnc: remoteItem.encrypted ? value : remoteItem.valueEnc,
            iv: remoteItem.iv,
            authTag: remoteItem.authTag
        };
        if (mappedItem.deleted) {
            db.deleteItem(mappedItem.id);
            return;
        }
        const localItem = await this.getItemFromDb(mappedItem.id);
        if (!localItem) {
            // Nuevo item remoto
            // Insertar con Pending=0 (ya está en la nube)
            // Usamos db.insertItem pero forzamos el ID y Pending=0
            // Nota: db.insertItem setea Pending=0 si pasamos options.id
            db.insertItem(mappedItem.value, mappedItem.type, mappedItem.deviceId, {
                id: mappedItem.id,
                createdAt: mappedItem.createdAt,
                updatedAt: mappedItem.updatedAt,
                favorite: mappedItem.favorite,
                isDeleted: mappedItem.deleted
            });
        }
        else {
            // Conflicto potencial
            // Regla: No sobrescribir datos locales si hay conflicto real sin pasar por resolver
            // Simple verificación de versión (si el backend envía versiones)
            // Si no hay versiones, usamos timestamps
            const localTime = new Date(localItem.updatedAt).getTime();
            const remoteTime = new Date(mappedItem.updatedAt).getTime();
            // Si remoto es más nuevo, actualizamos
            if (remoteTime > localTime) {
                await this.updateLocalItem(mappedItem);
                db.markItemAsSynced(mappedItem.id); // Asegurar Pending=0
            }
            else if (remoteTime < localTime) {
                // Local es más nuevo -> Conflicto si Pending=1 (no sincronizado aún)
                if (localItem.pending) {
                    await this.markAsConflicted(localItem, mappedItem);
                }
                // Si local ya estaba sincronizado (Pending=0) y remoto es viejo, ignoramos remoto (o ganamos nosotros)
            }
        }
    }
    // --- Helpers ---
    extractItemsFromResponse(data) {
        if (Array.isArray(data))
            return data;
        // Case: { data: { items: [...] } } -> Deeply nested (Common in standardized APIs)
        if (data.data && data.data.items && Array.isArray(data.data.items))
            return data.data.items;
        // Case: { items: [...] }
        if (data.items && Array.isArray(data.items))
            return data.items;
        // Case: { data: [...] }
        if (data.data && Array.isArray(data.data))
            return data.data;
        return [];
    }
    setupNetworkMonitoring() {
        this.networkMonitor.onStatusChange((online) => {
            console.log(`[SyncEngine] Network status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
            if (online) {
                console.log('[SyncEngine] Reconnected, triggering sync');
                this.performSync().catch(console.error);
            }
            this.broadcastNetworkStatus(online);
        });
    }
    broadcastStats() {
        const windows = electron_1.BrowserWindow.getAllWindows();
        windows.forEach(w => {
            w.webContents.send('sync:stats', this.stats);
        });
    }
    broadcastNetworkStatus(online) {
        const windows = electron_1.BrowserWindow.getAllWindows();
        windows.forEach(w => {
            w.webContents.send('sync:network-status', { online });
        });
    }
    // DB Helpers Wrappers
    async getItemFromDb(itemId) {
        // Usar el método optimizado getItem si existe
        if (db.getItem) {
            return db.getItem(itemId);
        }
        // Fallback legacy (aunque getItems no filtra por ID realmente, esto es peligroso si no se arregló db.js)
        // Como ya arreglamos db.js, esto no debería ejecutarse.
        console.warn('[SyncEngine] db.getItem not found, falling back to getItems (risky)');
        const items = db.getItems(1, 0, { deviceId: null }); // Intencionalmente vago
        return null;
    }
    async updateLocalItem(item) {
        db.updateItem(item);
    }
    async markAsConflicted(localItem, remoteItem) {
        db.markAsConflicted(localItem.id, remoteItem);
    }
    async getConflictedItems() {
        return db.getConflictedItems();
    }
    async saveResolvedItem(item) {
        db.updateItem(item);
        db.clearConflict(item.id);
    }
    destroy() {
        this.stopScheduler();
        this.networkMonitor.destroy();
        console.log('[SyncEngine] Destroyed');
    }
}
exports.SyncEngine = SyncEngine;
