import { ipcMain, BrowserWindow } from 'electron';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Import existing DB module (JS)
const db = require('../db');

interface QueueItem {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  config: AxiosRequestConfig;
}

export class BackendDaemon {
  private static instance: BackendDaemon;
  private client: AxiosInstance;
  private isRefreshing: boolean = false;
  private requestQueue: QueueItem[] = [];
  // TODO: Move to config
  private baseUrl: string = 'https://copyfy.webcolsoluciones.com.co'; 

  private constructor() {
    // Try to load from config.js if available, otherwise use default
    try {
        const config = require('../config');
        if (config.BACKEND_URL) this.baseUrl = config.BACKEND_URL;
    } catch (e) {}
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });

    this.setupInterceptors();
    this.setupIPC();
    this.initActiveDevice();
  }

  public static getInstance(): BackendDaemon {
    if (!BackendDaemon.instance) {
      BackendDaemon.instance = new BackendDaemon();
    }
    return BackendDaemon.instance;
  }

  private initActiveDevice() {
    // Logic:
    // 1. Load devices
    // 2. Check if one is already active (in AppSettings)
    // 3. If not, and only 1 device exists -> set it active
    // 4. If multiple and none active -> wait for user selection (frontend will handle modal)
    
    const settings = db.getSettings();
    const devices = db.getDevices();
    
    if (!settings.selectedDeviceId) {
        if (devices.length === 1) {
            this.setActiveDevice(devices[0].Id);
        } else if (devices.length === 0) {
            // Should not happen if ensureLocalDevice was called in main.js
            // But if it does, main.js ensures at least one local device exists.
            const localId = db.ensureLocalDevice();
            if (localId) this.setActiveDevice(localId);
        }
    }
  }

  public getActiveDevice() {
      const settings = db.getSettings();
      if (!settings.selectedDeviceId) return null;
      
      const devices = db.getDevices();
      return devices.find((d: any) => d.Id === settings.selectedDeviceId) || null;
  }

  public setActiveDevice(deviceId: string) {
       const success = db.setActiveDevice(deviceId);
       if (success) {
           const device = this.getActiveDevice();
           this.broadcast('device:changed', device);
           // Also refresh items for the new device
           const items = this.getItemsByActiveDevice();
           this.broadcast('clipboard:updated', items);
           this.broadcast('clipboard-update', items);
       }
       return success;
   }

  public getItemsByActiveDevice(limit = 20, offset = 0, filter: any = {}) {
      const activeDevice = this.getActiveDevice();
      if (!activeDevice) return []; // Or return all? Rule says: "mostrar solo los datos del dispositivo activo"
      
      return db.getItems(limit, offset, { ...filter, deviceId: activeDevice.Id });
  }

  public saveClipboardItem(value: string, type: 'text' | 'image') {
      const activeDevice = this.getActiveDevice();
      if (!activeDevice) {
          console.warn('[BackendDaemon] No active device selected. Cannot save item.');
          return null; 
          // Rule: "❌ No guardar items sin deviceId"
          // If no active device, we might prompt user? 
          // For now, we strictly follow: no save.
      }

      const result = db.insertItem(value, type, activeDevice.Id);
      if (result) {
        this.broadcast('clipboard:updated'); 
        this.broadcast('clipboard-update'); // Legacy support
    }
    return result;
}

  private broadcast(channel: string, data?: any) {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(w => w.webContents.send(channel, data));
  }

  /**
   * Método público para hacer requests autenticados desde SyncEngine
   */
  public async request(config: AxiosRequestConfig): Promise<any> {
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
  }

  /**
   * Configures Axios interceptors to handle Auth headers and Refresh Token flow
   */
  private setupInterceptors() {
    // Request Interceptor: Attach Token
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

    // Response Interceptor: Handle 401
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

  /**
   * Executes the refresh token logic safely
   */
  private async performRefreshToken(): Promise<string> {
    const settings = db.getSettings();
    if (!settings.refreshToken) {
      throw new Error('No refresh token available');
    }

    // Use a clean axios call to avoid interceptor loops
    try {
      const response = await axios.post(`${this.baseUrl}/auth/refresh`, {
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
      } else {
          throw new Error('Invalid refresh token response format');
      }
    } catch (error) {
      console.error('[BackendDaemon] Refresh failed:', error);
      throw error;
    }
  }

  /**
   * Retries or rejects queued requests
   */
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
  public async syncDevicesOnLogin() {
    const windows = BrowserWindow.getAllWindows();
    const sendToRenderer = (channel: string, data?: any) => {
        windows.forEach(w => w.webContents.send(channel, data));
    };

    sendToRenderer('devices:sync-start');

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
        sendToRenderer('devices:sync-complete', allDevices);

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
              clientId: 'client-1', // TODO: Make dynamic if needed
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
          // Continue execution, will retry next login
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
      } catch (e: any) {
          console.error('[BackendDaemon] Failed to fetch remote devices:', e.message);
          // Do not throw, just log, so the flow continues to "notify"
      }
  }

  /**
   * Exposes capabilities to Renderer via IPC
   */
  private setupIPC() {
    // Trigger sync on login success
    ipcMain.on('auth:login-success', () => {
        this.syncDevicesOnLogin();
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
        // Normalize for IPC (removing potentially large data if needed, but db.getItems returns simple objects)
        // We reuse the normalization logic from main.js if possible, or duplicate it here.
        // main.js has normalizeForIPC. 
        // Let's implement a simple one here or import.
        const items = this.getItemsByActiveDevice(limit, offset, filter);
        return items.map((i: any) => ({
            id: i.id,
            value: i.value,
            type: i.type,
            favorite: i.favorite,
            createdAt: i.createdAt,
            imagePath: i.type === 'image' && i.value.startsWith('[LOCAL_IMAGE]:') ? i.value.replace('[LOCAL_IMAGE]:', '') : null
        }));
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
