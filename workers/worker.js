const fs = require('fs');
const path = require('path');

// Logging helper to send logs to parent process via stdout/stderr which we capture
const log = {
    info: () => {},
    error: () => {}
};

// Worker process started

// Axios debería estar incluido en el bundle de esbuild, pero mantenemos este fallback
// Fix module resolution for unpacked worker in production (solo si axios no está en el bundle)
let axios;
try {
    // Intentar requerir axios (debería estar en el bundle)
    axios = require('axios');
    log.info('Axios loaded successfully from bundle');
} catch (e) {
    // Fallback: intentar resolver desde node_modules si no está en el bundle
    if (process.env.APP_RESOURCES_PATH) {
      try {
        const asarNodeModules = path.join(process.env.APP_RESOURCES_PATH, 'app.asar', 'node_modules');
        const axiosPath = path.join(asarNodeModules, 'axios');
        if (fs.existsSync(axiosPath)) {
          axios = require(axiosPath);
          log.info('Axios loaded from app.asar/node_modules');
        } else {
          throw new Error('Axios not found in app.asar/node_modules');
        }
      } catch (fallbackErr) {
        log.error('Failed to load axios from bundle and fallback:', e.message);
        log.error('Stack:', e.stack);
        // Axios es crítico para sync, pero no deberíamos fallar aquí si está en el bundle
      }
    } else {
      log.error('Failed to load axios:', e.message);
      log.error('Stack:', e.stack);
    }
}

const crypto = require('crypto');
// const axios = require('axios'); // Moved inside try-catch

let userDataPath = '';
let imageHistoryDir = '';

process.on('message', async (msg) => {
  log.info('Worker received message type:', msg.type);
  
  if (msg.type === 'init') {
    userDataPath = msg.path;
    imageHistoryDir = path.join(userDataPath, 'clipboard-images');
    if (!fs.existsSync(imageHistoryDir)) {
      fs.mkdirSync(imageHistoryDir, { recursive: true });
    }
    process.send({ type: 'init-done' });
  } else if (msg.type === 'migrate-images') {
    await handleMigration(msg.items);
  } else if (msg.type === 'sync') {
    log.info('Starting sync in worker');
    try {
        await handleSync(msg.config, msg.items, msg.device);
    } catch (e) {
        log.error('Error in handleSync:', e);
        // Ensure we send something back so main process doesn't hang
        process.send({ type: 'sync-done', syncedIds: [], conflicts: [], newItems: [] });
    }
  } else if (msg.type === 'register-device') {
    log.info('Starting device registration in worker');
    try {
        await handleRegisterDevice(msg.config, msg.deviceInfo, msg.opId);
    } catch (e) {
        log.error('Error in handleRegisterDevice:', e);
        process.send({ type: 'register-device-done', opId: msg.opId, deviceId: null, error: e.message });
    }
  } else if (msg.type === 'refresh-token') {
    log.info('Starting token refresh in worker');
    try {
        await handleRefreshToken(msg.config, msg.refreshToken, msg.opId);
    } catch (e) {
        log.error('Error in handleRefreshToken:', e);
        process.send({ type: 'refresh-token-done', opId: msg.opId, token: null, refreshToken: null, error: e.message });
    }
  }
});

async function handleMigration(items) {
  const results = [];
  for (const item of items) {
    try {
      // item.value is a data URL: "data:image/png;base64,..."
      const match = item.value.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) continue;

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileName = `${Date.now()}-${hash.slice(0, 8)}.${ext}`;
      const filePath = path.join(imageHistoryDir, fileName);

      fs.writeFileSync(filePath, buffer);
      
      // Update manifest
      updateManifest(fileName, hash);

      results.push({ id: item.id, path: filePath });
    } catch (error) {
      // Error migrating item
    }
  }
  process.send({ type: 'migration-done', results });
}

function updateManifest(fileName, hash) {
  const manifestPath = path.join(imageHistoryDir, 'images.json');
  let manifest = [];
  try {
    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(raw);
    }
  } catch (e) {}

  manifest.push({ file: fileName, hash, createdAt: new Date().toISOString() });
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (e) {}
}

