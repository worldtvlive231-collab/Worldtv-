(() => {
  "use strict";

  const path = window.location.pathname || "/";
  if (!(path === "/" || path === "/index.html")) return;
  if (window.__WORLD_TV_MATCH_TICKER__) return;
  window.__WORLD_TV_MATCH_TICKER__ = true;

  const style = document.createElement("style");
  style.textContent = `
    .wtv-match-ticker{position:relative;z-index:25;background:#17130a;color:#fff;border-bottom:1px solid rgba(255,255,255,.12);overflow:hidden}
    .wtv-match-ticker-inner{display:flex;align-items:center;min-height:42px;overflow:hidden;white-space:nowrap}
    .wtv-match-ticker-label{flex:0 0 auto;position:relative;z-index:2;padding:0 16px;font-size:12px;font-weight:900;letter-spacing:.35px;color:#1f1600;background:linear-gradient(135deg,#f4c542,#d89a00);height:42px;display:flex;align-items:center;box-shadow:12px 0 20px rgba(0,0,0,.16)}
    .wtv-match-ticker-window{overflow:hidden;flex:1;min-width:0}
    .wtv-match-ticker-track{display:inline-flex;align-items:center;gap:42px;min-width:max-content;padding-left:100%;animation:wtvTickerMove var(--wtv-ticker-duration,45s) linear infinite;will-change:transform}
    .wtv-match-ticker:hover .wtv-match-ticker-track{animation-play-state:paused}
    .wtv-match-item{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:750;color:#fff}
    .wtv-match-item .league{color:#f7cb52;font-weight:900}
    .wtv-match-item .time{color:#d5ccba;font-size:12px}
    .wtv-match-item .vs{color:#9e9688;font-size:11px;font-weight:900}
    @keyframes wtvTickerMove{from{transform:translateX(0)}to{transform:translateX(-100%)}}
    @media(max-width:620px){.wtv-match-ticker-label{padding:0 10px;font-size:10px}.wtv-match-ticker-inner{min-height:38px}.wtv-match-ticker-label{height:38px}.wtv-match-item{font-size:12px}.wtv-match-ticker-track{gap:28px}}
    @media(prefers-reduced-motion:reduce){.wtv-match-ticker-track{animation:none;padding-left:12px;overflow-x:auto}}
  `;
  document.head.appendChild(style);

  const ticker = document.createElement("div");
  ticker.className = "wtv-match-ticker";
  ticker.innerHTML = `
    <div class="wtv-match-ticker-inner">
      <div class="wtv-match-ticker-label">⚽ UPCOMING MATCHES</div>
      <div class="wtv-match-ticker-window"><div class="wtv-match-ticker-track" id="wtvMatchTickerTrack"><span class="wtv-match-item">Loading upcoming matches…</span></div></div>
    </div>`;

  function mount(){
    const header = document.querySelector("header");
    if (!header || ticker.isConnected) return;
    header.insertAdjacentElement("afterend", ticker);
    loadTicker();
  }

  function esc(v){return String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));}
  function fmtKickoff(v){
    if(!v) return "";
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  }

  async function loadTicker(){
    const track = document.getElementById("wtvMatchTickerTrack");
    if(!track) return;
    try{
      const r = await fetch(`/api/football/upcoming?_=${Date.now()}`,{cache:"no-store",headers:{Accept:"application/json"}});
      const d = await r.json();
      const matches = Array.isArray(d?.matches) ? d.matches.slice(0,12) : [];
      if(!matches.length){
        track.innerHTML = '<span class="wtv-match-item">No upcoming matches right now.</span>';
        track.style.setProperty("--wtv-ticker-duration","28s");
        return;
      }
      track.innerHTML = matches.map(m => `<span class="wtv-match-item"><span class="league">${esc(m.league || "Football")}</span><span>${esc(m.home_team || "Home")}</span><span class="vs">VS</span><span>${esc(m.away_team || "Away")}</span><span class="time">${esc(fmtKickoff(m.kickoff))}</span></span>`).join("");
      track.style.setProperty("--wtv-ticker-duration", Math.max(34, matches.length * 5) + "s");
    }catch(e){
      track.innerHTML = '<span class="wtv-match-item">Upcoming match updates unavailable right now.</span>';
    }
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once:true});
  else mount();
  setInterval(loadTicker, 60000);
})();
