"use strict";
/**
 * NetworkMonitor - Monitoreo de conectividad contra el backend real.
 * Usa frecuencia adaptativa: más frecuente si estaba offline, menos si todo está OK.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkMonitor = void 0;
const electron_1 = require("electron");
const INTERVAL_ONLINE_MS = 60000; // 60s cuando estamos online (no hay urgencia)
const INTERVAL_OFFLINE_MS = 15000; // 15s cuando estamos offline (detectar reconexión rápido)
const TIMEOUT_MS = 5000;
class NetworkMonitor {
    constructor() {
        this.isOnlineState = true;
        this.listeners = [];
        this.checkInterval = null;
        // Usar la URL del backend real para verificar conectividad
        try {
            const config = require('../config');
            this.backendUrl = config.BACKEND_URL || 'https://backend-copyfy.onrender.com';
        }
        catch {
            this.backendUrl = 'https://backend-copyfy.onrender.com';
        }
        this.startMonitoring();
    }
    startMonitoring() {
        this.checkConnection();
        this.scheduleNext();
    }
    scheduleNext() {
        if (this.checkInterval) {
            clearTimeout(this.checkInterval);
        }
        const interval = this.isOnlineState ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS;
        this.checkInterval = setTimeout(() => {
            this.checkConnection();
            this.scheduleNext();
        }, interval);
    }
    async checkConnection() {
        try {
            const online = await this.isConnected();
            if (online !== this.isOnlineState) {
                console.log(`[NetworkMonitor] Status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
                this.isOnlineState = online;
                this.notifyListeners(online);
            }
        }
        catch {
            if (this.isOnlineState) {
                this.isOnlineState = false;
                this.notifyListeners(false);
            }
        }
    }
    async isConnected() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, TIMEOUT_MS);
            try {
                const request = electron_1.net.request({
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
            }
            catch {
                clearTimeout(timeout);
                resolve(false);
            }
        });
    }
    isOnline() {
        return this.isOnlineState;
    }
    onStatusChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }
    notifyListeners(online) {
        this.listeners.forEach(listener => {
            try {
                listener(online);
            }
            catch (error) {
                console.error('[NetworkMonitor] Listener error:', error);
            }
        });
    }
    async checkNow() {
        const online = await this.isConnected();
        if (online !== this.isOnlineState) {
            this.isOnlineState = online;
            this.notifyListeners(online);
        }
        return online;
    }
    destroy() {
        if (this.checkInterval) {
            clearTimeout(this.checkInterval);
            this.checkInterval = null;
        }
        this.listeners = [];
    }
}
exports.NetworkMonitor = NetworkMonitor;
