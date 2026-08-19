(() => {
  "use strict";

  if (window.__WORLD_TV_ANALYTICS_V2__) return;
  window.__WORLD_TV_ANALYTICS_V2__ = true;

  const path = window.location.pathname || "/";
  if (/^\/(?:admin|reseller)(?:\/|$)/i.test(path)) return;

  if (path === "/" || path === "/index.html") {
    const tickerScript = document.createElement("script");
    tickerScript.src = "/assets/header-match-ticker.js?v=1";
    tickerScript.defer = true;
    document.head.appendChild(tickerScript);
  }

  const HEARTBEAT_MS = 20000;
  let timer = null;

  async function heartbeat() {
    if (document.visibilityState === "hidden") return;

    try {
      await fetch("/api/analytics/v2/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        body: JSON.stringify({
          pagePath: window.location.pathname || "/"
        })
      });
    } catch (e) {
      // Analytics must never interrupt the customer experience.
    }
  }

  function start() {
    if (timer) clearInterval(timer);
    heartbeat();
    timer = setInterval(heartbeat, HEARTBEAT_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
  });

  window.addEventListener("pageshow", () => {
    if (document.visibilityState !== "hidden") heartbeat();
  });

  window.addEventListener("pagehide", stop, { once: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
