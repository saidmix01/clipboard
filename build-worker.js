#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Crear directorio de salida si no existe
const outDir = path.join(__dirname, 'workers', 'dist');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Intentar cargar esbuild desde múltiples ubicaciones
let esbuild;
const possiblePaths = [
  path.join(__dirname, 'frontend', 'node_modules', 'esbuild'),
  path.join(__dirname, 'node_modules', 'esbuild'),
  'esbuild' // Intentar desde node_modules global/local
];

let lastError;
for (const esbuildPath of possiblePaths) {
  try {
    esbuild = require(esbuildPath);
    break;
  } catch (e) {
    lastError = e;
  }
}

if (!esbuild) {
  console.error('Error: esbuild no encontrado.');
  console.error('Intenta ejecutar: npm install --prefix frontend');
  console.error('O instalar globalmente: npm install -g esbuild');
  process.exit(1);
}

// Construir el worker
// axios se incluye en el bundle para evitar problemas de resolución de módulos en producción
esbuild.build({
  entryPoints: [path.join(__dirname, 'workers', 'worker.js')],
  bundle: true,
  platform: 'node',
  outfile: path.join(outDir, 'worker.js'),
  external: ['electron'], // Solo electron es external, axios se incluye en el bundle automáticamente
  format: 'cjs',
  target: 'node18'
}).then(() => {
  console.log('✓ Worker compilado exitosamente en workers/dist/worker.js');
}).catch((err) => {
  console.error('Error al compilar worker:', err);
  process.exit(1);
});
