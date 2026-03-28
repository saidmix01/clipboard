"use strict";
/**
 * NetworkMonitor - Monitoreo de conectividad de red
 *
 * Responsabilidades:
 * - Detectar estado online/offline
 * - Notificar cambios de conectividad
 * - Verificar conectividad periódicamente
 * - No bloquear el hilo principal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkMonitor = void 0;
const electron_1 = require("electron");
class NetworkMonitor {
    constructor() {
        this.isOnlineState = true;
        this.listeners = [];
        this.checkInterval = null;
        this.CHECK_INTERVAL_MS = 30000; // 30 segundos
        this.TIMEOUT_MS = 5000; // 5 segundos
        this.startMonitoring();
    }
    /**
     * Inicia el monitoreo periódico de red
     */
    startMonitoring() {
        console.log('[NetworkMonitor] Starting network monitoring');
        // Check inicial
        this.checkConnection();
        // Check periódico cada 30 segundos
        this.checkInterval = setInterval(() => {
            this.checkConnection();
        }, this.CHECK_INTERVAL_MS);
    }
    /**
     * Verifica la conectividad actual
     */
    async checkConnection() {
        try {
            const online = await this.isConnected();
            // Solo notificar si el estado cambió
            if (online !== this.isOnlineState) {
                console.log(`[NetworkMonitor] Network status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
                this.isOnlineState = online;
                this.notifyListeners(online);
            }
        }
        catch (error) {
            console.error('[NetworkMonitor] Connection check failed:', error);
            // En caso de error, asumir offline
            if (this.isOnlineState) {
                this.isOnlineState = false;
                this.notifyListeners(false);
            }
        }
    }
    /**
     * Verifica conectividad haciendo una petición HTTP
     */
    async isConnected() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, this.TIMEOUT_MS);
            try {
                // Intentar conectar a un servicio confiable
                const request = electron_1.net.request({
                    method: 'HEAD',
                    url: 'https://www.google.com',
                    redirect: 'manual'
                });
                request.on('response', (response) => {
                    clearTimeout(timeout);
                    // Cualquier respuesta (incluso error) indica conectividad
                    resolve(response.statusCode >= 200 && response.statusCode < 500);
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
            catch (error) {
                clearTimeout(timeout);
                resolve(false);
            }
        });
    }
    /**
     * Obtiene el estado actual de conectividad
     */
    isOnline() {
        return this.isOnlineState;
    }
    /**
     * Registra un listener para cambios de estado
     */
    onStatusChange(callback) {
        this.listeners.push(callback);
        // Retornar función para desregistrar
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }
    /**
     * Notifica a todos los listeners del cambio de estado
     */
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
    /**
     * Fuerza una verificación inmediata de conectividad
     */
    async checkNow() {
        const online = await this.isConnected();
        if (online !== this.isOnlineState) {
            this.isOnlineState = online;
            this.notifyListeners(online);
        }
        return online;
    }
    /**
     * Limpia recursos al destruir
     */
    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.listeners = [];
        console.log('[NetworkMonitor] Destroyed');
    }
}
exports.NetworkMonitor = NetworkMonitor;
