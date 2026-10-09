import express from 'express';
import cors from 'cors';
import { storage } from '../src/db/storage.js';
import authRoutes from '../src/routes/auth.js';
import resourceRoutes from '../src/routes/resources.js';
import syncRoutes from '../src/routes/sync.js';
import backupRoutes from '../src/routes/backups.js';
import extensionRoutes from '../src/routes/extension.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/extension', extensionRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: storage.isPg ? 'postgresql' : 'local-file',
    version: '2.0.0'
  });
});

export default app;
