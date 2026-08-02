"use strict";
/**
 * SyncEngine - Motor de sincronización bidireccional con la nube.
 * Se ejecuta cada hora automáticamente y puede invocarse manualmente.
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
const PUSH_CONCURRENCY = 5;
const MAX_PERMANENT_FAILURES = 3;
class SyncEngine {
    constructor() {
        this.syncInterval = null;
        this.isRunning = false;
        this.permanentFailures = new Set();
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
    startScheduler() {
        if (this.syncInterval) {
            return;
        }
        console.log('[SyncEngine] Starting hourly sync scheduler');
        this.performSync().catch(err => {
            console.error('[SyncEngine] Initial sync failed:', err);
        });
        this.syncInterval = setInterval(() => {
            this.performSync().catch(err => {
                console.error('[SyncEngine] Scheduled sync failed:', err);
            });
        }, 3600000);
    }
    stopScheduler() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
    async syncNow() {
        return this.performSync();
    }
    getStats() {
        return { ...this.stats };
    }
    async enqueueItem(itemId, operation) {
        this.stats.itemsPending++;
        this.broadcastStats();
    }
    async performSync() {
        if (this.isRunning) {
            return this.stats;
        }
        if (!this.networkMonitor.isOnline()) {
            return this.stats;
        }
        const settings = db.getSettings();
        if (!settings.accessToken) {
            return this.stats;
        }
        this.isRunning = true;
        this.stats.isRunning = true;
        this.broadcastStats();
        try {
            await this.pushLocalChanges();
            const pullSuccess = await this.pullRemoteChanges();
            await this.resolveConflicts();
            if (pullSuccess) {
                const activeDevice = this.backendDaemon.getActiveDevice();
                const deviceId = activeDevice ? activeDevice.Id : settings.selectedDeviceId;
                if (deviceId) {
                    const now = new Date().toISOString();
                    db.updateDeviceLastSync(deviceId, now);
                    this.stats.lastSyncAt = Date.now();
                }
            }
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
     * PUSH: Enviar cambios locales con Pending=1 a la nube.
     * Procesa en batches paralelos de PUSH_CONCURRENCY.
     */
    async pushLocalChanges() {
        const settings = db.getSettings();
        const activeDeviceId = settings.selectedDeviceId;
        if (!activeDeviceId) {
            return;
        }
        const pendingItems = db.getPendingItems(activeDeviceId)
            .filter((item) => item.deviceId === activeDeviceId && !this.permanentFailures.has(item.id));
        if (pendingItems.length === 0) {
            return;
        }
        console.log(`[SyncEngine] Pushing ${pendingItems.length} pending items (concurrency: ${PUSH_CONCURRENCY})`);
        let processed = 0;
        // Procesar en batches paralelos
        for (let i = 0; i < pendingItems.length; i += PUSH_CONCURRENCY) {
            const batch = pendingItems.slice(i, i + PUSH_CONCURRENCY);
            const results = await Promise.allSettled(batch.map((item) => this.pushSingleItem(item)));
            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const item = batch[j];
                if (result.status === 'fulfilled') {
                    if (result.value === 'synced') {
                        db.markItemAsSynced(item.id);
                        this.stats.itemsSynced++;
                        this.stats.itemsPending = Math.max(0, this.stats.itemsPending - 1);
                        processed++;
                    }
                    // 'skipped' means image not found — already marked synced inside pushSingleItem
                }
                else {
                    const err = result.reason;
                    if (this.isPermanentError(err)) {
                        console.error(`[SyncEngine] Permanent failure for ${item.id}: ${err.message}`);
                        this.permanentFailures.add(item.id);
                        // Marcar como sincronizado para no bloquear la cola
                        db.markItemAsSynced(item.id);
                    }
                    else {
                        console.error(`[SyncEngine] Temporary failure for ${item.id}: ${err.message}`);
                    }
                    this.stats.errors++;
                }
            }
        }
        // Solo notificar al renderer si PULL trajo cambios visibles (no el PUSH)
        // El PUSH solo cambia Pending de 1→0, que no afecta la UI
    }
    /**
     * Envía un solo item a la nube. Retorna 'synced' | 'skipped'.
     */
    async pushSingleItem(item) {
        const settings = db.getSettings();
        const currentDeviceId = settings.selectedDeviceId;
        if (!item.deviceId && currentDeviceId) {
            item.deviceId = currentDeviceId;
        }
        let valueToSend = item.value;
        // Convertir imágenes locales a Base64 (lectura async)
        if (item.type === 'image' && typeof item.value === 'string' && item.value.startsWith('[LOCAL_IMAGE]:')) {
            const localPath = item.value.replace('[LOCAL_IMAGE]:', '');
            if (!fs.existsSync(localPath)) {
                db.markItemAsSynced(item.id);
                return 'skipped';
            }
            const imageBuffer = await fs.promises.readFile(localPath);
            const ext = path.extname(localPath).slice(1) || 'png';
            valueToSend = `data:image/${ext};base64,${imageBuffer.toString('base64')}`;
        }
        const payload = {
            id: item.id,
            type: item.type,
            value: valueToSend,
            deviceId: item.deviceId,
            clientId: item.deviceId,
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || new Date().toISOString(),
            favorite: item.favorite === 1 || item.favorite === true
        };
        if (item.isDeleted)
            payload.deleted = true;
        // PUT primero, fallback a POST si 404
        const putResponse = await this.backendDaemon.request({
            method: 'PUT',
            url: `/clipboard/${item.id}`,
            data: payload
        });
        if (putResponse.success) {
            return 'synced';
        }
        if (putResponse.status === 404) {
            const postResponse = await this.backendDaemon.request({
                method: 'POST',
                url: '/clipboard',
                data: payload
            });
            if (postResponse.success) {
                return 'synced';
            }
            throw this.createSyncError(postResponse);
        }
        throw this.createSyncError(putResponse);
    }
    /**
     * PULL: Recibir cambios remotos con paginación.
     * El backend limita a 1000 items por request, así que iteramos hasta obtener menos del límite.
     */
    async pullRemoteChanges() {
        try {
            const settings = db.getSettings();
            const deviceId = settings.selectedDeviceId;
            if (!deviceId) {
                return false;
            }
            const lastSync = db.getDeviceLastSync(deviceId);
            const PAGE_SIZE = 500;
            let totalPulled = 0;
            let changesApplied = false;
            let sinceParam = lastSync || undefined;
            // Paginar hasta que el backend devuelva menos items que el límite
            while (true) {
                const params = { deviceId, limit: PAGE_SIZE };
                if (sinceParam) {
                    params.since = sinceParam;
                }
                const response = await this.backendDaemon.request({
                    method: 'GET',
                    url: '/clipboard',
                    params
                });
                if (!response.success) {
                    console.warn('[SyncEngine] Failed to fetch remote changes:', response.error);
                    return false;
                }
                const remoteItems = this.extractItemsFromResponse(response.data);
                if (remoteItems.length === 0) {
                    break;
                }
                for (const remoteItem of remoteItems) {
                    await this.applyRemoteChange(remoteItem);
                    changesApplied = true;
                }
                totalPulled += remoteItems.length;
                // Si recibimos menos que el límite, no hay más páginas
                if (remoteItems.length < PAGE_SIZE) {
                    break;
                }
                // Avanzar el cursor: usar el updatedAt más reciente de esta página como nuevo since
                const lastItem = remoteItems[remoteItems.length - 1];
                const lastUpdatedAt = lastItem.updatedAt || lastItem.createdAt;
                if (lastUpdatedAt && lastUpdatedAt !== sinceParam) {
                    sinceParam = lastUpdatedAt;
                }
                else {
                    // Safety: evitar loop infinito si el cursor no avanza
                    break;
                }
            }
            if (totalPulled > 0) {
                console.log(`[SyncEngine] Pulled ${totalPulled} remote items total`);
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
     * Resolver conflictos (Pending=2)
     */
    async resolveConflicts() {
        const conflicts = await this.getConflictedItems();
        if (conflicts.length === 0)
            return;
        for (const conflict of conflicts) {
            try {
                const resolved = this.conflictResolver.resolve(conflict.local, conflict.remote);
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
    async applyRemoteChange(remoteItem) {
        let value = remoteItem.value;
        // Imágenes remotas (Base64 → archivo local)
        if (remoteItem.type === 'image' && typeof value === 'string' && value.startsWith('data:image')) {
            try {
                const matches = value.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const ext = matches[1];
                    const base64Data = matches[2];
                    const buffer = Buffer.from(base64Data, 'base64');
                    const userDataPath = electron_1.app.getPath('userData');
                    const imagesDir = path.join(userDataPath, 'synced_images');
                    if (!fs.existsSync(imagesDir)) {
                        fs.mkdirSync(imagesDir, { recursive: true });
                    }
                    const filename = `${remoteItem.id}.${ext}`;
                    const localPath = path.join(imagesDir, filename);
                    await fs.promises.writeFile(localPath, buffer);
                    value = `[LOCAL_IMAGE]:${localPath}`;
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
            deleted: remoteItem.deleted || false
        };
        if (mappedItem.deleted) {
            db.deleteItem(mappedItem.id);
            return;
        }
        const localItem = await this.getItemFromDb(mappedItem.id);
        if (!localItem) {
            db.insertItem(mappedItem.value, mappedItem.type, mappedItem.deviceId, {
                id: mappedItem.id,
                createdAt: mappedItem.createdAt,
                updatedAt: mappedItem.updatedAt,
                favorite: mappedItem.favorite,
                isDeleted: mappedItem.deleted
            });
        }
        else {
            const localTime = new Date(localItem.updatedAt).getTime();
            const remoteTime = new Date(mappedItem.updatedAt).getTime();
            if (remoteTime > localTime) {
                await this.updateLocalItem(mappedItem);
                db.markItemAsSynced(mappedItem.id);
            }
            else if (remoteTime < localTime && localItem.pending === 1) {
                await this.markAsConflicted(localItem, mappedItem);
            }
        }
    }
    // --- Error classification ---
    isPermanentError(error) {
        const status = error?.status || error?.response?.status;
        // 4xx errors (except 401 which is handled by interceptor, and 429 rate limit)
        return status >= 400 && status < 500 && status !== 401 && status !== 429;
    }
    createSyncError(response) {
        const err = new Error(response.error || `Request failed with status ${response.status}`);
        err.status = response.status;
        return err;
    }
    // --- Helpers ---
    extractItemsFromResponse(data) {
        if (Array.isArray(data))
            return data;
        if (data.data && data.data.items && Array.isArray(data.data.items))
            return data.data.items;
        if (data.items && Array.isArray(data.items))
            return data.items;
        if (data.data && Array.isArray(data.data))
            return data.data;
        return [];
    }
    setupNetworkMonitoring() {
        this.networkMonitor.onStatusChange((online) => {
            if (online) {
                this.performSync().catch(console.error);
            }
            this.broadcastNetworkStatus(online);
        });
    }
    broadcastStats() {
        const windows = electron_1.BrowserWindow.getAllWindows();
        windows.forEach(w => {
            if (!w.isDestroyed())
                w.webContents.send('sync:stats', this.stats);
        });
    }
    broadcastNetworkStatus(online) {
        const windows = electron_1.BrowserWindow.getAllWindows();
        windows.forEach(w => {
            if (!w.isDestroyed())
                w.webContents.send('sync:network-status', { online });
        });
    }
    async getItemFromDb(itemId) {
        return db.getItem(itemId);
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
        // El ganador del conflicto debe subirse al backend en el próximo PUSH
        db.markItemForSync(item.id);
    }
    destroy() {
        this.stopScheduler();
        this.networkMonitor.destroy();
    }
}
exports.SyncEngine = SyncEngine;
