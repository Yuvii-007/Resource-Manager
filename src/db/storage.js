import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class StorageEngine {
  constructor() {
    this.isPg = false;
    this.pgPool = null;
    this.memoryDb = {
      users: [],
      resources: [],
      backups: [],
      syncEvents: []
    };
    this.init();
  }

  init() {
    // Check if PostgreSQL environment variables are configured
    const hasPg = !!(
      (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) ||
      process.env.DATABASE_URL
    );

    if (hasPg) {
      try {
        const poolConfig = process.env.DATABASE_URL
          ? { connectionString: process.env.DATABASE_URL }
          : {
              host: process.env.SQL_HOST,
              user: process.env.SQL_USER,
              password: process.env.SQL_PASSWORD,
              database: process.env.SQL_DB_NAME,
              max: 10,
              connectionTimeoutMillis: 5000,
            };

        this.pgPool = new Pool(poolConfig);
        this.pgPool.on('error', (err) => {
          console.warn('[PostgreSQL Pool Warning]', err.message);
        });

        this.initPgSchema();
        this.isPg = true;
        console.log('[StorageEngine] Initialized with PostgreSQL backing');
        return;
      } catch (err) {
        console.warn('[StorageEngine] PostgreSQL init failed, falling back to local file storage:', err.message);
        this.isPg = false;
      }
    }

    // Fallback or default: persistent file store
    this.loadFileDb();
    console.log(`[StorageEngine] Initialized with local persistent file storage (${this.memoryDb.resources.length} resources loaded)`);
  }

  async initPgSchema() {
    if (!this.pgPool) return;
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS rm_users (
            id VARCHAR(64) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS rm_resources (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            name VARCHAR(255) NOT NULL,
            url TEXT NOT NULL,
            notes TEXT DEFAULT '',
            category VARCHAR(100) DEFAULT '',
            tags TEXT DEFAULT '[]',
            order_index INT DEFAULT 0,
            is_favorite BOOLEAN DEFAULT FALSE,
            is_deleted BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS rm_backups (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            label VARCHAR(255) NOT NULL,
            type VARCHAR(50) DEFAULT 'manual',
            sha256 VARCHAR(64) NOT NULL,
            item_count INT DEFAULT 0,
            payload_json TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_resources_user ON rm_resources(user_id);
          CREATE INDEX IF NOT EXISTS idx_resources_cat ON rm_resources(category);
          CREATE INDEX IF NOT EXISTS idx_resources_updated ON rm_resources(updated_at);
        `);
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('[StorageEngine] PostgreSQL schema setup error:', err.message);
    }
  }

  loadFileDb() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.memoryDb = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          resources: Array.isArray(parsed.resources) ? parsed.resources : [],
          backups: Array.isArray(parsed.backups) ? parsed.backups : [],
          syncEvents: Array.isArray(parsed.syncEvents) ? parsed.syncEvents : []
        };
      } else {
        this.saveFileDb();
      }
    } catch (err) {
      console.error('[StorageEngine] Error loading db.json, creating clean store:', err.message);
      this.saveFileDb();
    }
  }

  saveFileDb() {
    try {
      const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, JSON.stringify(this.memoryDb, null, 2), 'utf8');
      fs.renameSync(tempFile, DATA_FILE);
    } catch (err) {
      console.error('[StorageEngine] Atomic file write failed:', err.message);
    }
  }

  // User management
  async getUserByEmail(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (this.isPg && this.pgPool) {
      try {
        const res = await this.pgPool.query('SELECT * FROM rm_users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail]);
        if (res.rows[0]) {
          return {
            id: res.rows[0].id,
            email: res.rows[0].email,
            passwordHash: res.rows[0].password_hash,
            createdAt: res.rows[0].created_at,
            updatedAt: res.rows[0].updated_at
          };
        }
      } catch (e) {
        console.warn('PG getUserByEmail failed, using local:', e.message);
      }
    }
    return this.memoryDb.users.find(u => u.email.toLowerCase() === cleanEmail) || null;
  }

  async getUserById(id) {
    if (this.isPg && this.pgPool) {
      try {
        const res = await this.pgPool.query('SELECT * FROM rm_users WHERE id = $1 LIMIT 1', [id]);
        if (res.rows[0]) {
          return {
            id: res.rows[0].id,
            email: res.rows[0].email,
            passwordHash: res.rows[0].password_hash,
            createdAt: res.rows[0].created_at,
            updatedAt: res.rows[0].updated_at
          };
        }
      } catch (e) {
        console.warn('PG getUserById failed, using local:', e.message);
      }
    }
    return this.memoryDb.users.find(u => u.id === id) || null;
  }

  async createUser({ email, passwordHash }) {
    const cleanEmail = email.trim().toLowerCase();
    const id = 'usr_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();

    const user = {
      id,
      email: cleanEmail,
      passwordHash,
      createdAt: now,
      updatedAt: now
    };

    if (this.isPg && this.pgPool) {
      try {
        await this.pgPool.query(
          'INSERT INTO rm_users (id, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
          [id, cleanEmail, passwordHash, now, now]
        );
      } catch (e) {
        console.warn('PG createUser error, persisting locally:', e.message);
      }
    }

    this.memoryDb.users.push(user);
    this.saveFileDb();
    return user;
  }

  // Resources CRUD
  async getResources(userId = 'default_user') {
    if (this.isPg && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          'SELECT * FROM rm_resources WHERE user_id = $1 AND is_deleted = FALSE ORDER BY order_index ASC, created_at DESC',
          [userId]
        );
        return res.rows.map(r => ({
          id: r.id,
          userId: r.user_id,
          name: r.name,
          url: r.url,
          notes: r.notes || '',
          category: r.category || '',
          tags: JSON.parse(r.tags || '[]'),
          orderIndex: r.order_index,
          isFavorite: r.is_favorite,
          created: r.created_at,
          updated: r.updated_at
        }));
      } catch (e) {
        console.warn('PG getResources failed, falling back:', e.message);
      }
    }

    return this.memoryDb.resources
      .filter(r => (r.userId === userId || !r.userId || userId === 'all') && !r.isDeleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }

  async saveResource(item, userId = 'default_user') {
    const now = new Date().toISOString();
    const id = item.id || ('res_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'));

    const resource = {
      id,
      userId,
      name: (item.name || '').trim().slice(0, 120),
      url: (item.url || '').trim().slice(0, 2048),
      notes: (item.notes || '').slice(0, 2000),
      category: (item.category || '').trim().slice(0, 40),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 15).map(t => String(t).trim().slice(0, 30)) : [],
      orderIndex: typeof item.orderIndex === 'number' ? item.orderIndex : 0,
      isFavorite: Boolean(item.isFavorite),
      isDeleted: false,
      created: item.created || now,
      updated: item.updated || now
    };

    if (this.isPg && this.pgPool) {
      try {
        await this.pgPool.query(`
          INSERT INTO rm_resources (id, user_id, name, url, notes, category, tags, order_index, is_favorite, is_deleted, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            url = EXCLUDED.url,
            notes = EXCLUDED.notes,
            category = EXCLUDED.category,
            tags = EXCLUDED.tags,
            order_index = EXCLUDED.order_index,
            is_favorite = EXCLUDED.is_favorite,
            is_deleted = FALSE,
            updated_at = EXCLUDED.updated_at
        `, [
          resource.id,
          resource.userId,
          resource.name,
          resource.url,
          resource.notes,
          resource.category,
          JSON.stringify(resource.tags),
          resource.orderIndex,
          resource.isFavorite,
          resource.created,
          resource.updated
        ]);
      } catch (e) {
        console.warn('PG saveResource failed, storing locally:', e.message);
      }
    }

    const idx = this.memoryDb.resources.findIndex(r => r.id === id);
    if (idx >= 0) {
      this.memoryDb.resources[idx] = resource;
    } else {
      this.memoryDb.resources.push(resource);
    }
    this.saveFileDb();
    return resource;
  }

  async deleteResource(id, userId = 'default_user') {
    const now = new Date().toISOString();
    if (this.isPg && this.pgPool) {
      try {
        await this.pgPool.query(
          'UPDATE rm_resources SET is_deleted = TRUE, updated_at = $1 WHERE id = $2 AND user_id = $3',
          [now, id, userId]
        );
      } catch (e) {
        console.warn('PG deleteResource failed:', e.message);
      }
    }

    const target = this.memoryDb.resources.find(r => r.id === id && (r.userId === userId || userId === 'all'));
    if (target) {
      target.isDeleted = true;
      target.updated = now;
      this.saveFileDb();
      return true;
    }
    return false;
  }

  async bulkDelete(ids, userId = 'default_user') {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const now = new Date().toISOString();
    let count = 0;

    for (const id of ids) {
      const ok = await this.deleteResource(id, userId);
      if (ok) count++;
    }
    return count;
  }

  async reorderResources(orderedIds, userId = 'default_user') {
    if (!Array.isArray(orderedIds)) return false;
    orderedIds.forEach((id, index) => {
      const item = this.memoryDb.resources.find(r => r.id === id && r.userId === userId);
      if (item) {
        item.orderIndex = index;
        item.updated = new Date().toISOString();
      }
    });
    this.saveFileDb();

    if (this.isPg && this.pgPool) {
      try {
        for (let i = 0; i < orderedIds.length; i++) {
          await this.pgPool.query(
            'UPDATE rm_resources SET order_index = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
            [i, orderedIds[i], userId]
          );
        }
      } catch (e) {
        console.warn('PG reorder failed:', e.message);
      }
    }
    return true;
  }

  // Synchronization with conflict resolution (Last-Write-Wins)
  async sync(userId = 'default_user', clientItems = [], lastSyncTimestamp = 0) {
    const conflictsResolved = [];
    const serverItems = await this.getResources(userId);
    const serverMap = new Map(serverItems.map(r => [r.id, r]));

    // Process incoming client items
    for (const clientItem of clientItems) {
      if (!clientItem || !clientItem.id) continue;
      const existing = serverMap.get(clientItem.id);

      if (!existing) {
        // Client added new resource
        await this.saveResource(clientItem, userId);
      } else {
        // Conflict resolution: compare update timestamps
        const clientTime = new Date(clientItem.updated || clientItem.created || 0).getTime();
        const serverTime = new Date(existing.updated || existing.created || 0).getTime();

        if (clientTime > serverTime) {
          // Client wins
          await this.saveResource(clientItem, userId);
          conflictsResolved.push({ id: clientItem.id, winner: 'client' });
        } else if (serverTime > clientTime) {
          // Server wins - client will receive updated server item
          conflictsResolved.push({ id: existing.id, winner: 'server' });
        }
      }
    }

    // Return the updated full list and current server time
    const updatedServerItems = await this.getResources(userId);
    return {
      serverTimestamp: new Date().toISOString(),
      items: updatedServerItems,
      conflictsResolved
    };
  }

  // Backup Engine with SHA-256 Checksum & Version History
  async createBackup(userId = 'default_user', label = 'Snapshot', type = 'manual') {
    const resources = await this.getResources(userId);
    const payload = JSON.stringify(resources, null, 2);
    const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
    const id = 'bk_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();

    const backup = {
      id,
      userId,
      label,
      type,
      sha256,
      count: resources.length,
      payload,
      createdAt: now
    };

    if (this.isPg && this.pgPool) {
      try {
        await this.pgPool.query(
          'INSERT INTO rm_backups (id, user_id, label, type, sha256, item_count, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [id, userId, label, type, sha256, resources.length, payload, now]
        );
      } catch (e) {
        console.warn('PG createBackup failed, saving locally:', e.message);
      }
    }

    // Keep up to 50 backups
    this.memoryDb.backups.unshift(backup);
    if (this.memoryDb.backups.length > 50) {
      this.memoryDb.backups = this.memoryDb.backups.slice(0, 50);
    }
    this.saveFileDb();

    return {
      id,
      label,
      type,
      sha256,
      count: resources.length,
      createdAt: now
    };
  }

  async getBackups(userId = 'default_user') {
    if (this.isPg && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          'SELECT id, user_id, label, type, sha256, item_count, created_at FROM rm_backups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
          [userId]
        );
        return res.rows.map(r => ({
          id: r.id,
          userId: r.user_id,
          label: r.label,
          type: r.type,
          sha256: r.sha256,
          count: r.item_count,
          createdAt: r.created_at
        }));
      } catch (e) {
        console.warn('PG getBackups failed, falling back:', e.message);
      }
    }

    return this.memoryDb.backups
      .filter(b => b.userId === userId || userId === 'all')
      .map(b => ({
        id: b.id,
        label: b.label,
        type: b.type,
        sha256: b.sha256,
        count: b.count,
        createdAt: b.createdAt
      }));
  }

  async getBackupById(id, userId = 'default_user') {
    const backup = this.memoryDb.backups.find(b => b.id === id && (b.userId === userId || userId === 'all'));
    if (!backup) return null;

    // Verify SHA-256 integrity check
    const currentHash = crypto.createHash('sha256').update(backup.payload).digest('hex');
    const integrityOk = currentHash === backup.sha256;

    let items = [];
    try {
      items = JSON.parse(backup.payload);
    } catch (e) {
      items = [];
    }

    return {
      ...backup,
      integrityOk,
      items
    };
  }

  async restoreBackup(id, userId = 'default_user') {
    const backup = await this.getBackupById(id, userId);
    if (!backup || !backup.integrityOk) {
      throw new Error('Backup not found or integrity check failed');
    }

    // Auto-create a rollback checkpoint before restoring
    await this.createBackup(userId, `Auto-Checkpoint before restoring "${backup.label}"`, 'checkpoint');

    // Replace or merge resources
    for (const item of backup.items) {
      await this.saveResource(item, userId);
    }

    return {
      restoredCount: backup.items.length,
      label: backup.label,
      restoredAt: new Date().toISOString()
    };
  }
}

export const storage = new StorageEngine();
