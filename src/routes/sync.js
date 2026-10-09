import express from 'express';
import { storage } from '../db/storage.js';
import { optionalAuth } from './auth.js';

const router = express.Router();

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { items = [], lastSyncTimestamp = 0 } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    const result = await storage.sync(req.userId, items, lastSyncTimestamp);
    res.json({
      status: 'success',
      serverTimestamp: result.serverTimestamp,
      items: result.items,
      conflictsResolved: result.conflictsResolved
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Cloud sync failed: ' + err.message });
  }
});

export default router;
