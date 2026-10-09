import express from 'express';
import { storage } from '../db/storage.js';
import { optionalAuth } from './auth.js';

const router = express.Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const list = await storage.getBackups(req.userId);
    res.json({ backups: list });
  } catch (err) {
    console.error('Error fetching backups:', err);
    res.status(500).json({ error: 'Failed to fetch backups' });
  }
});

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { label = 'Manual Snapshot', type = 'manual' } = req.body || {};
    const backup = await storage.createBackup(req.userId, String(label).slice(0, 100), type);
    res.status(201).json(backup);
  } catch (err) {
    console.error('Error creating backup:', err);
    res.status(500).json({ error: 'Failed to create backup snapshot' });
  }
});

router.get('/:id/preview', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const backup = await storage.getBackupById(id, req.userId);
    if (!backup) {
      return res.status(404).json({ error: 'Backup snapshot not found' });
    }

    const currentItems = await storage.getResources(req.userId);
    const currentMap = new Map(currentItems.map(r => [r.id, r]));

    let toAdd = 0, toUpdate = 0, unchanged = 0;
    for (const item of backup.items) {
      if (!currentMap.has(item.id)) {
        toAdd++;
      } else {
        const cur = currentMap.get(item.id);
        if (cur.updated !== item.updated || cur.name !== item.name || cur.url !== item.url) {
          toUpdate++;
        } else {
          unchanged++;
        }
      }
    }

    res.json({
      id: backup.id,
      label: backup.label,
      sha256: backup.sha256,
      integrityOk: backup.integrityOk,
      createdAt: backup.createdAt,
      totalInBackup: backup.items.length,
      currentTotal: currentItems.length,
      diff: {
        toAdd,
        toUpdate,
        unchanged
      }
    });
  } catch (err) {
    console.error('Error previewing backup:', err);
    res.status(500).json({ error: 'Failed to preview backup' });
  }
});

router.post('/:id/restore', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await storage.restoreBackup(id, req.userId);
    res.json({
      message: `Successfully restored ${result.restoredCount} items from "${result.label}"`,
      ...result
    });
  } catch (err) {
    console.error('Error restoring backup:', err);
    res.status(500).json({ error: 'Failed to restore backup: ' + err.message });
  }
});

router.get('/:id/download', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const backup = await storage.getBackupById(id, req.userId);
    if (!backup) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="rm-backup-${backup.id}.json"`);
    res.send(backup.payload);
  } catch (err) {
    console.error('Error downloading backup:', err);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

export default router;
