(() => {
  "use strict";

  const path = window.location.pathname || "/";
  if (!(path === "/" || path === "/index.html")) return;
  if (window.__WORLD_TV_MATCH_TICKER__) return;
  window.__WORLD_TV_MATCH_TICKER__ = true;

  const style = document.createElement("style");
  style.textContent = `
    .wtv-match-ticker{position:relative;z-index:25;background:#17130a;color:#fff;border-bottom:1px solid rgba(255,255,255,.12);overflow:hidden}
    .wtv-match-ticker-inner{display:flex;align-items:center;min-height:46px;overflow:hidden;white-space:nowrap}
    .wtv-match-ticker-label{flex:0 0 auto;position:relative;z-index:2;padding:0 16px;font-size:12px;font-weight:900;letter-spacing:.35px;color:#1f1600;background:linear-gradient(135deg,#f4c542,#d89a00);height:46px;display:flex;align-items:center;box-shadow:12px 0 20px rgba(0,0,0,.16)}
    .wtv-match-ticker-window{overflow:hidden;flex:1;min-width:0}
    .wtv-match-ticker-track{display:inline-flex;align-items:center;gap:42px;min-width:max-content;padding-left:100%;animation:wtvTickerMove var(--wtv-ticker-duration,45s) linear infinite;will-change:transform}
    .wtv-match-ticker:hover .wtv-match-ticker-track{animation-play-state:paused}
    .wtv-match-item{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:750;color:#fff}
    .wtv-match-item .league{color:#f7cb52;font-weight:900;margin-right:2px}
    .wtv-match-item .time{color:#d5ccba;font-size:12px;margin-left:2px}
    .wtv-match-item .vs{color:#9e9688;font-size:11px;font-weight:900;margin:0 2px}
    .wtv-match-team{display:inline-flex;align-items:center;gap:6px}
    .wtv-match-team-logo{width:28px;height:28px;object-fit:contain;border-radius:50%;background:#fff;padding:2px;border:1px solid rgba(255,255,255,.22);box-shadow:0 1px 4px rgba(0,0,0,.28);flex:0 0 28px}
    .wtv-match-team-logo-fallback{width:28px;height:28px;border-radius:50%;display:inline-grid;place-items:center;background:#332b1c;border:1px solid rgba(255,255,255,.18);font-size:13px;flex:0 0 28px}
    .wtv-hero-product-copy{padding:2px 0 0}
    .wtv-hero-product-copy h2{font-size:25px;line-height:1.15;margin:0 0 12px;color:#17130a}
    .wtv-hero-product-copy p{font-size:14px;line-height:1.6;color:#625b4c;margin:0 0 14px}
    .wtv-hero-product-copy .wtv-product-highlights{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 14px}
    .wtv-hero-product-copy .wtv-product-highlights span{font-size:11px;font-weight:850;padding:7px 9px;border-radius:999px;background:#fff7d8;border:1px solid #ecd580;color:#4b3900}
    .wtv-hero-product-price{font-size:31px;font-weight:950;color:#17130a;margin:6px 0 2px}
    .wtv-hero-product-price small{display:block;font-size:12px;font-weight:700;color:#7a705d;margin-top:3px}
    .wtv-hero-buy-btn{width:100%;margin-top:12px;font-size:16px}
    @keyframes wtvTickerMove{from{transform:translateX(0)}to{transform:translateX(-100%)}}
    @media(max-width:620px){.wtv-match-ticker-label{padding:0 10px;font-size:10px}.wtv-match-ticker-inner{min-height:42px}.wtv-match-ticker-label{height:42px}.wtv-match-item{font-size:12px}.wtv-match-ticker-track{gap:28px}.wtv-match-team-logo,.wtv-match-team-logo-fallback{width:24px;height:24px;flex-basis:24px}.wtv-hero-product-copy h2{font-size:22px}}
    @media(prefers-reduced-motion:reduce){.wtv-match-ticker-track{animation:none;padding-left:12px;overflow-x:auto}}
  `;
  document.head.appendChild(style);

  const ticker = document.createElement("div");
  ticker.className = "wtv-match-ticker";
  ticker.innerHTML = `<div class="wtv-match-ticker-inner"><div class="wtv-match-ticker-label">⚽ UPCOMING MATCHES</div><div class="wtv-match-ticker-window"><div class="wtv-match-ticker-track" id="wtvMatchTickerTrack"><span class="wtv-match-item">Loading upcoming matches…</span></div></div></div>`;

  let pricingPromise;
  function ensureProductPricing(){
    if(window.WorldTvProductPricing) return Promise.resolve(window.WorldTvProductPricing);
    if(pricingPromise) return pricingPromise;
    pricingPromise = new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-wtv-product-pricing]');
      if(existing){existing.addEventListener('load',()=>resolve(window.WorldTvProductPricing));existing.addEventListener('error',reject);return;}
      const s=document.createElement('script');s.src='/assets/product-pricing.js?v=2';s.dataset.wtvProductPricing='1';s.onload=()=>resolve(window.WorldTvProductPricing);s.onerror=reject;document.head.appendChild(s);
    });
    return pricingPromise;
  }

  function mount(){const header=document.querySelector("header");if(header&&!ticker.isConnected)header.insertAdjacentElement("afterend",ticker);loadTicker();upgradeHeroProductCard();}
  function esc(v){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));}
  function fmtKickoff(v){if(!v)return"";const d=new Date(v);if(Number.isNaN(d.getTime()))return"";return d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
  function firstValue(...values){return values.find(v=>typeof v==="string"&&v.trim())||"";}
  function logoUrl(m,side){const team=m?.[side]||m?.[`${side}_team_data`]||{};return firstValue(m?.[`${side}_logo`],m?.[`${side}_team_logo`],m?.[`${side}_badge`],m?.[`${side}_image`],m?.[`${side}_img`],team?.logo,team?.logo_url,team?.badge,team?.image,team?.img);}
  function logoHtml(url,name){if(!url)return'<span class="wtv-match-team-logo-fallback">⚽</span>';return `<img class="wtv-match-team-logo" src="${esc(url)}" alt="${esc(name)} logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;wtv-match-team-logo-fallback&quot;>⚽</span>'">`;}

  async function renderHeroPrice(){const price=document.getElementById('wtvHeroBoxPrice');if(!price)return;try{const pricing=await ensureProductPricing();if(pricing)await pricing.renderElement(price);}catch(_){price.innerHTML='GH₵850.00<small>Free shipping • Outside Ghana: $100 USD equivalent</small>';}}

  async function upgradeHeroProductCard(){
    const card=document.querySelector(".hero-card");if(!card||card.dataset.productPromoReady==="1")return;card.dataset.productPromoReady="1";
    const top=card.querySelector(".hero-card-top");const oldPrice=card.querySelector(".hero-price");const oldButton=card.querySelector("a.btn");if(top)top.remove();if(oldPrice)oldPrice.remove();if(oldButton)oldButton.remove();
    const copy=document.createElement("div");copy.className="wtv-hero-product-copy";copy.innerHTML=`<h2>No Android or Google Smart TV? No Problem! 📺</h2><p>Turn any TV with an HDMI port into a smart entertainment hub with our <strong>WORLD TV Box</strong>.</p><p>Enjoy <strong>4,000+ Live TV Channels</strong>, <strong>6,000+ Movies &amp; Series</strong>, Kids &amp; Anime, plus Live Sports — all in one box.</p><div class="wtv-product-highlights"><span>📺 4,000+ Live Channels</span><span>🎬 6,000+ Movies &amp; Series</span><span>👧 Kids &amp; Anime</span><span>⚽ Live Sports</span><span>🚚 Free Shipping</span></div><div class="wtv-hero-product-price" id="wtvHeroBoxPrice">Loading price…<small>Ghana: GH₵850 • USA & other countries: $100 USD equivalent • Free shipping</small></div><a class="btn primary wtv-hero-buy-btn" id="wtvHeroBuyNow" href="/products.html">🛒 Buy Now</a>`;card.appendChild(copy);
    try{const r=await fetch(`/api/products?_=${Date.now()}`,{cache:"no-store",headers:{Accept:"application/json"}});const d=await r.json();const products=Array.isArray(d?.products)?d.products:Array.isArray(d)?d:[];const product=products.find(p=>/android\s*tv\s*box|world\s*tv\s*box/i.test(String(p?.name||"")))||products[0];if(product){const buy=document.getElementById("wtvHeroBuyNow");if(buy&&product.id!=null)buy.href=`/order.html?product=${encodeURIComponent(product.id)}`;const image=document.getElementById("heroProductImage");const imageUrl=product.image_url||product.image||"";if(image&&imageUrl)image.src=imageUrl;}}catch(_){ }
    renderHeroPrice();setTimeout(renderHeroPrice,800);
  }

  async function loadTicker(){const track=document.getElementById("wtvMatchTickerTrack");if(!track)return;try{const r=await fetch(`/api/football/upcoming?_=${Date.now()}`,{cache:"no-store",headers:{Accept:"application/json"}});const d=await r.json();const matches=Array.isArray(d?.matches)?d.matches.slice(0,12):[];if(!matches.length){track.innerHTML='<span class="wtv-match-item">No upcoming matches right now.</span>';track.style.setProperty("--wtv-ticker-duration","28s");return;}track.innerHTML=matches.map(m=>{const homeName=m.home_team||"Home";const awayName=m.away_team||"Away";return `<span class="wtv-match-item"><span class="league">${esc(m.league||"Football")}</span><span class="wtv-match-team">${logoHtml(logoUrl(m,"home"),homeName)}<span>${esc(homeName)}</span></span><span class="vs">VS</span><span class="wtv-match-team">${logoHtml(logoUrl(m,"away"),awayName)}<span>${esc(awayName)}</span></span><span class="time">${esc(fmtKickoff(m.kickoff))}</span></span>`;}).join("");track.style.setProperty("--wtv-ticker-duration",Math.max(38,matches.length*5.5)+"s");}catch(e){track.innerHTML='<span class="wtv-match-item">Upcoming match updates unavailable right now.</span>';}}

  window.addEventListener("worldtv:currency-changed",renderHeroPrice);if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();setInterval(loadTicker,60000);
})();
