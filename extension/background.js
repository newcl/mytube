const DEFAULT_API_BASE = 'https://api.mytube.elladali.com';

chrome.action.onClicked.addListener(async (tab) => {
  const { apiBase, token } = await chrome.storage.local.get(['apiBase', 'token']);
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const tok = token || '';

  if (!tok) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'MyTube',
      message: 'Please set your API token in the extension Options.',
    });
    return;
  }

  const url = tab.url || '';
  if (!url) return;

  try {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (res.ok) {
      const data = await res.json();
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'MyTube',
        message: `Queued! Job #${data.id}`,
      });
    } else {
      const text = await res.text();
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'MyTube — Error',
        message: `Failed (${res.status}): ${text.slice(0, 80)}`,
      });
    }
  } catch (err) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'MyTube — Error',
      message: `Network error: ${String(err).slice(0, 80)}`,
    });
  }
});
