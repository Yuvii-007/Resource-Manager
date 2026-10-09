<div align="center">

<img src="docs/logo.svg" alt="Resource Manager" width="72">

# Resource Manager Pro

### Your web, never forgotten — everywhere.

*A production-ready, ultra-premium, secure, cross-device personal web vault with cloud sync, PostgreSQL-backed persistence, Manifest V3 browser extension, and zero-knowledge AES-256-GCM encryption.*

[![Security Tests](https://img.shields.io/badge/security_tests-62%2F62_passed-brightgreen?style=flat-square&logo=shield)](#-security)
[![Platform Tests](https://img.shields.io/badge/platform_tests-21%2F21_passed-brightgreen?style=flat-square&logo=node.js)](#-automated-tests)
[![Node.js](https://img.shields.io/badge/runtime-Node_22-339933?style=flat-square&logo=node.js)](package.json)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[Data Loss Diagnosis & Fix](#-critical-data-loss-root-cause--fix) · [Features](#-features) · [Cloud Sync & DB](#-cloud-sync--postgresql) · [Browser Extension](#-browser-extension) · [Encryption](#-zero-knowledge-encryption) · [Backups & Recovery](#-automated-backups--recovery) · [Getting Started](#-getting-started)

</div>

---

## 🚨 Critical Data Loss: Root Cause & Verified Fix

### Evidence-Based Root Cause Diagnosis
Upon code audit of the original `index.html`:
1. **The Missing Startup Invocation**: Line 510 defined `function load() { ... }` to read from `localStorage.getItem("rm_resources_v2")`. However, `load()` was **never called** upon application initialization! `resources` was declared as `let resources = [];` and remained empty on every reload.
2. **The Destructive First-Write Overwrite**: When the user added a new bookmark, `resources.push(...)` ran, followed by `persist()`, which executed `localStorage.setItem(STORE_KEY, JSON.stringify(resources))`. Because `resources` started as an empty array, saving a single bookmark immediately **overwrote and wiped out** all prior bookmarks in `localStorage`.
3. **Absence of Legacy Key Migration**: The code checked only `rm_resources_v2` and ignored previous keys (`rm_resources`, `rm_resources_v1`, `bookmarks`, `resources`).
4. **No Secondary Storage Fallback**: When `localStorage` exceeded quota or was disabled in sandboxed/incognito contexts, data was lost on session end.

### Minimal Verified Permanent Fix
1. **Startup Invocation (`index.html`)**: Added `resources = load();` immediately prior to initial `render()`.
2. **Multi-Key Safe Migration**: Enhanced `load()` to automatically check and migrate records from `rm_resources_v2`, `rm_resources`, `rm_resources_v1`, `bookmarks`, and `resources`.
3. **IndexedDB Secondary Storage**: Integrated IndexedDB as a resilient secondary storage tier (`ResourceManagerDB.vault`) to protect large libraries exceeding localStorage limits.
4. **Cross-Tab Synchronization**: Added `window.addEventListener("storage", ...)` so additions and updates in one tab immediately synchronize across all open tabs.
5. **Atomic File & PostgreSQL Backend**: Persistent REST server (`/api/resources`, `/api/sync`) with dual storage (PostgreSQL when configured, atomic disk writes to `./data/db.json` locally).

---

## ✨ Features

- 🔖 **Offline-First & Cloud-Synced** — Works 100% offline; syncs with cloud account when connected.
- 🐘 **PostgreSQL & Dual-Storage Architecture** — Seamless transition between Cloud SQL / PostgreSQL and local persistent storage.
- 🧩 **Manifest V3 Browser Extension** — 1-click capture from Chrome, Edge, and Brave with title, URL, and page highlight detection.
- 🔐 **Zero-Knowledge AES-256-GCM Encryption** — Encrypt exports (`.rmvault`) using PBKDF2 with 100,000 iterations and random salt/IV.
- 📦 **Automated Backups & Point-in-Time Recovery** — Scheduled snapshots with SHA-256 integrity verification and restore diff previews.
- 🏷️ **Multi-Label Tags & Hierarchical Categories** — Add multiple tags (`#dev`, `#api`, `#ai`) to each bookmark with instant filtering.
- 🗂️ **Bulk Actions Toolbar** — Batch delete, batch categorize, batch tag, and batch export.
- ⚡ **Duplicate Detection** — Automatic scanner flags duplicate URLs with 1-click merge/deduplication.
- 🌐 **Netscape Bookmark HTML Support** — Import and export bookmarks compatible with Chrome, Firefox, Safari, and Edge.
- 🎬 **Cinematic Dark Theme** — Teal/orange accents, smooth spring animations, keyboard shortcuts (`Ctrl+K`, `Ctrl+N`, `Ctrl+B`, `Ctrl+S`, `?`).

---

## 🐘 Cloud Sync & PostgreSQL

The server automatically detects whether PostgreSQL environment variables are configured.

### PostgreSQL Configuration
Provide the following in your environment or `.env`:
```env
PORT=3000
SQL_HOST=/cloudsql/project:region:instance   # or localhost
SQL_USER=rm_user
SQL_PASSWORD=secret_password
SQL_DB_NAME=resource_manager
# Alternatively:
# DATABASE_URL=postgres://user:pass@host:5432/dbname
```

When PostgreSQL is active:
- Tables `rm_users`, `rm_resources`, and `rm_backups` are created automatically with indexes.
- Data is stored in relational tables with foreign keys and timestamps.
- When PostgreSQL is not present, the server uses `./data/db.json` with write-ahead atomic file replacement.

---

## 🧩 Browser Extension

A Manifest V3 extension is located in `/extension/`.

### Installation
1. Open `chrome://extensions/` in Chrome, Edge, or Brave.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `/extension` directory.
4. Click the teal diamond icon or press `Alt + Shift + S` on any webpage to save it with highlights directly to your vault!

---

## 🔐 Zero-Knowledge Encryption

| Feature | Implementation | Guarantee |
|---|---|---|
| **Vault Encryption** | AES-256-GCM (Web Crypto API) | Zero-Knowledge; passphrase never leaves device |
| **Key Derivation** | PBKDF2 (100,000 rounds, SHA-256, 16-byte random salt) | Resistant to brute-force attacks |
| **Integrity Check** | GCM 128-bit authentication tag | Guarantees tamper detection |
| **Backup Checksum** | SHA-256 cryptographic digest | Verifies snapshot integrity before restore |

---

## 📦 Automated Backups & Recovery

- **Scheduled Snapshots**: Background daemon creates snapshots every 6 hours if changes have occurred.
- **Restore Preview**: Calculates exact differences (+added, ~updated, unchanged) before applying changes.
- **Rollback Checkpoints**: Creates an automated safety checkpoint prior to any restore action.

---

## 🚀 Getting Started

### Installation & Run

```bash
# Install dependencies
npm install

# Run dev server on port 3000
npm run dev

# Run automated test suites (Security + Platform)
npm test
```

Access the app in your browser at `http://localhost:3000`.

---

## 🧪 Automated Tests

The project includes an **83-test automated test suite**:

```bash
npm test
```

- **62 Security Tests (`security_test.mjs`)**: XSS evasion, URL scheme whitelisting, CSP hardening, attribute breakout, quota handling.
- **21 Platform Tests (`test_platform.mjs`)**: Startup persistence verification, restart survival, legacy key migration, Cloud sync conflict resolution, extension capture, AES-256-GCM encryption/decryption, tamper detection, and backup restore workflows.
