/// <reference types="vite/client" />

interface BackendAPI {
    request: (config: any) => Promise<{ success: boolean; data: any; status: number; error?: string }>;
    getValidToken: () => Promise<string | null>;
    refreshToken: () => Promise<string | null>;
}

interface ElectronAPI {
    backend: BackendAPI;
    getPreferences: () => Promise<any>;
    getConfig: (key: string) => Promise<string | null>;
    setConfig: (key: string, value: string) => Promise<void>;
    removeConfig: (key: string) => Promise<void>;
    setAuthToken: (token: string) => void;
    setActiveDevice: (id: string) => Promise<boolean>;
    // Allow loose typing for other IPC methods to prevent build errors
    [key: string]: any;
}

interface Window {
    electronAPI?: ElectronAPI;
    copyfy: {
        getSystemLocale: () => Promise<string>;
    };
}
