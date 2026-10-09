import express from 'express';
import { storage } from '../db/storage.js';
import { optionalAuth } from './auth.js';

const router = express.Router();

// One-click bookmark capture from browser extension
router.post('/capture', optionalAuth, async (req, res) => {
  try {
    const { url, name, notes, category, tags } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const cleanName = (name || '').trim().slice(0, 120) || new URL(url).hostname;
    const cleanNotes = (notes || '').slice(0, 2000);
    const cleanCategory = (category || '').trim().slice(0, 40) || 'Uncategorized';
    const cleanTags = Array.isArray(tags) ? tags.map(t => String(t).trim().slice(0, 30)) : [];

    const resource = await storage.saveResource({
      name: cleanName,
      url,
      notes: cleanNotes,
      category: cleanCategory,
      tags: cleanTags,
      isFavorite: false
    }, req.userId);

    res.status(201).json({
      message: 'Captured to Resource Manager',
      resource
    });
  } catch (err) {
    console.error('Extension capture error:', err);
    res.status(500).json({ error: 'Failed to capture bookmark' });
  }
});

// Category and tag autocomplete data for extension popup
router.get('/autocomplete', optionalAuth, async (req, res) => {
  try {
    const items = await storage.getResources(req.userId);
    const categories = Array.from(new Set(items.map(r => (r.category || '').trim()).filter(Boolean))).sort();
    const tags = Array.from(new Set(items.flatMap(r => r.tags || []).map(t => (t || '').trim()).filter(Boolean))).sort();

    res.json({ categories, tags });
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

export default router;
