/**
 * ConflictResolver - Resolución de conflictos de sincronización
 * 
 * Estrategia: Last-Write-Wins (LWW) basado en timestamp
 * 
 * Responsabilidades:
 * - Detectar conflictos entre versiones local y remota
 * - Resolver conflictos usando estrategia LWW
 * - Incrementar versión del item resuelto
 * - Loguear conflictos para análisis
 */

export interface ConflictedItem {
  local: any;
  remote: any;
}

export class ConflictResolver {
  
  /**
   * Detecta si hay conflicto entre dos versiones de un item
   */
  public detectConflict(local: any, remote: any): boolean {
    // Conflicto si:
    // 1. Ambos tienen la misma versión pero diferentes valores
    // 2. Ambos fueron modificados después del último sync
    
    if (!local || !remote) {
      return false;
    }

    const sameVersion = (local.version || 1) === (remote.version || 1);
    const differentValues = local.value !== remote.value;
    
    return sameVersion && differentValues;
  }

  /**
   * Resuelve un conflicto usando estrategia Last-Write-Wins
   */
  public resolve(local: any, remote: any): any {
    console.log(`[ConflictResolver] Resolving conflict for item ${local.id}`);

    // Comparar timestamps de actualización
    const localTime = new Date(local.updatedAt || local.createdAt).getTime();
    const remoteTime = new Date(remote.updatedAt || remote.createdAt).getTime();

    let winner: any;
    let loser: any;

    if (localTime > remoteTime) {
      winner = local;
      loser = remote;
      console.log(`[ConflictResolver] Local version wins (${localTime} > ${remoteTime})`);
    } else if (remoteTime > localTime) {
      winner = remote;
      loser = local;
      console.log(`[ConflictResolver] Remote version wins (${remoteTime} > ${localTime})`);
    } else {
      // Mismo timestamp - usar deviceId como desempate
      if (local.deviceId < remote.deviceId) {
        winner = local;
        loser = remote;
      } else {
        winner = remote;
        loser = local;
      }
      console.log(`[ConflictResolver] Tie-break by deviceId`);
    }

    // Incrementar versión del ganador
    const resolved = {
      ...winner,
      version: Math.max(local.version || 1, remote.version || 1) + 1,
      updatedAt: new Date().toISOString(),
      conflictResolvedAt: new Date().toISOString()
    };

    // Loguear conflicto para análisis
    this.logConflict(local, remote, resolved);

    return resolved;
  }

  /**
   * Estrategia alternativa: Merge de valores (para casos específicos)
   */
  public mergeValues(local: any, remote: any): any {
    // Esta estrategia podría usarse para tipos específicos de datos
    // Por ejemplo, merge de tags, favoritos, etc.
    
    return {
      ...local,
      favorite: local.favorite || remote.favorite, // OR lógico para favoritos
      version: Math.max(local.version || 1, remote.version || 1) + 1,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Loguea conflictos para análisis posterior
   */
  private logConflict(local: any, remote: any, resolved: any): void {
    const conflictLog = {
      timestamp: new Date().toISOString(),
      itemId: local.id,
      localVersion: local.version,
      remoteVersion: remote.version,
      localUpdatedAt: local.updatedAt,
      remoteUpdatedAt: remote.updatedAt,
      resolvedVersion: resolved.version,
      strategy: 'last-write-wins'
    };

    console.log('[ConflictResolver] Conflict resolved:', JSON.stringify(conflictLog));
    
    // Opcionalmente, persistir en DB para análisis
    // db.logConflict(conflictLog);
  }

  /**
   * Valida que un item resuelto sea consistente
   */
  public validateResolved(item: any): boolean {
    if (!item) return false;
    if (!item.id) return false;
    if (!item.version || item.version < 1) return false;
    if (!item.updatedAt) return false;
    
    return true;
  }
}
