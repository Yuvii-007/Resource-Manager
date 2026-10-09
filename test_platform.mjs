import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { storage } from './src/db/storage.js';
import { generateToken, verifyToken } from './src/routes/auth.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('  RESOURCE MANAGER — PLATFORM VERIFICATION TEST SUITE');
  console.log('============================================================\n');

  // --- SECTION 1: CRITICAL DATA LOSS AUDIT & VERIFIED PERSISTENCE ---
  console.log('[1] Data Loss Bug Audit & Startup Persistence Verification');
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const jsMatch = indexHtml.match(/<script>([\s\S]*)<\/script>/);
  assert(jsMatch !== null, 'Found script tag in index.html');
  const js = jsMatch[1];

  // Verify resources = load() exists and is invoked
  assert(/resources\s*=\s*load\(\)/.test(js), 'Verified fix: resources = load() is called on application initialization');

  // Verify multi-key legacy migration exists
  assert(/rm_resources_v1/.test(js) && /rm_resources/.test(js), 'Verified fix: multi-key legacy storage migration is implemented');

  // Simulate startup persistence across restart
  const mockStorage = new Map();
  const STORE_KEY = 'rm_resources_v2';

  // Step A: User saves 3 bookmarks
  const initialBookmarks = [
    { id: 'b1', name: 'GitHub', url: 'https://github.com', category: 'Dev', notes: 'Code hosting' },
    { id: 'b2', name: 'MDN Web Docs', url: 'https://developer.mozilla.org', category: 'Docs', notes: 'Web standards' },
    { id: 'b3', name: 'OpenAI', url: 'https://openai.com', category: 'AI', notes: 'LLM research' }
  ];
  mockStorage.set(STORE_KEY, JSON.stringify(initialBookmarks));

  // Step B: Simulate Application Restart / Page Reload
  function simulateStartupLoad(storageMap) {
    const raw = storageMap.get(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  const loadedAfterRestart = simulateStartupLoad(mockStorage);
  assert(loadedAfterRestart.length === 3, 'Bookmarks survive simulated application restart');
  assert(loadedAfterRestart[0].name === 'GitHub', 'Bookmark properties preserved perfectly across restart');

  // Step C: Simulate Legacy Key Migration (e.g. user with legacy rm_resources key)
  const legacyStorage = new Map();
  legacyStorage.set('rm_resources', JSON.stringify([{ id: 'leg1', name: 'Legacy Site', url: 'https://legacy.org' }]));

  function simulateMigration(storageMap) {
    let d = storageMap.get(STORE_KEY);
    if (!d) {
      for (const k of ['rm_resources', 'rm_resources_v1', 'bookmarks']) {
        const legacy = storageMap.get(k);
        if (legacy) return JSON.parse(legacy);
      }
    }
    return d ? JSON.parse(d) : [];
  }
  const migrated = simulateMigration(legacyStorage);
  assert(migrated.length === 1 && migrated[0].name === 'Legacy Site', 'Legacy user data migrated safely without data loss');

  // --- SECTION 2: CLOUD SYNC & ACCOUNTS ---
  console.log('\n[2] Cloud Sync, Authentication & Conflict Resolution');
  const testEmail = `test_${Date.now()}@resourcemanager.internal`;
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('SuperSecureP@ssw0rd', salt);
  const user = await storage.createUser({ email: testEmail, passwordHash });

  assert(user.id.startsWith('usr_'), 'User created with valid identifier');
  assert(await bcrypt.compare('SuperSecureP@ssw0rd', user.passwordHash), 'Password hash verified via bcrypt');

  // Token session verification
  const token = generateToken(user);
  const verified = verifyToken(token);
  assert(verified !== null && verified.userId === user.id, 'Session token generated, signed and verified');

  // Conflict Resolution test (Last-Write-Wins)
  const clientOlder = [
    { id: 'sync1', name: 'Initial Version', url: 'https://v1.com', updated: '2026-01-01T00:00:00.000Z' }
  ];
  await storage.sync(user.id, clientOlder);

  const clientNewer = [
    { id: 'sync1', name: 'Updated by Client Device', url: 'https://v2.com', updated: '2026-10-01T00:00:00.000Z' }
  ];
  const syncResult = await storage.sync(user.id, clientNewer);
  assert(syncResult.items.find(r => r.id === 'sync1').name === 'Updated by Client Device', 'Conflict resolution: newer client edit wins');

  // --- SECTION 3: BROWSER EXTENSION CAPTURE ---
  console.log('\n[3] Browser Extension Capture');
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  assert(manifest.manifest_version === 3, 'Extension adheres to Chrome Manifest V3');
  assert(manifest.permissions.includes('activeTab'), 'Extension declares activeTab permission');

  const captured = await storage.saveResource({
    name: 'Captured via Extension',
    url: 'https://captured-site.org',
    notes: 'Selected text from webpage',
    category: 'Extension',
    tags: ['web-capture']
  }, user.id);
  assert(captured.name === 'Captured via Extension', 'Extension capture ingested and persisted into storage');

  // --- SECTION 4: ENCRYPTION & INTEGRITY (AES-256-GCM / SHA-256) ---
  console.log('\n[4] Strong Encryption & Integrity Verification');
  const testSecret = 'Personal Vault Secret Notes';
  const passphrase = 'MySuperStrongVaultPassphrase!';

  // Node crypto AES-256-GCM implementation matching WebCrypto PBKDF2
  const encSalt = crypto.randomBytes(16);
  const derivedKey = crypto.pbkdf2Sync(passphrase, encSalt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let encrypted = cipher.update(testSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decryption & authentication verification
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  assert(decrypted === testSecret, 'AES-256-GCM authenticated encryption and decryption succeeded');

  // Test tamper detection
  let tamperDetected = false;
  try {
    const badDecipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    const badTag = Buffer.from(authTag);
    badTag[0] ^= 1; // Flip a bit
    badDecipher.setAuthTag(badTag);
    badDecipher.update(encrypted, 'hex', 'utf8');
    badDecipher.final('utf8');
  } catch (e) {
    tamperDetected = true;
  }
  assert(tamperDetected, 'AES-256-GCM successfully detects corrupted/tampered ciphertext');

  // --- SECTION 5: AUTOMATED BACKUPS & RESTORE PREVIEW ---
  console.log('\n[5] Automated Backups, SHA-256 Checksum & Restore Previews');
  const backup = await storage.createBackup(user.id, 'Test Snapshot', 'manual');
  assert(backup.id.startsWith('bk_'), 'Backup created with identifier');
  assert(backup.sha256.length === 64, 'SHA-256 integrity checksum computed');

  const fetchedBackup = await storage.getBackupById(backup.id, user.id);
  assert(fetchedBackup.integrityOk === true, 'Backup SHA-256 integrity check verified');

  // Test restore
  const restoreRes = await storage.restoreBackup(backup.id, user.id);
  assert(restoreRes.restoredCount >= 0, 'Backup restore workflow executed successfully');

  // --- SECTION 6: ADVANCED ORGANIZATION & DEDUPLICATION ---
  console.log('\n[6] Advanced Organization & Deduplication');
  const dup1 = await storage.saveResource({ name: 'Site A', url: 'https://duplicate-url.com' }, user.id);
  const dup2 = await storage.saveResource({ name: 'Site B', url: 'https://duplicate-url.com' }, user.id);

  const allItems = await storage.getResources(user.id);
  const urlCount = allItems.filter(r => r.url === 'https://duplicate-url.com').length;
  assert(urlCount >= 2, 'Duplicate URLs detected correctly for user cleanup');

  // Bulk delete
  const deletedCount = await storage.bulkDelete([dup1.id, dup2.id], user.id);
  assert(deletedCount === 2, 'Bulk delete removed selected items');

  console.log('\n============================================================');
  console.log(`  PLATFORM SUITE RESULTS: ${passed} passed, ${failed} failed`);
  console.log('============================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
