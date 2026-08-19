/**
 * World TV Dynamic Currency Converter
 * Base currency: GHS
 * Includes all PayPal-supported payment currencies plus existing regional display currencies.
 */
const CurrencyConverter={
  currencies:{
    GHS:{symbol:'GH₵',name:'Ghanaian Cedi',flag:'🇬🇭'},
    USD:{symbol:'$',name:'US Dollar',flag:'🇺🇸',paypal:true},
    AUD:{symbol:'A$',name:'Australian Dollar',flag:'🇦🇺',paypal:true},
    BRL:{symbol:'R$',name:'Brazilian Real',flag:'🇧🇷',paypal:true},
    CAD:{symbol:'C$',name:'Canadian Dollar',flag:'🇨🇦',paypal:true},
    CNY:{symbol:'¥',name:'Chinese Renminbi',flag:'🇨🇳',paypal:true},
    CZK:{symbol:'Kč',name:'Czech Koruna',flag:'🇨🇿',paypal:true},
    DKK:{symbol:'kr',name:'Danish Krone',flag:'🇩🇰',paypal:true},
    EUR:{symbol:'€',name:'Euro',flag:'🇪🇺',paypal:true},
    HKD:{symbol:'HK$',name:'Hong Kong Dollar',flag:'🇭🇰',paypal:true},
    HUF:{symbol:'Ft',name:'Hungarian Forint',flag:'🇭🇺',paypal:true},
    ILS:{symbol:'₪',name:'Israeli New Shekel',flag:'🇮🇱',paypal:true},
    JPY:{symbol:'¥',name:'Japanese Yen',flag:'🇯🇵',paypal:true},
    MYR:{symbol:'RM',name:'Malaysian Ringgit',flag:'🇲🇾',paypal:true},
    MXN:{symbol:'MX$',name:'Mexican Peso',flag:'🇲🇽',paypal:true},
    TWD:{symbol:'NT$',name:'New Taiwan Dollar',flag:'🇹🇼',paypal:true},
    NZD:{symbol:'NZ$',name:'New Zealand Dollar',flag:'🇳🇿',paypal:true},
    NOK:{symbol:'kr',name:'Norwegian Krone',flag:'🇳🇴',paypal:true},
    PHP:{symbol:'₱',name:'Philippine Peso',flag:'🇵🇭',paypal:true},
    PLN:{symbol:'zł',name:'Polish Złoty',flag:'🇵🇱',paypal:true},
    GBP:{symbol:'£',name:'Pound Sterling',flag:'🇬🇧',paypal:true},
    SGD:{symbol:'S$',name:'Singapore Dollar',flag:'🇸🇬',paypal:true},
    SEK:{symbol:'kr',name:'Swedish Krona',flag:'🇸🇪',paypal:true},
    CHF:{symbol:'CHF',name:'Swiss Franc',flag:'🇨🇭',paypal:true},
    THB:{symbol:'฿',name:'Thai Baht',flag:'🇹🇭',paypal:true},
    NGN:{symbol:'₦',name:'Nigerian Naira',flag:'🇳🇬'},
    ZAR:{symbol:'R',name:'South African Rand',flag:'🇿🇦'},
    KES:{symbol:'KSh',name:'Kenyan Shilling',flag:'🇰🇪'},
    UGX:{symbol:'USh',name:'Ugandan Shilling',flag:'🇺🇬'},
    XOF:{symbol:'CFA',name:'West African CFA Franc',flag:'🌍'},
    XAF:{symbol:'FCFA',name:'Central African CFA Franc',flag:'🌍'},
    AED:{symbol:'د.إ',name:'UAE Dirham',flag:'🇦🇪'},
    SAR:{symbol:'﷼',name:'Saudi Riyal',flag:'🇸🇦'},
    INR:{symbol:'₹',name:'Indian Rupee',flag:'🇮🇳'}
  },
  countryToCurrency:{
    Ghana:'GHS','United States':'USD','United Kingdom':'GBP',Australia:'AUD',Brazil:'BRL',Canada:'CAD',China:'CNY','Czech Republic':'CZK',Czechia:'CZK',Denmark:'DKK',
    Austria:'EUR',Belgium:'EUR',Croatia:'EUR',Cyprus:'EUR',Estonia:'EUR',Finland:'EUR',France:'EUR',Germany:'EUR',Greece:'EUR',Ireland:'EUR',Italy:'EUR',Latvia:'EUR',Lithuania:'EUR',Luxembourg:'EUR',Malta:'EUR',Netherlands:'EUR',Portugal:'EUR',Slovakia:'EUR',Slovenia:'EUR',Spain:'EUR',
    'Hong Kong':'HKD',Hungary:'HUF',Israel:'ILS',Japan:'JPY',Malaysia:'MYR',Mexico:'MXN',Taiwan:'TWD','New Zealand':'NZD',Norway:'NOK',Philippines:'PHP',Poland:'PLN',Singapore:'SGD',Sweden:'SEK',Switzerland:'CHF',Thailand:'THB',
    Nigeria:'NGN','South Africa':'ZAR',Kenya:'KES',Uganda:'UGX','United Arab Emirates':'AED','Saudi Arabia':'SAR',India:'INR'
  },
  exchangeRates:{GHS:1},lastUpdated:null,activeCurrency:'USD',basePriceGHS:299,
  isSupportedCurrency(c){return Boolean(c&&this.currencies[c]);},
  isPayPalCurrency(c){return Boolean(this.currencies[c]?.paypal);},
  async init(){try{await this.loadExchangeRates();const detected=await this.detectUserCurrency();const manual=localStorage.getItem('wtv_currency_manual');this.activeCurrency=this.isSupportedCurrency(manual)?manual:this.isSupportedCurrency(detected)?detected:'USD';this.setupCurrencyDropdown(this.activeCurrency);this.setupTopRightCurrencyBar(this.activeCurrency);this.updateAllPrices(this.activeCurrency);setInterval(async()=>{await this.loadExchangeRates();this.updateAllPrices(this.activeCurrency);this.updateTopRightCurrencyBar(this.activeCurrency);},30*60*1000);}catch(e){console.error('Currency converter initialization error:',e);this.activeCurrency='USD';this.setupCurrencyDropdown('USD');this.setupTopRightCurrencyBar('USD');this.updateAllPrices('USD');}},
  async loadExchangeRates(){try{const r=await fetch('/api/exchange-rates',{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`Exchange-rate API returned HTTP ${r.status}`);const d=await r.json();const raw=d.rates||(d.data&&d.data.rates);if(!raw||typeof raw!=='object')throw new Error('No rates object found');const rates={GHS:1};for(const [c,v] of Object.entries(raw)){const n=Number(v);if(Number.isFinite(n)&&n>0)rates[String(c).toUpperCase()]=n;}this.exchangeRates=rates;this.lastUpdated=d.lastUpdated||d.updated_at||null;}catch(e){console.error('Failed to load exchange rates:',e);}},
  async detectUserCurrency(){try{const r=await fetch('/api/visitor-country',{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error('country lookup failed');const d=await r.json();const country=d.country||(d.data&&d.data.country);if(country&&this.countryToCurrency[country])return this.countryToCurrency[country];}catch(e){console.warn('Could not detect visitor currency:',e);}return'USD';},
  convert(ghs,currency){const a=Number(ghs);if(!Number.isFinite(a))return null;if(!currency||currency==='GHS')return a;const rate=Number(this.exchangeRates[currency]);return Number.isFinite(rate)&&rate>0?a*rate:null;},
  format(amount,currency){const info=this.currencies[currency];if(!info||!Number.isFinite(Number(amount)))return'—';const zero=['HUF','JPY','TWD'].includes(currency);const f=new Intl.NumberFormat('en-US',{minimumFractionDigits:zero?0:2,maximumFractionDigits:zero?0:2,useGrouping:true}).format(Number(amount));return`${info.symbol}${f}`;},
  getExchangeRateDisplay(currency){if(currency==='GHS')return'Base currency';const rate=Number(this.exchangeRates[currency]);if(!Number.isFinite(rate)||rate<=0)return'Rate unavailable';return`1 GHS = ${this.currencies[currency].symbol}${new Intl.NumberFormat('en-US',{minimumFractionDigits:5,maximumFractionDigits:5}).format(rate)}`;},
  updateAllPrices(currency){if(!this.isSupportedCurrency(currency))currency='USD';this.activeCurrency=currency;document.querySelectorAll('[data-price-ghs]').forEach(el=>{const g=Number(el.getAttribute('data-price-ghs'));if(!Number.isFinite(g))return;if(currency==='GHS'){el.innerHTML=`<strong>${this.format(g,'GHS')}</strong>`;return;}const c=this.convert(g,currency);el.innerHTML=c===null?`<strong>${this.format(g,'GHS')}</strong><br><span class="currency-converted">Conversion unavailable</span>`:`<strong>${this.format(c,currency)} ${currency}</strong><br><span class="currency-converted">≈ ${this.format(g,'GHS')}</span>`;});},
  setupCurrencyDropdown(initial){let dd=document.getElementById('currency-dropdown');if(!dd){const container=document.getElementById('currency-selector');if(!container)return;dd=document.createElement('select');dd.id='currency-dropdown';dd.setAttribute('aria-label','Select your currency');dd.style.cssText='padding:8px 12px;border:1px solid #d8ccb2;border-radius:8px;background:#fff;font-weight:700;cursor:pointer;font-size:14px;min-width:220px;max-width:100%;';for(const [code,info] of Object.entries(this.currencies)){const o=document.createElement('option');o.value=code;o.textContent=`${info.flag} ${code} — ${info.name}${info.paypal?' • PayPal':''}`;dd.appendChild(o);}container.appendChild(dd);}if(!dd.dataset.currencyConverterInitialized){dd.addEventListener('change',e=>{const c=e.target.value;localStorage.setItem('wtv_currency_manual',c);this.activeCurrency=c;this.updateAllPrices(c);this.updateTopRightCurrencyBar(c);window.dispatchEvent(new CustomEvent('worldtv:currency-changed',{detail:{currency:c,paypalSupported:this.isPayPalCurrency(c)}}));});dd.dataset.currencyConverterInitialized='true';}dd.value=initial;},
  setupTopRightCurrencyBar(initial){let bar=document.getElementById('top-right-currency-bar');if(!bar){bar=document.createElement('div');bar.id='top-right-currency-bar';bar.style.cssText='display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-weight:700;font-size:13px;line-height:1.3;white-space:nowrap;';const target=document.querySelector('[data-currency-bar-container]')||document.querySelector('.nav-actions')||document.querySelector('nav')||document.querySelector('header');if(target)target.appendChild(bar);else{bar.style.position='fixed';bar.style.top='10px';bar.style.right='10px';bar.style.zIndex='9999';bar.style.background='#fff';bar.style.padding='8px 10px';bar.style.borderRadius='10px';document.body.appendChild(bar);}}this.updateTopRightCurrencyBar(initial);},
  updateTopRightCurrencyBar(currency){const bar=document.getElementById('top-right-currency-bar');if(!bar)return;if(!this.isSupportedCurrency(currency))currency='GHS';const info=this.currencies[currency];const amount=this.convert(this.basePriceGHS,currency);bar.innerHTML=`<div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px"><span>${info.flag}</span><span>${currency}</span></div><div style="text-align:right;font-size:12px;color:#716958"><div>${amount===null?'Conversion unavailable':this.format(amount,currency)}</div><div style="font-size:11px;margin-top:2px">${this.getExchangeRateDisplay(currency)}</div></div>`;bar.style.display='flex';},
  clearManualCurrencyPreference(){localStorage.removeItem('wtv_currency_manual');}
};
window.CurrencyConverter=CurrencyConverter;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>CurrencyConverter.init());else CurrencyConverter.init();
