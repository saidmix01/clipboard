/**
 * SyncEngine - Motor de sincronización bidireccional con la nube.
 * Se ejecuta cada hora automáticamente y puede invocarse manualmente.
 */

import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ConflictResolver } from './ConflictResolver';
import { NetworkMonitor } from './NetworkMonitor';
import { BackendDaemon } from './BackendDaemon';

const db = require('../db');

const PUSH_CONCURRENCY = 5;
const MAX_PERMANENT_FAILURES = 3;

export interface SyncStats {
  lastSyncAt: number | null;
  itemsSynced: number;
  itemsPending: number;
  errors: number;
  isRunning: boolean;
}

export class SyncEngine {
  private static instance: SyncEngine;
  private conflictResolver: ConflictResolver;
  private networkMonitor: NetworkMonitor;
  private backendDaemon: BackendDaemon;
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private permanentFailures: Set<string> = new Set();
  private stats: SyncStats = {
    lastSyncAt: null,
    itemsSynced: 0,
    itemsPending: 0,
    errors: 0,
    isRunning: false
  };

  private constructor() {
    this.conflictResolver = new ConflictResolver();
    this.networkMonitor = new NetworkMonitor();
    this.backendDaemon = BackendDaemon.getInstance();
    this.setupNetworkMonitoring();
  }

  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  public startScheduler() {
    if (this.syncInterval) {
      return;
    }

    console.log('[SyncEngine] Starting sync scheduler (every 30s fallback)');
    
    this.performSync().catch(err => {
      console.error('[SyncEngine] Initial sync failed:', err);
    });

    // 30-second polling as fallback when Supabase Realtime is unavailable.
    // When realtime IS connected, syncs are triggered instantly by RealtimeClient
    // and this interval acts only as a safety net.
    this.syncInterval = setInterval(() => {
      this.performSync().catch(err => {
        console.error('[SyncEngine] Scheduled sync failed:', err);
      });
    }, 30000);
  }

  public stopScheduler() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  public async syncNow(): Promise<SyncStats> {
    return this.performSync();
  }

  public getStats(): SyncStats {
    return { ...this.stats };
  }

  public async enqueueItem(itemId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE'): Promise<void> {
    this.stats.itemsPending++;
    this.broadcastStats();
  }

