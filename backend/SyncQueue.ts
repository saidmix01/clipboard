/**
 * SyncQueue - Cola persistente de operaciones de sincronización
 * 
 * Responsabilidades:
 * - Gestionar cola de operaciones pendientes
 * - Implementar retry con backoff exponencial
 * - Persistir cola en DB para sobrevivir reinicios
 * - Prevenir duplicación de operaciones
 */

const db = require('../db');

export interface SyncOperation {
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  itemId: string;
  item: any;
  timestamp: number;
  retries: number;
  nextRetryAt?: number;
}

export class SyncQueue {
  private inMemoryQueue: SyncOperation[] = [];
  private processing: boolean = false;

  constructor() {
    this.loadQueueFromDb();
  }

  /**
   * Carga la cola desde la base de datos al iniciar
   */
  private loadQueueFromDb() {
    try {
      const pendingOps = db.getPendingSyncOperations();
      this.inMemoryQueue = pendingOps;
      console.log(`[SyncQueue] Loaded ${pendingOps.length} pending operations from DB`);
    } catch (error) {
      console.error('[SyncQueue] Failed to load queue from DB:', error);
      this.inMemoryQueue = [];
    }
  }

  /**
   * Encola una nueva operación
   */
  public async enqueue(operation: SyncOperation): Promise<void> {
    // Verificar si ya existe una operación para este item
    const existingIndex = this.inMemoryQueue.findIndex(
      op => op.itemId === operation.itemId
    );

    if (existingIndex !== -1) {
      // Actualizar operación existente
      this.inMemoryQueue[existingIndex] = operation;
      console.log(`[SyncQueue] Updated existing operation for item ${operation.itemId}`);
    } else {
      // Agregar nueva operación
      this.inMemoryQueue.push(operation);
      console.log(`[SyncQueue] Enqueued new operation for item ${operation.itemId}`);
    }

    // Persistir en DB
    await this.persistQueueToDb();
  }

  /**
   * Desencola la siguiente operación lista para procesar
   */
  public async dequeue(): Promise<SyncOperation | null> {
    const now = Date.now();

    // Buscar la primera operación que esté lista (sin nextRetryAt o ya pasó el tiempo)
    const index = this.inMemoryQueue.findIndex(op => {
      return !op.nextRetryAt || op.nextRetryAt <= now;
    });

    if (index === -1) {
      return null;
    }

    // Remover de la cola
    const operation = this.inMemoryQueue.splice(index, 1)[0];
    
    // Persistir cambio en DB
    await this.persistQueueToDb();

    return operation;
  }

  /**
   * Programa un reintento con backoff exponencial
   */
  public async scheduleRetry(operation: SyncOperation): Promise<void> {
    operation.retries++;
    
    // Backoff exponencial: 2^retries segundos, máximo 60 segundos
    const delaySeconds = Math.min(Math.pow(2, operation.retries), 60);
    const delayMs = delaySeconds * 1000;
    
    operation.nextRetryAt = Date.now() + delayMs;

    console.log(
      `[SyncQueue] Scheduling retry #${operation.retries} for item ${operation.itemId} in ${delaySeconds}s`
    );

    // Re-encolar con el nuevo tiempo de reintento
    await this.enqueue(operation);
  }

  /**
   * Verifica si hay operaciones en la cola
   */
  public hasItems(): boolean {
    const now = Date.now();
    return this.inMemoryQueue.some(op => !op.nextRetryAt || op.nextRetryAt <= now);
  }

  /**
   * Obtiene el número de operaciones pendientes
   */
  public getPendingCount(): number {
    return this.inMemoryQueue.length;
  }

  /**
   * Obtiene todas las operaciones (para debugging)
   */
  public getAllOperations(): SyncOperation[] {
    return [...this.inMemoryQueue];
  }

  /**
   * Limpia operaciones antiguas (más de 7 días)
   */
  public async cleanupOldOperations(): Promise<void> {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    const before = this.inMemoryQueue.length;
    this.inMemoryQueue = this.inMemoryQueue.filter(op => op.timestamp > sevenDaysAgo);
    const after = this.inMemoryQueue.length;

    if (before !== after) {
      console.log(`[SyncQueue] Cleaned up ${before - after} old operations`);
      await this.persistQueueToDb();
    }
  }

  /**
   * Persiste la cola en la base de datos
   */
  private async persistQueueToDb(): Promise<void> {
    try {
      db.saveSyncQueue(this.inMemoryQueue);
    } catch (error) {
      console.error('[SyncQueue] Failed to persist queue to DB:', error);
    }
  }

  /**
   * Limpia toda la cola (usar con precaución)
   */
  public async clear(): Promise<void> {
    this.inMemoryQueue = [];
    await this.persistQueueToDb();
    console.log('[SyncQueue] Queue cleared');
  }
}
