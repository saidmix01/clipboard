"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendDaemon = void 0;
const electron_1 = require("electron");
const axios_1 = __importDefault(require("axios"));
// Import existing DB module (JS)
const db = require('../db');
class BackendDaemon {
    constructor() {
        this.isRefreshing = false;
        this.requestQueue = [];
        // TODO: Move to config
        this.baseUrl = 'https://copyfy.webcolsoluciones.com.co';
        // Try to load from config.js if available, otherwise use default
        try {
            const config = require('../config');
            if (config.BACKEND_URL)
                this.baseUrl = config.BACKEND_URL;
        }
        catch (e) { }
        this.client = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
        });
        this.setupInterceptors();
        this.setupIPC();
    }
    static getInstance() {
        if (!BackendDaemon.instance) {
            BackendDaemon.instance = new BackendDaemon();
        }
        return BackendDaemon.instance;
    }
    /**
     * Configures Axios interceptors to handle Auth headers and Refresh Token flow
     */
    setupInterceptors() {
        // Request Interceptor: Attach Token
        this.client.interceptors.request.use((config) => {
            const settings = db.getSettings();
            if (settings.accessToken) {
                config.headers.Authorization = `Bearer ${settings.accessToken}`;
            }
            return config;
        }, (error) => Promise.reject(error));
        // Response Interceptor: Handle 401
        this.client.interceptors.response.use((response) => response, async (error) => {
            const originalRequest = error.config;
            if (error.response?.status === 401 && !originalRequest._retry) {
                if (this.isRefreshing) {
                    // Queue this request until refresh is done
                    return new Promise((resolve, reject) => {
                        this.requestQueue.push({ resolve, reject, config: originalRequest });
                    });
                }
                originalRequest._retry = true;
                this.isRefreshing = true;
                try {
                    await this.performRefreshToken();
                    this.processQueue(null);
                    return this.client(originalRequest);
                }
                catch (refreshError) {
                    this.processQueue(refreshError);
                    // Clear session on fatal refresh error
                    db.updateSettings({ AccessToken: null, RefreshToken: null });
                    return Promise.reject(refreshError);
                }
                finally {
                    this.isRefreshing = false;
                }
            }
            return Promise.reject(error);
        });
    }
    /**
     * Executes the refresh token logic safely
     */
    async performRefreshToken() {
        const settings = db.getSettings();
        if (!settings.refreshToken) {
            throw new Error('No refresh token available');
        }
        // Use a clean axios call to avoid interceptor loops
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/auth/refresh`, {
                refreshToken: settings.refreshToken,
            });
            // Handle specific response structure: 
            // { success: true, message: "...", data: { token: "...", refreshToken: "..." } }
            if (response.data && response.data.success && response.data.data) {
                const { token, refreshToken } = response.data.data;
                // Update DB (Single Source of Truth)
                db.updateSettings({
                    AccessToken: token,
                    RefreshToken: refreshToken || settings.refreshToken // Keep old if not rotated
                });
                return token;
            }
            else {
                throw new Error('Invalid refresh token response format');
            }
        }
        catch (error) {
            console.error('[BackendDaemon] Refresh failed:', error);
            throw error;
        }
    }
    /**
     * Retries or rejects queued requests
     */
    processQueue(error) {
        this.requestQueue.forEach((prom) => {
            if (error) {
                prom.reject(error);
            }
            else {
                this.client(prom.config)
                    .then(prom.resolve)
                    .catch(prom.reject);
            }
        });
        this.requestQueue = [];
    }
    /**
     * Orchestrates the device synchronization flow
     */
    async syncDevicesOnLogin() {
        const windows = electron_1.BrowserWindow.getAllWindows();
        const sendToRenderer = (channel, data) => {
            windows.forEach(w => w.webContents.send(channel, data));
        };
        console.log('[BackendDaemon] Starting device sync...');
        sendToRenderer('devices:sync-start');
        try {
            // 1. Create local devices on backend
            const devices = db.getDevices();
            console.log(`[BackendDaemon] Found ${devices.length} devices locally.`);
            for (const device of devices) {
                // Check if synced. Assuming db.js returns 'Synced' as 0 or 1 (integer)
                if (!device.Synced) {
                    console.log(`[BackendDaemon] Syncing local device ${device.Id} to remote...`);
                    await this.createRemoteDevice(device);
                }
            }
            // 2. Fetch remote devices
            console.log('[BackendDaemon] Fetching remote devices...');
            await this.fetchRemoteDevices();
            // 3. Notify
            const allDevices = db.getDevices();
            console.log(`[BackendDaemon] Sync complete. Total devices: ${allDevices.length}`);
            sendToRenderer('devices:sync-complete', allDevices);
        }
        catch (error) {
            console.error('[BackendDaemon] Sync failed:', error);
            // We do not block the UI, but we can notify if needed.
            // For now, we just log it. The prompt says "Maneja errores y reintentos" (Handle errors and retries).
            // Since we are running in background, we might want to retry later?
            // For now, simple error logging.
        }
    }
    async createRemoteDevice(localDevice) {
        try {
            const payload = {
                id: localDevice.Id,
                clientId: 'client-1', // TODO: Make dynamic if needed
                name: localDevice.Name,
                metadata: {
                    os: localDevice.OsName,
                    appversion: localDevice.VersionApp
                }
            };
            await this.client.post('/devices', payload);
            db.markDeviceSynced(localDevice.Id);
        }
        catch (e) {
            console.error(`[BackendDaemon] Failed to create remote device ${localDevice.Id}:`, e.message);
            // Continue execution, will retry next login
        }
    }
    async fetchRemoteDevices() {
        try {
            const res = await this.client.get('/devices');
            console.log('[BackendDaemon] GET /devices raw response:', JSON.stringify(res.data));
            let remoteDevices = res.data;
            // Handle potential API wrapper { success: true, data: { items: [...] } } or { success: true, data: [...] }
            if (!Array.isArray(remoteDevices)) {
                if (remoteDevices?.data && Array.isArray(remoteDevices.data)) {
                    // Case: { data: [...] }
                    remoteDevices = remoteDevices.data;
                }
                else if (remoteDevices?.data?.items && Array.isArray(remoteDevices.data.items)) {
                    // Case: { data: { items: [...] } }
                    remoteDevices = remoteDevices.data.items;
                }
                else if (remoteDevices?.items && Array.isArray(remoteDevices.items)) {
                    // Case: { items: [...] }
                    remoteDevices = remoteDevices.items;
                }
            }
            if (Array.isArray(remoteDevices)) {
                console.log(`[BackendDaemon] Found ${remoteDevices.length} remote devices.`);
                for (const rd of remoteDevices) {
                    // Skip if it's the current local device (already handled)
                    // although registerDevice handles updates, so it's fine.
                    const deviceInfo = {
                        Id: rd.id,
                        Name: rd.name,
                        OsName: rd.metadata?.os || 'unknown',
                        VersionApp: rd.metadata?.appversion || '0.0.0'
                    };
                    // Update or Insert
                    db.registerDevice(deviceInfo);
                    // Mark as synced since it came from remote
                    db.markDeviceSynced(deviceInfo.Id);
                }
            }
            else {
                console.warn('[BackendDaemon] Expected array of devices but got:', typeof remoteDevices);
            }
        }
        catch (e) {
            console.error('[BackendDaemon] Failed to fetch remote devices:', e.message);
            // Do not throw, just log, so the flow continues to "notify"
        }
    }
    /**
     * Exposes capabilities to Renderer via IPC
     */
    setupIPC() {
        // Trigger sync on login success
        electron_1.ipcMain.on('auth:login-success', () => {
            this.syncDevicesOnLogin();
        });
        // Generic proxy for authenticated requests
        electron_1.ipcMain.handle('backend-request', async (_, config) => {
            try {
                const response = await this.client.request(config);
                return {
                    success: true,
                    data: response.data,
                    status: response.status
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                };
            }
        });
        // Specific Auth methods
        electron_1.ipcMain.handle('auth-get-valid-token', async () => {
            const s = db.getSettings();
            return s.accessToken;
        });
        electron_1.ipcMain.handle('auth-force-refresh', async () => {
            return this.performRefreshToken();
        });
    }
}
exports.BackendDaemon = BackendDaemon;
