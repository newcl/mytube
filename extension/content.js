(function () {
  'use strict';

  var btn = null;
  var currentVideoUrl = null;
  var hideTimer = null;

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(function () {
      if (btn) btn.style.display = 'none';
    }, 400);
  }

  function getOrCreateBtn() {
    if (btn) return btn;

    btn = document.createElement('button');
    btn.textContent = '+ Queue';
    btn.dataset.state = 'idle';
    Object.assign(btn.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.82)',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      padding: '6px 12px',
      fontSize: '13px',
      fontWeight: '700',
      fontFamily: 'Roboto, sans-serif',
      cursor: 'pointer',
      lineHeight: '1.4',
      display: 'none',
      pointerEvents: 'all',
      userSelect: 'none',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    });

    btn.addEventListener('mouseenter', function () {
      cancelHide();
      if (btn.dataset.state === 'idle') btn.style.background = 'rgba(200,0,0,0.9)';
    });
    btn.addEventListener('mouseleave', function () {
      if (btn.dataset.state === 'idle') btn.style.background = 'rgba(0,0,0,0.82)';
      stopTracking();
      scheduleHide();
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!currentVideoUrl || btn.dataset.state !== 'idle') return;
      btn.dataset.state = 'loading';
      btn.textContent = '...';
      btn.style.background = 'rgba(0,0,0,0.82)';
      chrome.runtime.sendMessage({ type: 'QUEUE_URL', url: currentVideoUrl }, function (res) {
        if (chrome.runtime.lastError || !res) {
          console.warn('[MyTube] error:', chrome.runtime.lastError);
          showResult(false); return;
        }
        if (!res.ok) console.warn('[MyTube] failed:', res.error);
        showResult(res.ok);
      });
    });

    document.body.appendChild(btn);
    return btn;
  }

  function showResult(ok) {
    btn.dataset.state = 'done';
    btn.textContent = ok ? 'Queued!' : 'Failed';
    btn.style.background = ok ? 'rgba(22,160,22,0.9)' : 'rgba(200,0,0,0.9)';
    setTimeout(function () {
      if (!btn) return;
      btn.dataset.state = 'idle';
      btn.textContent = '+ Queue';
      btn.style.background = 'rgba(0,0,0,0.82)';
      btn.style.display = 'none';
    }, 2000);
  }

  var activeAnchor = null;
  var rafId = null;

  // Keep button centered on the anchor every frame so it follows YouTube's
  // hover-preview scale/translate animation reliably.
  function trackLoop() {
    if (!btn || btn.style.display === 'none' || !activeAnchor) { rafId = null; return; }
    var rect = activeAnchor.getBoundingClientRect();
    btn.style.left = (rect.left + rect.width  / 2) + 'px';
    btn.style.top  = (rect.top  + rect.height / 2) + 'px';
    rafId = requestAnimationFrame(trackLoop);
  }

  function startTracking(anchor) {
    activeAnchor = anchor;
    if (!rafId) rafId = requestAnimationFrame(trackLoop);
  }

  function stopTracking() {
    activeAnchor = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function attachToAnchor(anchor) {
    if (anchor._mytubeAttached) return;
    anchor._mytubeAttached = true;

    anchor.addEventListener('mouseenter', function () {
      var href = anchor.getAttribute('href') || '';
      if (!href) return;
      cancelHide();
      currentVideoUrl = href.startsWith('http')
        ? href.split('&')[0]
        : 'https://www.youtube.com' + href.split('&')[0];

      var b = getOrCreateBtn();
      b.style.transform = 'translate(-50%, -50%)';
      b.dataset.state = 'idle';
      b.textContent = '+ Queue';
      b.style.background = 'rgba(0,0,0,0.82)';
      b.style.display = 'block';
      startTracking(anchor);
    });
    anchor.addEventListener('mouseleave', function () {
      stopTracking();
      scheduleHide();
    });
  }

  var VIDEO_RE = /\/(watch\?v=|shorts\/|live\/)/;

  function isThumbnailAnchor(a) {
    var href = a.getAttribute('href') || '';
    if (!VIDEO_RE.test(href)) return false;
    return !!(a.querySelector('img, yt-image, canvas'));
  }

  function scanAnchors() {
    var all = document.querySelectorAll('a[href]');
    for (var i = 0; i < all.length; i++) {
      if (isThumbnailAnchor(all[i])) attachToAnchor(all[i]);
    }
  }

  scanAnchors();
  setTimeout(scanAnchors, 1000);
  setTimeout(scanAnchors, 3000);

  var scanTimer = null;
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length) {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scanAnchors, 300);
        return;
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