async function handleSync(config, localItems, deviceName) {
  if (!axios) {
      log.error('Axios not loaded, cannot sync');
      throw new Error('Axios not loaded');
  }
  const { backendUrl, authToken } = config;
  const axiosInstance = axios.create({
    baseURL: backendUrl,
    headers: { Authorization: `Bearer ${authToken}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  const syncedIds = [];
  const conflicts = [];
  
  // 1. UPLOAD DIRTY ITEMS
  if (localItems && localItems.length > 0) {
    const MAX_BATCH_SIZE = 10000;
    const MAX_PAYLOAD_SIZE = 1024 * 1024 * 1; // 1MB
    const getSize = (obj) => JSON.stringify(obj).length;

    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const item of localItems) {
      let type = 'text';
      let valueToSend = item.value;

      if (item.value.startsWith('data:image')) {
        type = 'image';
      } else if (item.value.startsWith('[LOCAL_IMAGE]:')) {
        type = 'image';
        const localPath = item.value.replace('[LOCAL_IMAGE]:', '');
        try {
          if (fs.existsSync(localPath)) {
             // Read file and convert to base64
             const buf = fs.readFileSync(localPath);
             // Detect mime type simple (assume png usually or check ext)
             let mime = 'image/png';
             if (localPath.endsWith('.jpg') || localPath.endsWith('.jpeg')) mime = 'image/jpeg';
             else if (localPath.endsWith('.webp')) mime = 'image/webp';
             
             valueToSend = `data:${mime};base64,${buf.toString('base64')}`;
          } else {
             continue;
          }
        } catch (e) {
           continue;
        }
      }

      const itemChange = {
        id: item.id,
        clientId: item.clientId,
        type: type,
        value: valueToSend,
        favorite: item.favorite,
        version: item.version,
        updatedAt: item.updatedAt
      };

      const itemSize = getSize(itemChange);
      if (itemSize > MAX_PAYLOAD_SIZE) continue;

      if (currentBatch.length >= MAX_BATCH_SIZE || (currentSize + itemSize) > MAX_PAYLOAD_SIZE) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      currentBatch.push(itemChange);
      currentSize += itemSize;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    // Upload batches
     for (const batch of batches) {
        try {
          const payload = { clientId: deviceName, changes: batch };
          const res = await axiosInstance.post('/clipboard/sync', payload);
          const { applied, conflicts: batchConflicts } = res.data;

          if (applied && Array.isArray(applied)) {
            // applied contains { clientId, id, ... }
            syncedIds.push(...applied);
          }

          if (batchConflicts && Array.isArray(batchConflicts)) {
             for (const c of batchConflicts) {
                 if (c.server) conflicts.push(c.server);
             }
          }
        } catch (e) {
           // Batch sync error
        }
     }
   }

  // 2. DOWNLOAD NEW ITEMS
  let newItems = [];
  try {
    const res = await axiosInstance.get('/clipboard');
    if (res.data && res.data.status && Array.isArray(res.data.data)) {
       newItems = res.data.data;
    }
  } catch (e) {
    // ignore fetch error
  }

  process.send({ type: 'sync-done', syncedIds, conflicts, newItems });
}

async function handleRegisterDevice(config, deviceInfo, opId) {
  if (!axios) {
      log.error('Axios not loaded, cannot register device');
      throw new Error('Axios not loaded');
  }
  const { backendUrl, authToken } = config;
  const axiosInstance = axios.create({
    baseURL: backendUrl,
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  try {
    const { hostname, osName, appVersion } = deviceInfo;
    const payload = { 
      clientId: hostname, 
      name: hostname, 
      metadata: { os: osName, appVersion } 
    };
    const res = await axiosInstance.post('/devices', payload);
    const data = res?.data;
    const obj = (data && typeof data === 'object' ? (data.data ?? data) : {});
    const deviceId = obj?.id || obj?.device?.id || null;
    process.send({ type: 'register-device-done', opId, deviceId, error: null });
  } catch (error) {
    log.error('Device registration error:', error?.message || error);
    process.send({ type: 'register-device-done', opId, deviceId: null, error: error?.message || 'Unknown error' });
  }
}

async function handleRefreshToken(config, refreshTokenValue, opId) {
  if (!axios) {
      log.error('Axios not loaded, cannot refresh token');
      throw new Error('Axios not loaded');
  }
  const { backendUrl } = config;
  
  try {
    const url = `${backendUrl}/auth/refresh`;
    const requestPayload = { refreshToken: refreshTokenValue };
    
    const res = await axios.post(url, requestPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const data = res?.data;
    const payload = (data && typeof data === 'object' ? (data.data ?? data) : {});
    const okFlag = (data && typeof data === 'object') ? (data.success ?? data.status ?? res.status === 200) : res.status === 200;
    const newToken = payload?.token;
    const newRefreshToken = payload?.refreshToken || refreshTokenValue;

    if (okFlag && newToken) {
      process.send({ type: 'refresh-token-done', opId, token: newToken, refreshToken: newRefreshToken, error: null });
    } else {
      throw new Error('Invalid response from refresh endpoint');
    }
  } catch (error) {
    log.error('Token refresh error:', error?.message || error);
    process.send({ type: 'refresh-token-done', opId, token: null, refreshToken: null, error: error?.message || 'Unknown error' });
  }
}