  private async performSync(): Promise<SyncStats> {
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

    } catch (error: any) {
      console.error('[SyncEngine] Sync cycle failed:', error.message || error);
      this.stats.errors++;
    } finally {
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
  private async pushLocalChanges(): Promise<void> {
    const settings = db.getSettings();
    const activeDeviceId = settings.selectedDeviceId;

    if (!activeDeviceId) {
        return;
    }

    const pendingItems = db.getPendingItems(activeDeviceId)
      .filter((item: any) => item.deviceId === activeDeviceId && !this.permanentFailures.has(item.id));
    
    if (pendingItems.length === 0) {
        return;
    }

    console.log(`[SyncEngine] Pushing ${pendingItems.length} pending items (concurrency: ${PUSH_CONCURRENCY})`);

    let processed = 0;

    // Procesar en batches paralelos
    for (let i = 0; i < pendingItems.length; i += PUSH_CONCURRENCY) {
      const batch = pendingItems.slice(i, i + PUSH_CONCURRENCY);
      
      const results = await Promise.allSettled(
        batch.map((item: any) => this.pushSingleItem(item))
      );

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
        } else {
          const err = result.reason;
          if (this.isPermanentError(err)) {
            console.error(`[SyncEngine] Permanent failure for ${item.id}: ${err.message}`);
            this.permanentFailures.add(item.id);
            // Marcar como sincronizado para no bloquear la cola
            db.markItemAsSynced(item.id);
          } else {
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
  private async pushSingleItem(item: any): Promise<'synced' | 'skipped'> {
    const settings = db.getSettings();
    const currentDeviceId = settings.selectedDeviceId;

    if (!item.deviceId && currentDeviceId) {
        item.deviceId = currentDeviceId;
    }

    // Si el item fue eliminado localmente, eliminarlo en el backend
    if (item.isDeleted) {
      const delResponse = await this.backendDaemon.request({
        method: 'DELETE',
        url: `/clipboard/${item.id}`
      });
      // 404 = ya no existe en el backend, considerar éxito
      if (delResponse.success || delResponse.status === 404) {
        return 'synced';
      }
      throw this.createSyncError(delResponse);
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

    const payload: any = {
      id: item.id,
      type: item.type,
      value: valueToSend,
      deviceId: item.deviceId,
      clientId: item.deviceId,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
      favorite: item.favorite === 1 || item.favorite === true
    };

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
  private async pullRemoteChanges(): Promise<boolean> {
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
        const params: any = { deviceId, limit: PAGE_SIZE };
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
        } else {
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

    } catch (error: any) {
      console.error('[SyncEngine] Error pulling remote changes:', error.message);
      return false;
    }
  }

  /**
   * Resolver conflictos (Pending=2)
   */
  private async resolveConflicts(): Promise<void> {
    const conflicts = await this.getConflictedItems();
    if (conflicts.length === 0) return;

    for (const conflict of conflicts) {
      try {
        const resolved = this.conflictResolver.resolve(conflict.local, conflict.remote);

        if (resolved.value === undefined) resolved.value = conflict.local.value || conflict.remote.value || '';
        if (resolved.type === undefined) resolved.type = conflict.local.type || conflict.remote.type || 'text';
        if (resolved.deviceId === undefined) resolved.deviceId = conflict.local.deviceId || conflict.remote.deviceId;

        await this.saveResolvedItem(resolved);
      } catch (error: any) {
        console.error('[SyncEngine] Failed to resolve conflict:', error);
        this.stats.errors++;
      }
    }
  }

  private async applyRemoteChange(remoteItem: any): Promise<void> {
    let value = remoteItem.value;

    // Imágenes remotas (Base64 → archivo local)
    if (remoteItem.type === 'image' && typeof value === 'string' && value.startsWith('data:image')) {
        try {
            const matches = value.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const ext = matches[1];
                const base64Data = matches[2];
                const buffer = Buffer.from(base64Data, 'base64');
                
                const userDataPath = app.getPath('userData');
                const imagesDir = path.join(userDataPath, 'synced_images');
                
                if (!fs.existsSync(imagesDir)) {
                    fs.mkdirSync(imagesDir, { recursive: true });
                }
                
                const filename = `${remoteItem.id}.${ext}`;
                const localPath = path.join(imagesDir, filename);
                
                await fs.promises.writeFile(localPath, buffer);
                value = `[LOCAL_IMAGE]:${localPath}`;
            }
        } catch (err: any) {
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
    } else {
      const localTime = new Date(localItem.updatedAt).getTime();
      const remoteTime = new Date(mappedItem.updatedAt).getTime();

      if (remoteTime > localTime) {
        await this.updateLocalItem(mappedItem);
        db.markItemAsSynced(mappedItem.id);
      } else if (remoteTime < localTime && localItem.pending === 1) {
        await this.markAsConflicted(localItem, mappedItem);
      }
    }
  }

  // --- Error classification ---

  private isPermanentError(error: any): boolean {
    const status = error?.status || error?.response?.status;
    // 4xx errors (except 401 which is handled by interceptor, and 429 rate limit)
    return status >= 400 && status < 500 && status !== 401 && status !== 429;
  }

  private createSyncError(response: any): Error & { status?: number } {
    const err: any = new Error(response.error || `Request failed with status ${response.status}`);
    err.status = response.status;
    return err;
  }

  // --- Helpers ---

  private extractItemsFromResponse(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (data.data && data.data.items && Array.isArray(data.data.items)) return data.data.items;
    if (data.items && Array.isArray(data.items)) return data.items;
    if (data.data && Array.isArray(data.data)) return data.data;
    return [];
  }

  private setupNetworkMonitoring() {
    this.networkMonitor.onStatusChange((online) => {
      if (online) {
        this.performSync().catch(console.error);
      }
      this.broadcastNetworkStatus(online);
    });
  }

  private broadcastStats() {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('sync:stats', this.stats);
    });
  }

  private broadcastNetworkStatus(online: boolean) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('sync:network-status', { online });
    });
  }

  private async getItemFromDb(itemId: string): Promise<any> {
    return db.getItem(itemId);
  }

  private async updateLocalItem(item: any): Promise<void> {
    db.updateItem(item);
  }

  private async markAsConflicted(localItem: any, remoteItem: any): Promise<void> {
    db.markAsConflicted(localItem.id, remoteItem);
  }

  private async getConflictedItems(): Promise<any[]> {
    return db.getConflictedItems();
  }

  private async saveResolvedItem(item: any): Promise<void> {
    db.updateItem(item);
    db.clearConflict(item.id);
    // El ganador del conflicto debe subirse al backend en el próximo PUSH
    db.markItemForSync(item.id);
  }

  public destroy() {
    this.stopScheduler();
    this.networkMonitor.destroy();
  }
}
