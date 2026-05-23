const DEFAULT_API_BASE = 'https://mytubeapi.elladali.com';

const statusEl = document.getElementById('status');

function show(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls;
}

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

(async () => {
  const { apiBase, token } = await chrome.storage.local.get(['apiBase', 'token']);
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const tok = token || '';

  if (!tok) {
    show('No token set — click Settings to configure.', 'warn');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  if (!url) {
    show('Could not read current tab URL.', 'error');
    return;
  }

  show('Queuing…', 'loading');

  // Send to background service worker — it makes the fetch, bypassing CORS.
  chrome.runtime.sendMessage(
    { type: 'QUEUE_URL', apiBase: base, token: tok, url },
    (result) => {
      if (chrome.runtime.lastError) {
        show(`Extension error: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }
      if (result.ok) {
        show(`✓ Queued — Job #${result.jobId}`, 'success');
        setTimeout(() => window.close(), 1800);
      } else {
        show(`Error: ${result.error}`, 'error');
      }
    },
  );
})();
