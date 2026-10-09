// Background service worker for Resource Manager extension
const API_BASE = 'http://localhost:3000/api';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-vault',
    title: 'Save to Resource Manager Vault',
    contexts: ['page', 'selection', 'link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-vault') {
    const url = info.linkUrl || info.pageUrl || tab.url;
    const name = tab.title || new URL(url).hostname;
    const notes = info.selectionText || '';

    try {
      await fetch(`${API_BASE}/extension/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          notes,
          category: 'Quick Capture',
          tags: ['browser-extension']
        })
      });
    } catch (e) {
      console.warn('Background capture failed, saving offline:', e);
      chrome.storage.local.get(['rm_offline_queue'], (data) => {
        const queue = data.rm_offline_queue || [];
        queue.push({ name, url, notes, category: 'Quick Capture', tags: ['browser-extension'] });
        chrome.storage.local.set({ rm_offline_queue: queue });
      });
    }
  }
});

// Periodic offline queue flusher
chrome.alarms?.create('sync-offline-queue', { periodInMinutes: 5 });
chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sync-offline-queue') {
    chrome.storage.local.get(['rm_offline_queue'], async (data) => {
      const queue = data.rm_offline_queue || [];
      if (queue.length === 0) return;

      const remaining = [];
      for (const item of queue) {
        try {
          const res = await fetch(`${API_BASE}/extension/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          if (!res.ok) remaining.push(item);
        } catch (e) {
          remaining.push(item);
        }
      }
      chrome.storage.local.set({ rm_offline_queue: remaining });
    });
  }
});
