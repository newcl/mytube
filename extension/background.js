// Fetch lives here so it runs in the service worker, which bypasses CORS
// for URLs declared in host_permissions.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'QUEUE_URL') return false;

  const doFetch = (apiBase, token) => {
    fetch(`${apiBase}/api/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: msg.url }),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          sendResponse({ ok: true, jobId: data.id });
        } else {
          const text = await res.text();
          sendResponse({ ok: false, error: `HTTP ${res.status}: ${text.trim().slice(0, 200)}` });
        }
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
  };

  if (msg.apiBase && msg.token) {
    // Called from popup.js (passes credentials directly)
    doFetch(msg.apiBase, msg.token);
  } else {
    // Called from content.js (reads credentials from storage)
    chrome.storage.local.get(['apiBase', 'token'], (items) => {
      const base = items.apiBase || 'https://mytubeapi.elladali.com';
      const tok = items.token || '';
      if (!tok) {
        sendResponse({ ok: false, error: 'No token — open extension Options to configure.' });
        return;
      }
      doFetch(base, tok);
    });
  }

  return true; // keep channel open for async response
});
