const fs = require('fs');
const path = require('path');

// Logging helper to send logs to parent process via stdout/stderr which we capture
const log = {
    info: (...args) => console.log(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')),
    error: (...args) => console.error(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '))
};

log.info('Worker process started');
log.info('Worker env:', process.env);
log.info('Worker module paths:', module.paths);

// Fix module resolution for unpacked worker in production
if (process.env.APP_RESOURCES_PATH) {
  const asarNodeModules = path.join(process.env.APP_RESOURCES_PATH, 'app.asar', 'node_modules');
  log.info('Checking asar node_modules:', asarNodeModules);
  if (!module.paths.includes(asarNodeModules)) {
    module.paths.push(asarNodeModules);
    log.info('Added asar node_modules to module.paths');
  }
}

let axios;
try {
    axios = require('axios');
    log.info('Axios loaded successfully');
} catch (e) {
    log.error('Failed to load axios:', e.message);
    log.error('Stack:', e.stack);
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
      console.error(`[Worker] Error migrating item ${item.id}:`, error);
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
           // Basic error logging
           console.error('Batch sync error:', e.message);
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
