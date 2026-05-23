// Fetch lives here so it runs in the service worker, which bypasses CORS
// for URLs declared in host_permissions.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'QUEUE_URL') return false;

  const { apiBase, token, url } = msg;

  fetch(`${apiBase}/api/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
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

  return true; // keep channel open for async response
});
