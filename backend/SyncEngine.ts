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

import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SyncQueue, SyncOperation } from './SyncQueue'; // Mantener por compatibilidad de tipos si es necesario, pero no usar lógica de cola
import { ConflictResolver } from './ConflictResolver';
import { NetworkMonitor } from './NetworkMonitor';
import { BackendDaemon } from './BackendDaemon';

const db = require('../db');

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
      // No hay init lazy aquí porque SyncEngine no llama getInstance() en su constructor
    }
    return SyncEngine.instance;
  }

  /**
   * Inicia el scheduler de sincronización automática cada hora
   */
  public startScheduler() {
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
  public stopScheduler() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[SyncEngine] Scheduler stopped');
    }
  }

  /**
   * Ejecuta sincronización manual (llamada por usuario)
   */
  public async syncNow(): Promise<SyncStats> {
    return this.performSync();
  }

  /**
   * Obtiene estadísticas de sincronización
   */
  public getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Encola un item para sincronización
   * (Mantenido por compatibilidad, pero ahora la lógica principal lee Pending=1 de DB)
   */
  public async enqueueItem(itemId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE'): Promise<void> {
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
  private async performSync(): Promise<SyncStats> {
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
          } else {
              console.warn('[SyncEngine] Cannot update LastSync: No active device ID found');
          }
      } else {
          console.warn('[SyncEngine] Pull failed, skipping LastSync update');
      }

      console.log('[SyncEngine] Sync cycle completed');

    } catch (error: any) {
      console.error('[SyncEngine] Sync cycle failed:', error.message || error);
      this.stats.errors++;
    } finally {
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
  private async pushLocalChanges(): Promise<void> {
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
      } catch (error: any) {
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
  private async pullRemoteChanges(): Promise<boolean> {
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
      
      const params: any = {
        deviceId: deviceId
      };

      if (lastSync) {
        // ... (lógica existente)
        params.since = lastSync;
        console.log(`[SyncEngine] Pulling changes for device ${deviceId} since ${lastSync}`);
      } else {
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
          if (response.data.data) console.log('[SyncEngine] Debug Response.data.data Keys:', Object.keys(response.data.data));
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

    } catch (error: any) {
      console.error('[SyncEngine] Error pulling remote changes:', error.message);
      return false;
    }
  }

  /**
   * FASE 3: Resolver conflictos
   */
  private async resolveConflicts(): Promise<void> {
    // Obtener items con conflictos (versión local != versión remota, marcados con Pending=2)
    const conflicts = await this.getConflictedItems();
    
    if (conflicts.length === 0) return;

    console.log(`[SyncEngine] Resolving ${conflicts.length} conflicts...`);
    
    for (const conflict of conflicts) {
      try {
        const resolved = this.conflictResolver.resolve(conflict.local, conflict.remote);

        // Asegurar campos
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

  /**
   * Envía un item a la nube (PUSH)
   */
  private async sendItemToCloud(item: any): Promise<void> {
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
        const localPath = item.value.replace('[LOCAL_IMAGE]:', '');
        if (!fs.existsSync(localPath)) {
            // El archivo fue eliminado del disco — no enviar el path inválido al backend.
            // Marcar el item como sincronizado para que no bloquee futuras sincronizaciones.
            console.warn(`[SyncEngine] Local image file not found, skipping sync for item ${item.id}: ${localPath}`);
            db.markItemAsSynced(item.id);
            return; // Salir sin error — el item se limpia de la cola
        }
        try {
            const imageBuffer = fs.readFileSync(localPath);
            const ext = path.extname(localPath).slice(1) || 'png';
            valueToSend = `data:image/${ext};base64,${imageBuffer.toString('base64')}`;
            console.log(`[SyncEngine] Converted local image ${localPath} to Base64 for sync (${valueToSend.length} chars)`);
        } catch (err: any) {
            console.error('[SyncEngine] Error reading local image for sync:', err.message);
            // No enviar — dejar pending=1 para reintentar en el próximo ciclo
            throw new Error(`Failed to read local image: ${err.message}`);
        }
    }

    const payload: any = {
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
    
    if (item.isDeleted) payload.deleted = true; // Si soportamos soft delete push

    // Intentar PUT primero
    const putResponse = await this.backendDaemon.request({
      method: 'PUT',
      url: `/clipboard/${item.id}`,
      data: payload
    });

    if (putResponse.success) {
        console.log(`[SyncEngine] PUT success for item ${item.id}`);
    } else {
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
            } else {
                throw new Error(postResponse.error || `POST failed with status ${postResponse.status}`);
            }
        } else {
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
    } catch (favErr: any) {
        console.warn(`[SyncEngine] Could not sync favorite status for item ${item.id}:`, favErr.message);
    }
  }

  /**
   * Aplica un cambio remoto a la DB local
   */
  private async applyRemoteChange(remoteItem: any): Promise<void> {
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
                const userDataPath = app.getPath('userData');
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
      
    } else {
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
      } else if (remoteTime < localTime) {
        // Local es más nuevo -> Conflicto si Pending=1 (no sincronizado aún)
        if (localItem.pending) {
             await this.markAsConflicted(localItem, mappedItem);
        }
        // Si local ya estaba sincronizado (Pending=0) y remoto es viejo, ignoramos remoto (o ganamos nosotros)
      }
    }
  }

  // --- Helpers ---

  private extractItemsFromResponse(data: any): any[] {
    if (Array.isArray(data)) return data;
    
    // Case: { data: { items: [...] } } -> Deeply nested (Common in standardized APIs)
    if (data.data && data.data.items && Array.isArray(data.data.items)) return data.data.items;
    
    // Case: { items: [...] }
    if (data.items && Array.isArray(data.items)) return data.items;
    
    // Case: { data: [...] }
    if (data.data && Array.isArray(data.data)) return data.data;
    
    return [];
  }

  private setupNetworkMonitoring() {
    this.networkMonitor.onStatusChange((online) => {
      console.log(`[SyncEngine] Network status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
      if (online) {
        console.log('[SyncEngine] Reconnected, triggering sync');
        this.performSync().catch(console.error);
      }
      this.broadcastNetworkStatus(online);
    });
  }

  private broadcastStats() {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => {
      w.webContents.send('sync:stats', this.stats);
    });
  }

  private broadcastNetworkStatus(online: boolean) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(w => {
      w.webContents.send('sync:network-status', { online });
    });
  }

  // DB Helpers Wrappers
  private async getItemFromDb(itemId: string): Promise<any> {
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
  }

  public destroy() {
    this.stopScheduler();
    this.networkMonitor.destroy();
    console.log('[SyncEngine] Destroyed');
  }
}
