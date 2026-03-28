
// Type definition for the exposed Electron API is now in vite-env.d.ts

/**
 * Wrapper to make backend requests via Electron Main Process
 * This prevents the Renderer from handling network logic directly.
 */
export const backendRequest = async <T>(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data?: any): Promise<T> => {
    // Construct Axios-compatible config
    const config = {
        url: endpoint, // Relative URL, base is handled in Daemon
        method,
        data
    };
    
    // Invoke IPC
    if (!window.electronAPI?.backend) {
        throw new Error('Electron backend API not available');
    }
    const response = await window.electronAPI.backend.request(config);
    
    if (!response.success) {
        // Handle specific errors or throw
        throw new Error(response.error || `Request failed with status ${response.status}`);
    }
    
    return response.data;
};

// Example specific API call
export const fetchUserProfile = async () => {
    return backendRequest<{ id: string; name: string }>('/user/profile');
};

export const syncData = async (payload: any) => {
    return backendRequest('/sync', 'POST', payload);
};
