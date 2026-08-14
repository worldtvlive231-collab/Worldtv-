// World TV Analytics Tracking Script
// Lightweight, non-blocking visitor analytics

(function() {
  'use strict';

  // Track page view
  function trackPageView() {
    const pathname = window.location.pathname;
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/')) {
      return; // Don't track admin or API
    }

    const referrer = document.referrer || '';
    
    try {
      navigator.sendBeacon('/api/analytics/visit', JSON.stringify({
        eventType: 'page_view',
        pagePath: pathname,
        referrer: referrer
      }));
    } catch (e) {
      // Fallback to fetch
      fetch('/api/analytics/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'page_view',
          pagePath: pathname,
          referrer: referrer
        }),
        keepalive: true
      }).catch(() => {});
    }
  }

  // Track download clicks
  function trackDownload(event) {
    const href = event.currentTarget?.href || event.currentTarget?.getAttribute('data-download-url');
    const referrer = document.referrer || '';
    
    try {
      navigator.sendBeacon('/api/analytics/visit', JSON.stringify({
        eventType: 'download_click',
        pagePath: window.location.pathname,
        referrer: referrer
      }));
    } catch (e) {
      fetch('/api/analytics/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'download_click',
          pagePath: window.location.pathname,
          referrer: referrer
        }),
        keepalive: true
      }).catch(() => {});
    }
    
    // Don't prevent default - let the download proceed
  }

  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Track page view
    trackPageView();

    // Attach click handlers to download buttons
    const downloadButtons = document.querySelectorAll('[data-track-download]');
    downloadButtons.forEach(btn => {
      btn.addEventListener('click', trackDownload, false);
    });

    // Also track .download-btn, #download-btn, or .app-download classes
    const appDownloadLinks = document.querySelectorAll('.download-link, .app-download, [href$=".apk"]');
    appDownloadLinks.forEach(link => {
      link.addEventListener('click', trackDownload, false);
    });
  }
})();

