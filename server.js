import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { storage } from './src/db/storage.js';
import authRoutes from './src/routes/auth.js';
import resourceRoutes from './src/routes/resources.js';
import syncRoutes from './src/routes/sync.js';
import backupRoutes from './src/routes/backups.js';
import extensionRoutes from './src/routes/extension.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/extension', extensionRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: storage.isPg ? 'postgresql' : 'local-file',
    version: '2.0.0'
  });
});

// Periodic automated backup worker (runs every 6 hours)
const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const resources = await storage.getResources('default_user');
    if (resources.length > 0) {
      await storage.createBackup('default_user', 'Automated Scheduled Backup', 'scheduled');
      console.log(`[Auto-Backup] Successfully created snapshot of ${resources.length} resources`);
    }
  } catch (err) {
    console.warn('[Auto-Backup] Snapshot error:', err.message);
  }
}, AUTO_BACKUP_INTERVAL_MS);

// Initial boot snapshot
setTimeout(async () => {
  try {
    const resources = await storage.getResources('default_user');
    if (resources.length > 0) {
      const backups = await storage.getBackups('default_user');
      if (backups.length === 0) {
        await storage.createBackup('default_user', 'Initial Vault Snapshot on Boot', 'scheduled');
      }
    }
  } catch (e) {
    // ignore
  }
}, 5000);

// Static assets
app.use(express.static(__dirname));

// Client SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Resource Manager server running on http://${HOST}:${PORT}`);
});

export default app;
