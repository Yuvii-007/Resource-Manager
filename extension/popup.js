const API_BASE = 'http://localhost:3000/api';

document.addEventListener('DOMContentLoaded', async () => {
  const titleInput = document.getElementById('title');
  const urlInput = document.getElementById('url');
  const notesInput = document.getElementById('notes');
  const catInput = document.getElementById('category');
  const tagsInput = document.getElementById('tags');
  const catList = document.getElementById('catList');
  const form = document.getElementById('saveForm');
  const savedIndicator = document.getElementById('savedIndicator');
  const openApp = document.getElementById('openApp');
  const statusBadge = document.getElementById('statusBadge');

  openApp.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'http://localhost:3000/' });
    } else {
      window.open('http://localhost:3000/', '_blank');
    }
  });

  // Query active tab in browser
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        titleInput.value = tab.title || '';
        urlInput.value = tab.url || '';

        // Try extracting selected text from page
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection().toString()
          });
          if (results && results[0] && results[0].result) {
            notesInput.value = results[0].result.trim();
          }
        } catch (e) {
          // Content script injection restricted on some system pages
        }
      }
    } catch (e) {
      console.warn('Could not query active tab:', e);
    }
  }

  // Load existing categories & tags for autocomplete
  try {
    const res = await fetch(`${API_BASE}/extension/autocomplete`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.categories)) {
        catList.innerHTML = data.categories.map(c => `<option value="${c}">`).join('');
      }
      statusBadge.textContent = 'Connected';
      statusBadge.style.color = '#14B8A6';
    }
  } catch (err) {
    statusBadge.textContent = 'Local Queue';
    statusBadge.style.color = '#F97316';
  }

  // Handle Form Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    savedIndicator.textContent = 'Saving...';

    const tags = tagsInput.value
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    const payload = {
      name: titleInput.value.trim(),
      url: urlInput.value.trim(),
      category: catInput.value.trim() || 'General',
      notes: notesInput.value.trim(),
      tags
    };

    try {
      const res = await fetch(`${API_BASE}/extension/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        savedIndicator.textContent = 'Saved to vault!';
        setTimeout(() => window.close(), 1200);
      } else {
        savedIndicator.textContent = 'Save failed';
      }
    } catch (err) {
      // Store in chrome.storage.local for sync later if server unreachable
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['rm_offline_queue'], (data) => {
          const queue = data.rm_offline_queue || [];
          queue.push(payload);
          chrome.storage.local.set({ rm_offline_queue: queue }, () => {
            savedIndicator.textContent = 'Queued offline';
            setTimeout(() => window.close(), 1400);
          });
        });
      } else {
        savedIndicator.textContent = 'Network error';
      }
    }
  });
});
