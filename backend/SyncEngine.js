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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncEngine = void 0;
const electron_1 = require("electron");
const SyncQueue_1 = require("./SyncQueue");
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
        this.queue = new SyncQueue_1.SyncQueue();
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
        // Sincronización inicial inmediata
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
     */
    async enqueueItem(itemId, operation) {
        const item = await this.getItemFromDb(itemId);
        if (!item) {
            console.warn(`[SyncEngine] Item ${itemId} not found in DB`);
            return;
        }
        await this.queue.enqueue({
            type: operation,
            itemId: item.id,
            item: item,
            timestamp: Date.now(),
            retries: 0
        });
        this.stats.itemsPending++;
        this.broadcastStats();
    }
    /**
     * Proceso principal de sincronización
     */
    async performSync() {
        // Prevenir ejecución concurrente
        if (this.isRunning) {
            console.log('[SyncEngine] Sync already in progress, skipping');
            return this.stats;
        }
        // Verificar conectividad
        if (!this.networkMonitor.isOnline()) {
            console.log('[SyncEngine] Offline, skipping sync');
            return this.stats;
        }
        // Verificar autenticación
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
            // FASE 1: Enviar cambios locales a la nube
            console.log('[SyncEngine] Phase 1: Pushing local changes...');
            await this.pushLocalChanges();
            // FASE 2: Recibir cambios remotos (no crítico si falla)
            console.log('[SyncEngine] Phase 2: Pulling remote changes...');
            try {
                await this.pullRemoteChanges();
            }
            catch (pullError) {
                console.warn('[SyncEngine] Pull failed but continuing:', pullError.message);
                // No detener la sincronización si el pull falla
            }
            // FASE 3: Resolver conflictos
            console.log('[SyncEngine] Phase 3: Resolving conflicts...');
            await this.resolveConflicts();
            this.stats.lastSyncAt = Date.now();
            console.log('[SyncEngine] Sync cycle completed successfully');
        }
        catch (error) {
            console.error('[SyncEngine] Sync cycle failed:', error.message || error);
            this.stats.errors++;
        }
        finally {
            this.isRunning = false;
            this.stats.isRunning = false;
            this.broadcastStats();
        }
        return this.stats;
    }
    /**
     * FASE 1: Enviar cambios locales a la nube
     */
    async pushLocalChanges() {
        console.log('[SyncEngine] Pushing local changes...');
        // Procesar cola de operaciones pendientes
        let processed = 0;
        let errors = 0;
        while (this.queue.hasItems()) {
            const operation = await this.queue.dequeue();
            if (!operation)
                break;
            try {
                await this.sendOperationToCloud(operation);
                this.stats.itemsSynced++;
                this.stats.itemsPending--;
                processed++;
            }
            catch (error) {
                console.error(`[SyncEngine] Failed to push operation:`, error.message);
                errors++;
                if (this.shouldRetry(error, operation)) {
                    await this.queue.scheduleRetry(operation);
                }
                else {
                    // Marcar como fallido permanentemente
                    await this.markOperationAsFailed(operation);
                    this.stats.errors++;
                }
            }
        }
        console.log(`[SyncEngine] Pushed ${processed} operations (${errors} errors)`);
    }
    /**
     * FASE 2: Recibir cambios remotos
     */
    async pullRemoteChanges() {
        console.log('[SyncEngine] Pulling remote changes...');
        try {
            const activeDevice = this.backendDaemon.getActiveDevice();
            if (!activeDevice) {
                console.log('[SyncEngine] No active device, skipping pull');
                return;
            }
            const lastSync = this.stats.lastSyncAt || 0;
            // Obtener cambios desde el último sync usando el endpoint correcto
            const response = await this.backendDaemon.request({
                method: 'GET',
                url: '/clipboard',
                params: {
                    since: new Date(lastSync).toISOString(),
                    clientId: activeDevice.Id
                }
            });
            if (!response.success) {
                console.warn('[SyncEngine] Failed to fetch remote changes:', response.error);
                return;
            }
            if (!response.data) {
                console.log('[SyncEngine] No remote data received');
                return;
            }
            const remoteItems = this.extractItemsFromResponse(response.data);
            console.log(`[SyncEngine] Received ${remoteItems.length} remote items`);
            // Aplicar cambios remotos
            for (const remoteItem of remoteItems) {
                await this.applyRemoteChange(remoteItem);
            }
        }
        catch (error) {
            console.error('[SyncEngine] Error pulling remote changes:', error.message);
        }
    }
    /**
     * FASE 3: Resolver conflictos
     */
    async resolveConflicts() {
        console.log('[SyncEngine] Resolving conflicts...');
        // Obtener items con conflictos (versión local != versión remota)
        const conflicts = await this.getConflictedItems();
        for (const conflict of conflicts) {
            try {
                const resolved = this.conflictResolver.resolve(conflict.local, conflict.remote);
                await this.saveResolvedItem(resolved);
            }
            catch (error) {
                console.error('[SyncEngine] Failed to resolve conflict:', error);
                this.stats.errors++;
            }
        }
        console.log(`[SyncEngine] Resolved ${conflicts.length} conflicts`);
    }
    /**
     * Envía una operación a la nube
     */
    async sendOperationToCloud(operation) {
        const { type, item } = operation;
        switch (type) {
            case 'CREATE':
            case 'UPDATE':
                // Usar el endpoint correcto: POST /clipboard
                // El cliente local es la fuente de verdad, siempre enviamos el ID
                const payload = {
                    id: item.id, // Siempre enviar el UUID local
                    type: item.type,
                    clientId: item.deviceId, // Usar deviceId como clientId
                    favorite: item.favorite || false,
                    meta: item.meta || null,
                    createdAt: item.createdAt || new Date().toISOString()
                };
                // Si el item está encriptado, enviar campos de encriptación
                if (item.encrypted) {
                    payload.valueEnc = item.valueEnc || item.value;
                    payload.iv = item.iv;
                    payload.authTag = item.authTag;
                    payload.encrypted = true;
                }
                else {
                    payload.value = item.value;
                }
                await this.backendDaemon.request({
                    method: 'POST',
                    url: '/clipboard',
                    data: payload
                });
                break;
            case 'DELETE':
                // Usar el endpoint correcto: PUT /clipboard/:id con deleted: true
                await this.backendDaemon.request({
                    method: 'PUT',
                    url: `/clipboard/${item.id}`,
                    data: {
                        deleted: true
                    }
                });
                break;
        }
        // Marcar como sincronizado en DB local
        await this.markItemAsSynced(item.id);
    }
    /**
     * Aplica un cambio remoto a la DB local
     */
    async applyRemoteChange(remoteItem) {
        // Mapear campos del backend a formato local
        const mappedItem = {
            id: remoteItem.id,
            value: remoteItem.encrypted ? remoteItem.valueEnc : remoteItem.value, // Usar valueEnc si está encriptado
            type: remoteItem.type,
            deviceId: remoteItem.deviceId || remoteItem.clientId,
            createdAt: remoteItem.createdAt,
            updatedAt: remoteItem.updatedAt,
            version: remoteItem.version || 1,
            favorite: remoteItem.favorite || false,
            deleted: remoteItem.deleted || false,
            encrypted: remoteItem.encrypted || false,
            // Campos de encriptación si existen
            valueEnc: remoteItem.valueEnc,
            iv: remoteItem.iv,
            authTag: remoteItem.authTag
        };
        // Si está marcado como eliminado, eliminar localmente
        if (mappedItem.deleted) {
            db.deleteItem(mappedItem.id);
            console.log(`[SyncEngine] Deleted item ${mappedItem.id} from remote`);
            return;
        }
        const localItem = await this.getItemFromDb(mappedItem.id);
        if (!localItem) {
            // Nuevo item remoto - insertar
            db.insertItem(mappedItem.value, mappedItem.type, mappedItem.deviceId);
            console.log(`[SyncEngine] Inserted new remote item ${mappedItem.id}`);
        }
        else {
            // Item existe - verificar versión
            const localVersion = localItem.version || 1;
            const remoteVersion = mappedItem.version || 1;
            if (remoteVersion > localVersion) {
                // Actualización remota más reciente
                await this.updateLocalItem(mappedItem);
                console.log(`[SyncEngine] Updated item ${mappedItem.id} from remote`);
            }
            else if (remoteVersion === localVersion) {
                // Posible conflicto - marcar para resolución
                await this.markAsConflicted(localItem, mappedItem);
                console.log(`[SyncEngine] Conflict detected for item ${mappedItem.id}`);
            }
        }
    }
    /**
     * Determina si una operación debe reintentarse
     */
    shouldRetry(error, operation) {
        // No reintentar si ya se intentó muchas veces
        if (operation.retries >= 5) {
            return false;
        }
        // Reintentar en errores de red
        const retryableErrors = ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'];
        if (retryableErrors.includes(error.code)) {
            return true;
        }
        // Reintentar en errores 5xx del servidor
        if (error.response && error.response.status >= 500) {
            return true;
        }
        // No reintentar en errores 4xx (cliente)
        return false;
    }
    /**
     * Configura monitoreo de red
     */
    setupNetworkMonitoring() {
        this.networkMonitor.onStatusChange((online) => {
            console.log(`[SyncEngine] Network status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
            if (online) {
                // Reconectado - intentar sincronizar
                console.log('[SyncEngine] Network reconnected, triggering sync');
                this.performSync().catch(err => {
                    console.error('[SyncEngine] Reconnect sync failed:', err);
                });
            }
            this.broadcastNetworkStatus(online);
        });
    }
    /**
     * Helpers de base de datos
     */
    async getItemFromDb(itemId) {
        const items = db.getItems(1, 0, { id: itemId });
        return items.length > 0 ? items[0] : null;
    }
    async markItemAsSynced(itemId) {
        db.markItemAsSynced(itemId);
    }
    async markOperationAsFailed(operation) {
        // Loguear operación fallida para análisis posterior
        console.error('[SyncEngine] Operation failed permanently:', operation);
    }
    async updateLocalItem(remoteItem) {
        db.updateItem(remoteItem);
    }
    async markAsConflicted(localItem, remoteItem) {
        db.markAsConflicted(localItem.id, remoteItem);
    }
    async getConflictedItems() {
        return db.getConflictedItems();
    }
    async saveResolvedItem(item) {
        if (!item || !item.id) {
            console.error('[SyncEngine] Cannot save resolved item: missing id');
            return;
        }
        db.updateItem(item);
        db.clearConflict(item.id);
    }
    extractItemsFromResponse(data) {
        if (Array.isArray(data))
            return data;
        if (data.items && Array.isArray(data.items))
            return data.items;
        if (data.data && Array.isArray(data.data))
            return data.data;
        if (data.data && data.data.items && Array.isArray(data.data.items))
            return data.data.items;
        return [];
    }
    /**
     * Broadcasting de eventos
     */
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
    /**
     * Cleanup al cerrar la aplicación
     */
    destroy() {
        this.stopScheduler();
        this.networkMonitor.destroy();
        console.log('[SyncEngine] Destroyed');
    }
}
exports.SyncEngine = SyncEngine;
