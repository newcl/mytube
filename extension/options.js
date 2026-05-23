const DEFAULT_API_BASE = 'https://mytubeapi.elladali.com';

// Restore saved values
chrome.storage.local.get(['apiBase', 'token'], (items) => {
  document.getElementById('apiBase').value = items.apiBase || DEFAULT_API_BASE;
  document.getElementById('token').value = items.token || '';
});

document.getElementById('save').addEventListener('click', () => {
  const apiBase = document.getElementById('apiBase').value.trim().replace(/\/+$/, '');
  const token = document.getElementById('token').value.trim();

  chrome.storage.local.set({ apiBase, token }, () => {
    const status = document.getElementById('status');
    status.textContent = '✓ Saved';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
