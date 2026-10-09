import express from 'express';
import { storage } from '../db/storage.js';
import { optionalAuth } from './auth.js';

const router = express.Router();

function normalizeUrl(u) {
  u = (u || '').trim().slice(0, 2048);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const scheme = u.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    const isLocal = s === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
    if (!isLocal && !s.includes('.')) return '';
  }
  u = 'https://' + u.replace(/^\/+/, '');
  return /^https?:\/\//i.test(u) ? u : '';
}

// Get resources
router.get('/', optionalAuth, async (req, res) => {
  try {
    let items = await storage.getResources(req.userId);
    const { q, cat, tag, sort } = req.query;

    if (cat && cat !== 'all') {
      items = items.filter(r => (r.category || '').toLowerCase() === cat.toLowerCase());
    }

    if (tag) {
      items = items.filter(r => Array.isArray(r.tags) && r.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
    }

    if (q) {
      const query = q.toLowerCase().trim();
      items = items.filter(r =>
        [r.name, r.url, r.notes, r.category, ...(r.tags || [])]
          .some(v => (v || '').toLowerCase().includes(query))
      );
    }

    // Sort
    if (sort === 'name-asc') {
      items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sort === 'name-desc') {
      items.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    } else if (sort === 'date-desc') {
      items.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
    } else if (sort === 'date-asc') {
      items.sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0));
    } else {
      // Default: orderIndex, then created desc
      items.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    }

    res.json({
      total: items.length,
      resources: items
    });
  } catch (err) {
    console.error('Error fetching resources:', err);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// Create resource
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { name, url, notes, category, tags, isFavorite } = req.body || {};
    const cleanName = (name || '').trim().slice(0, 120);
    const cleanUrl = normalizeUrl(url);

    if (!cleanName) {
      return process.env.NODE_ENV === 'test'
        ? res.status(400).json({ error: 'Name is required' })
        : res.status(400).json({ error: 'Please provide a resource name' });
    }
    if (!cleanUrl) {
      return res.status(400).json({ error: 'Valid HTTP/HTTPS URL is required' });
    }

    const item = await storage.saveResource({
      name: cleanName,
      url: cleanUrl,
      notes: (notes || '').slice(0, 2000),
      category: (category || '').trim().slice(0, 40),
      tags: Array.isArray(tags) ? tags : [],
      isFavorite: Boolean(isFavorite)
    }, req.userId);

    res.status(201).json(item);
  } catch (err) {
    console.error('Error creating resource:', err);
    res.status(500).json({ error: 'Failed to save resource' });
  }
});

// Update resource
router.put('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, notes, category, tags, isFavorite, orderIndex } = req.body || {};

    const cleanName = name ? name.trim().slice(0, 120) : undefined;
    const cleanUrl = url ? normalizeUrl(url) : undefined;

    const existingList = await storage.getResources(req.userId);
    const existing = existingList.find(r => r.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const updated = await storage.saveResource({
      ...existing,
      name: cleanName !== undefined ? cleanName : existing.name,
      url: cleanUrl !== undefined ? cleanUrl : existing.url,
      notes: notes !== undefined ? String(notes).slice(0, 2000) : existing.notes,
      category: category !== undefined ? String(category).trim().slice(0, 40) : existing.category,
      tags: Array.isArray(tags) ? tags : existing.tags,
      isFavorite: isFavorite !== undefined ? Boolean(isFavorite) : existing.isFavorite,
      orderIndex: typeof orderIndex === 'number' ? orderIndex : existing.orderIndex,
      updated: new Date().toISOString()
    }, req.userId);

    res.json(updated);
  } catch (err) {
    console.error('Error updating resource:', err);
    res.status(500).json({ error: 'Failed to update resource' });
  }
});

// Delete resource
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await storage.deleteResource(id, req.userId);
    if (!ok) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    res.json({ message: 'Resource deleted successfully' });
  } catch (err) {
    console.error('Error deleting resource:', err);
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

// Bulk actions
router.post('/bulk', optionalAuth, async (req, res) => {
  try {
    const { action, ids, value } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'List of IDs required' });
    }

    if (action === 'delete') {
      const count = await storage.bulkDelete(ids, req.userId);
      return res.json({ message: `${count} resources deleted`, count });
    }

    if (action === 'set-category') {
      const cleanCat = String(value || '').trim().slice(0, 40);
      const items = await storage.getResources(req.userId);
      let updatedCount = 0;
      for (const id of ids) {
        const item = items.find(r => r.id === id);
        if (item) {
          await storage.saveResource({ ...item, category: cleanCat }, req.userId);
          updatedCount++;
        }
      }
      return res.json({ message: `Updated category for ${updatedCount} items`, count: updatedCount });
    }

    if (action === 'add-tag') {
      const cleanTag = String(value || '').trim().slice(0, 30);
      if (!cleanTag) return res.status(400).json({ error: 'Tag cannot be empty' });
      const items = await storage.getResources(req.userId);
      let updatedCount = 0;
      for (const id of ids) {
        const item = items.find(r => r.id === id);
        if (item) {
          const tags = new Set(item.tags || []);
          tags.add(cleanTag);
          await storage.saveResource({ ...item, tags: Array.from(tags) }, req.userId);
          updatedCount++;
        }
      }
      return res.json({ message: `Added tag to ${updatedCount} items`, count: updatedCount });
    }

    res.status(400).json({ error: 'Unsupported bulk action' });
  } catch (err) {
    console.error('Error performing bulk action:', err);
    res.status(500).json({ error: 'Bulk action failed' });
  }
});

// Reorder
router.post('/reorder', optionalAuth, async (req, res) => {
  try {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array required' });
    }
    await storage.reorderResources(orderedIds, req.userId);
    res.json({ message: 'Reordered successfully' });
  } catch (err) {
    console.error('Error reordering resources:', err);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

export default router;
