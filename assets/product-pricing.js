(() => {
  "use strict";

  const GHANA_PRICE_GHS = 850;
  const WORLD_PRICE_USD = 100;

  function normalizeCountry(value){
    return String(value || "").trim().toLowerCase();
  }

  function isGhana(country){
    const c = normalizeCountry(country);
    return c === "ghana" || c === "gh" || c === "gha";
  }

  function isTvBoxProduct(product){
    return /android\s*tv\s*box|world\s*tv\s*box/i.test(String(product?.name || product || ""));
  }

  async function detectCountry(){
    try{
      const r = await fetch(`/api/visitor-country?_=${Date.now()}`,{cache:"no-store",headers:{Accept:"application/json"}});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return String(d?.country || d?.data?.country || "").trim();
    }catch(_){
      return "";
    }
  }

  function currentCurrency(){
    return window.CurrencyConverter?.activeCurrency || "USD";
  }

  function localFromUsd(usd,currency){
    const cc = window.CurrencyConverter;
    if(!cc || currency === "USD") return Number(usd);
    const usdRate = Number(cc.exchangeRates?.USD);
    const targetRate = Number(cc.exchangeRates?.[currency]);
    if(!Number.isFinite(usdRate) || usdRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) return null;
    return Number(usd) * targetRate / usdRate;
  }

  function format(amount,currency){
    if(window.CurrencyConverter?.format) return window.CurrencyConverter.format(amount,currency);
    if(currency === "USD") return `$${Number(amount).toFixed(2)}`;
    if(currency === "GHS") return `GH₵${Number(amount).toFixed(2)}`;
    return `${currency} ${Number(amount).toFixed(2)}`;
  }

  function quote({country,currency=currentCurrency(),quantity=1}={}){
    const qty = Math.max(1, Number(quantity) || 1);
    if(isGhana(country)){
      return {
        market:"ghana",
        currency:"GHS",
        amount:GHANA_PRICE_GHS * qty,
        primary:format(GHANA_PRICE_GHS * qty,"GHS"),
        secondary:qty === 1 ? "Free delivery & shipping" : `Quantity ${qty} • Free delivery & shipping`,
        usd:null,
        ghs:GHANA_PRICE_GHS * qty
      };
    }

    const usd = WORLD_PRICE_USD * qty;
    const selected = currency && currency !== "GHS" ? currency : "USD";
    const converted = localFromUsd(usd,selected);
    return {
      market:"worldwide",
      currency:selected,
      amount:converted ?? usd,
      primary:converted == null ? `$${usd.toFixed(2)} USD` : `${format(converted,selected)}${selected === "USD" ? " USD" : ` ${selected}`}`,
      secondary:selected === "USD" ? "Free shipping" : `≈ $${usd.toFixed(2)} USD • Free shipping`,
      usd,
      ghs:null
    };
  }

  async function renderElement(el,{country,quantity=1}={}){
    if(!el) return null;
    const resolvedCountry = country || await detectCountry();
    const q = quote({country:resolvedCountry,currency:currentCurrency(),quantity});
    el.innerHTML = `${q.primary}<small>${q.secondary}</small>`;
    el.dataset.market = q.market;
    return q;
  }

  async function applyProductCards(root=document){
    const country = await detectCountry();
    const nodes = [...root.querySelectorAll('[data-worldtv-product-price="tv-box"]')];
    for(const el of nodes){
      const q = quote({country,currency:currentCurrency(),quantity:Number(el.dataset.quantity || 1)});
      el.innerHTML = `<strong>${q.primary}</strong><br><span class="currency-converted">${q.secondary}</span>`;
    }
  }

  window.WorldTvProductPricing = {
    GHANA_PRICE_GHS,
    WORLD_PRICE_USD,
    INTERNATIONAL_PRICE_USD: WORLD_PRICE_USD,
    isGhana,
    isTvBoxProduct,
    detectCountry,
    quote,
    renderElement,
    applyProductCards
  };

  window.addEventListener("worldtv:currency-changed",()=>applyProductCards().catch(()=>{}));
})();
