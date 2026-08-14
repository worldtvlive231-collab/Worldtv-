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

  // Track download clicks
  function trackDownload(event) {
    const href = event?.currentTarget?.href || event?.currentTarget?.getAttribute('data-download-url');
    const referrer = document.referrer || '';
    
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

  // Initialize
  document.addEventListener('DOMContentLoaded', trackPageView);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView);
  } else {
    trackPageView();
  }

  // Expose trackDownload globally
  window.trackDownload = trackDownload;
})();

