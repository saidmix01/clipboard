/**
 * NetworkMonitor - Monitoreo de conectividad contra el backend real.
 * Usa frecuencia adaptativa: más frecuente si estaba offline, menos si todo está OK.
 */

import { net } from 'electron';

const INTERVAL_ONLINE_MS = 60000;   // 60s cuando estamos online (no hay urgencia)
const INTERVAL_OFFLINE_MS = 15000;  // 15s cuando estamos offline (detectar reconexión rápido)
const TIMEOUT_MS = 5000;

export class NetworkMonitor {
  private isOnlineState: boolean = true;
  private listeners: Array<(online: boolean) => void> = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private backendUrl: string;

  constructor() {
    // Usar la URL del backend real para verificar conectividad
    try {
      const config = require('../config');
      this.backendUrl = config.BACKEND_URL || 'https://backend-copyfy.onrender.com';
    } catch {
      this.backendUrl = 'https://backend-copyfy.onrender.com';
    }

    this.startMonitoring();
  }

  private startMonitoring() {
    this.checkConnection();
    this.scheduleNext();
  }

  private scheduleNext() {
    if (this.checkInterval) {
      clearTimeout(this.checkInterval);
    }
    const interval = this.isOnlineState ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS;
    this.checkInterval = setTimeout(() => {
      this.checkConnection();
      this.scheduleNext();
    }, interval);
  }

  private async checkConnection() {
    try {
      const online = await this.isConnected();
      
      if (online !== this.isOnlineState) {
        console.log(`[NetworkMonitor] Status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
        this.isOnlineState = online;
        this.notifyListeners(online);
      }
    } catch {
      if (this.isOnlineState) {
        this.isOnlineState = false;
        this.notifyListeners(false);
      }
    }
  }

  private async isConnected(): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, TIMEOUT_MS);

      try {
        const request = net.request({
          method: 'HEAD',
          url: this.backendUrl,
          redirect: 'manual'
        });

        request.on('response', (response) => {
          clearTimeout(timeout);
          // Cualquier respuesta del backend indica conectividad
          resolve(response.statusCode < 500);
        });

        request.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        request.on('abort', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        request.end();
      } catch {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  public isOnline(): boolean {
    return this.isOnlineState;
  }

  public onStatusChange(callback: (online: boolean) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private notifyListeners(online: boolean) {
    this.listeners.forEach(listener => {
      try {
        listener(online);
      } catch (error) {
        console.error('[NetworkMonitor] Listener error:', error);
      }
    });
  }

  public async checkNow(): Promise<boolean> {
    const online = await this.isConnected();
    
    if (online !== this.isOnlineState) {
      this.isOnlineState = online;
      this.notifyListeners(online);
    }
    
    return online;
  }

  public destroy() {
    if (this.checkInterval) {
      clearTimeout(this.checkInterval);
      this.checkInterval = null;
    }
    this.listeners = [];
  }
}
