import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Imported first by index.js, so other modules can read these settings when they load.
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch { /* no .env */ }
