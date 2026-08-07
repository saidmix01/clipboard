import { ipcMain, BrowserWindow } from 'electron';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { normalizeItemForIPC } from './ipc-utils';
import { RealtimeClient } from './RealtimeClient';

// Import existing DB module (JS)
const db = require('../db');

interface QueueItem {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  config: AxiosRequestConfig;
}

export class BackendDaemon {
  private static instance: BackendDaemon;
  private static ipcRegistered: boolean = false;  // Guard contra doble registro
  private client: AxiosInstance;
  private isRefreshing: boolean = false;
  private requestQueue: QueueItem[] = [];
  private baseUrl: string = 'https://backend-copyfy.onrender.com';

  private constructor() {
    try {
        const config = require('../config');
        if (config.BACKEND_URL) this.baseUrl = config.BACKEND_URL;
    } catch (e) {}

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });

    this.setupInterceptors();
    this.setupIPC();
  }

  public static getInstance(): BackendDaemon {
    if (!BackendDaemon.instance) {
      BackendDaemon.instance = new BackendDaemon();
      BackendDaemon.instance.initActiveDevice();
      BackendDaemon.instance.connectRealtimeIfAuthenticated();
    }
    return BackendDaemon.instance;
  }

  private initActiveDevice() {
    const settings = db.getSettings();
    const devices = db.getDevices();
    
    if (!settings.selectedDeviceId) {
        if (devices.length === 1) {
            this.setActiveDevice(devices[0].Id);
        } else if (devices.length === 0) {
            const localId = db.ensureLocalDevice();
            if (localId) this.setActiveDevice(localId);
        }
    }
  }

  /**
   * Connect to Supabase Realtime if we have an access token.
   * Extracts userId from the JWT payload to subscribe to the user's channel.
   */
  private connectRealtimeIfAuthenticated(): void {
    try {
      const settings = db.getSettings();
      if (!settings.accessToken) return;

      const userId = this.extractUserIdFromToken(settings.accessToken);
      if (userId) {
        RealtimeClient.getInstance().connect(userId);
      }
    } catch (err: any) {
      console.warn('[BackendDaemon] Failed to connect realtime on startup:', err.message);
    }
  }

  /**
   * Extract userId from a JWT access token (decode payload without verification).
   */
  private extractUserIdFromToken(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.id || payload.userId || payload.sub || null;
    } catch {
      return null;
    }
  }

  public getActiveDevice() {
      const settings = db.getSettings();
      if (!settings.selectedDeviceId) return null;
      
      const devices = db.getDevices();
      const found = devices.find((d: any) => d.Id === settings.selectedDeviceId);
      
      if (found) return found;

      // --- Recovery: selectedDeviceId points to a nonexistent device ---
      // This can happen when device IDs change during sync or re-login.
      // Auto-recover by selecting the localDeviceId or the first available device.
      console.warn(`[BackendDaemon] selectedDeviceId "${settings.selectedDeviceId}" not found in Devices table. Auto-recovering...`);
      
      // 1. Try localDeviceId first (this machine's device)
      if (settings.localDeviceId) {
          const localDevice = devices.find((d: any) => d.Id === settings.localDeviceId);
          if (localDevice) {
              console.info(`[BackendDaemon] Recovered: setting active device to localDeviceId "${settings.localDeviceId}"`);
              db.setActiveDevice(settings.localDeviceId);
              return localDevice;
          }
      }

      // 2. Fallback: pick the most recently updated device
      if (devices.length > 0) {
          const fallback = devices[0]; // Already sorted by UpdatedAt DESC in getDevices()
          console.info(`[BackendDaemon] Recovered: setting active device to first available "${fallback.Id}" (${fallback.Name})`);
          db.setActiveDevice(fallback.Id);
          return fallback;
      }

      // 3. Last resort: ensure a local device exists and use it
      const localId = db.ensureLocalDevice();
      if (localId && localId !== 'unknown') {
          const newDevices = db.getDevices();
          const newLocal = newDevices.find((d: any) => d.Id === localId);
          if (newLocal) {
              console.info(`[BackendDaemon] Recovered: created/found local device "${localId}"`);
              db.setActiveDevice(localId);
              return newLocal;
          }
      }

      return null;
  }

  public setActiveDevice(deviceId: string) {
       const success = db.setActiveDevice(deviceId);
       if (success) {
           const device = this.getActiveDevice();
           this.broadcast('device:changed', device);
           const items = this.getItemsByActiveDevice();
           const normalized = items.map(normalizeItemForIPC);
           this.broadcast('clipboard:updated', normalized);
           this.broadcast('clipboard-update', normalized);

           // Trigger sync — si ya hay uno corriendo, syncNow() retorna inmediatamente
           // y aun así emitimos device:sync-completed para no bloquear la UI
           try {
               const { SyncEngine } = require('./SyncEngine');
               const engine = SyncEngine.getInstance();
               
               // Si ya hay un sync corriendo, no esperar — notificar completed directamente
               if (engine.getStats().isRunning) {
                   this.broadcast('device:sync-completed', device);
               } else {
                   engine.syncNow()
                     .catch((err: any) => console.error('[BackendDaemon] Sync on device change failed:', err))
                     .finally(() => {
                         this.broadcast('device:sync-completed', device);
                     });
               }
           } catch (e) {
               console.error('[BackendDaemon] Failed to trigger sync on device change:', e);
               this.broadcast('device:sync-completed', device);
           }
       }
       return success;
   }

  public getItemsByActiveDevice(limit = 20, offset = 0, filter: any = {}) {
      const activeDevice = this.getActiveDevice();
      if (!activeDevice) {
          // No active device found even after recovery — show all items as fallback
          // rather than showing nothing to the user
          console.warn('[BackendDaemon] No active device found. Returning all items as fallback.');
          return db.getItems(limit, offset, filter);
      }
      
      return db.getItems(limit, offset, { ...filter, deviceId: activeDevice.Id });
  }

  public saveClipboardItem(value: string, type: 'text' | 'image') {
      let activeDevice = this.getActiveDevice();
      if (!activeDevice) {
          // Last resort: try to use ensureLocalDevice to guarantee items are saved
          console.warn('[BackendDaemon] No active device selected. Attempting ensureLocalDevice fallback...');
          const localId = db.ensureLocalDevice();
          if (localId && localId !== 'unknown') {
              db.setActiveDevice(localId);
              activeDevice = this.getActiveDevice();
          }
          if (!activeDevice) {
              console.error('[BackendDaemon] Cannot save item: no device available even after recovery.');
              return null;
          }
      }

      const result = db.insertItem(value, type, activeDevice.Id);
      if (result) {
          // Broadcast con datos normalizados para que el renderer reciba el shape correcto
          const items = this.getItemsByActiveDevice();
          const normalized = items.map(normalizeItemForIPC);
          this.broadcast('clipboard:updated', normalized);
          this.broadcast('clipboard-update', normalized);
      }
      return result;
  }

  public notifyClipboardUpdate() {
      const items = this.getItemsByActiveDevice();
      const normalized = items.map(normalizeItemForIPC);
      this.broadcast('clipboard:updated', normalized);
      this.broadcast('clipboard-update', normalized);
  }

  private broadcast(channel: string, data?: any) {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(w => w.webContents.send(channel, data));
  }

  public async request(config: AxiosRequestConfig): Promise<any> {
    try {
      const response = await this.client.request(config);
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error: any) {
      console.error(`[BackendDaemon] Request failed: ${config.method?.toUpperCase()} ${config.url}`, error.message);
      if (error.response) {
          console.error('[BackendDaemon] Error Status:', error.response.status);
      }
      return {
        success: false,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      };
    }
  }

  private setupInterceptors() {
    this.client.interceptors.request.use(
      (config) => {
        const settings = db.getSettings();
        if (settings.accessToken) {
          config.headers.Authorization = `Bearer ${settings.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
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
          } catch (refreshError) {
            this.processQueue(refreshError);
            // Clear session on fatal refresh error
            db.updateSettings({ AccessToken: null, RefreshToken: null });
            return Promise.reject(refreshError);
          } finally {
            this.isRefreshing = false;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async performRefreshToken(): Promise<string> {
    const settings = db.getSettings();
    if (!settings.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/auth/refresh`, {
        refreshToken: settings.refreshToken,
      });

      if (response.data && response.data.success && response.data.data) {
          const { token, refreshToken } = response.data.data;
          
          db.updateSettings({
            AccessToken: token,
            RefreshToken: refreshToken || settings.refreshToken
          });

          return token;
      } else {
          throw new Error('Invalid refresh token response format');
      }
    } catch (error) {
      console.error('[BackendDaemon] Refresh failed:', error);
      throw error;
    }
  }

  private processQueue(error: any) {
    this.requestQueue.forEach((prom) => {
      if (error) {
        prom.reject(error);
      } else {
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
  public async syncDevicesOnLogin(silent: boolean = false) {
    const windows = BrowserWindow.getAllWindows();
    const sendToRenderer = (channel: string, data?: any) => {
        windows.forEach(w => {
            if (!w.isDestroyed()) w.webContents.send(channel, data);
        });
    };

    if (!silent) sendToRenderer('devices:sync-start');

    try {
        // 1. Create local devices on backend
        const devices = db.getDevices();

        for (const device of devices) {
            // Check if synced. Assuming db.js returns 'Synced' as 0 or 1 (integer)
            if (!device.Synced) {
                await this.createRemoteDevice(device);
            }
        }

        // 2. Fetch remote devices
        await this.fetchRemoteDevices();

        // 3. Notify
        const allDevices = db.getDevices();
        if (!silent) {
            sendToRenderer('devices:sync-complete', allDevices);
        }
    } catch (error: any) {
        console.error('[BackendDaemon] Sync failed:', error);
        // We do not block the UI, but we can notify if needed.
        // For now, we just log it. The prompt says "Maneja errores y reintentos" (Handle errors and retries).
        // Since we are running in background, we might want to retry later?
        // For now, simple error logging.
    }
  }

  private async createRemoteDevice(localDevice: any) {
      try {
          const payload = {
              id: localDevice.Id,
              clientId: localDevice.Id,
              name: localDevice.Name,
              metadata: {
                  os: localDevice.OsName,
                  appversion: localDevice.VersionApp
              }
          };

          await this.client.post('/devices', payload);
          db.markDeviceSynced(localDevice.Id);
      } catch (e: any) {
          console.error(`[BackendDaemon] Failed to create remote device ${localDevice.Id}:`, e.message);
      }
  }

  private async fetchRemoteDevices() {
      try {
          const res = await this.client.get('/devices');
          
          let remoteDevices = res.data;
          
          // Handle potential API wrapper { success: true, data: { items: [...] } } or { success: true, data: [...] }
          if (!Array.isArray(remoteDevices)) {
              if (remoteDevices?.data && Array.isArray(remoteDevices.data)) {
                  // Case: { data: [...] }
                  remoteDevices = remoteDevices.data;
              } else if (remoteDevices?.data?.items && Array.isArray(remoteDevices.data.items)) {
                  // Case: { data: { items: [...] } }
                  remoteDevices = remoteDevices.data.items;
              } else if (remoteDevices?.items && Array.isArray(remoteDevices.items)) {
                  // Case: { items: [...] }
                  remoteDevices = remoteDevices.items;
              }
          }
          
          if (Array.isArray(remoteDevices)) {
              for (const rd of remoteDevices) {
                  const deviceInfo = {
                      Id: rd.id,
                      Name: rd.name,
                      OsName: rd.metadata?.os || 'unknown',
                      VersionApp: rd.metadata?.appversion || '0.0.0'
                  };
                  
                  db.registerDevice(deviceInfo);
                  db.markDeviceSynced(deviceInfo.Id);
              }
          }
      } catch (e: any) {
          console.error('[BackendDaemon] Failed to fetch remote devices:', e.message);
      }
  }

  private setupIPC() {
    if (BackendDaemon.ipcRegistered) {
      console.warn('[BackendDaemon] IPC handlers already registered, skipping');
      return;
    }
    BackendDaemon.ipcRegistered = true;

    // Trigger sync on login success
    ipcMain.on('auth:login-success', () => {
        this.syncDevicesOnLogin();
        // Connect to realtime after successful login
        this.connectRealtimeIfAuthenticated();
    });

    // Generic proxy for authenticated requests
    ipcMain.handle('backend-request', async (_, config: AxiosRequestConfig) => {
      try {
        const response = await this.client.request(config);
        return {
          success: true,
          data: response.data,
          status: response.status
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          status: error.response?.status,
          data: error.response?.data
        };
      }
    });

    // Specific Auth methods
    ipcMain.handle('auth-get-valid-token', async () => {
        const s = db.getSettings();
        return s.accessToken;
    });

    ipcMain.handle('auth-force-refresh', async () => {
        return this.performRefreshToken();
    });

    // --- Active Device Logic ---
    ipcMain.handle('devices:get-active', () => {
        return this.getActiveDevice();
    });

    ipcMain.handle('devices:set-active', (_, deviceId) => {
        return this.setActiveDevice(deviceId);
    });

    ipcMain.handle('clipboard:get-items', (_, { limit = 20, offset = 0, filter = {} } = {}) => {
        const items = this.getItemsByActiveDevice(limit, offset, filter);
        return items.map(normalizeItemForIPC);
    });
    
    // --- Sync Engine APIs ---
    const { SyncEngine } = require('./SyncEngine');
    
    ipcMain.handle('sync:now', async () => {
        const syncEngine = SyncEngine.getInstance();
        return syncEngine.syncNow();
    });
    
    ipcMain.handle('sync:get-stats', () => {
        const syncEngine = SyncEngine.getInstance();
        return syncEngine.getStats();
    });
  }
}
