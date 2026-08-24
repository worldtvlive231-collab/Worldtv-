/**
 * WORLD TV language selector.
 *
 * Automatically chooses a language from the visitor country endpoint, while
 * always allowing the visitor to override it. Manual choices are remembered.
 */
(()=>{
  "use strict";

  const STORAGE_KEY="wtv_language_manual";
  const languages={
    en:{label:"English",flag:"🇬🇧",dir:"ltr"},
    fr:{label:"Français",flag:"🇫🇷",dir:"ltr"},
    es:{label:"Español",flag:"🇪🇸",dir:"ltr"},
    pt:{label:"Português",flag:"🇵🇹",dir:"ltr"},
    ar:{label:"العربية",flag:"🌍",dir:"rtl"}
  };

  const frenchCountries=new Set([
    "BE","BJ","BF","BI","CM","CA","CF","TD","KM","CG","CD","CI",
    "DJ","GQ","FR","GA","GN","HT","LU","MG","ML","MC","MA","NE",
    "RW","SN","SC","CH","TG","TN","VU"
  ]);
  const spanishCountries=new Set([
    "AR","BO","CL","CO","CR","CU","DO","EC","SV","GQ","GT","HN",
    "MX","NI","PA","PY","PE","ES","UY","VE"
  ]);
  const portugueseCountries=new Set(["AO","BR","CV","GW","MZ","PT","ST","TL"]);
  const arabicCountries=new Set([
    "DZ","BH","TD","KM","DJ","EG","IQ","JO","KW","LB","LY","MR",
    "MA","OM","PS","QA","SA","SO","SD","SY","TN","AE","YE"
  ]);

  function languageForCountry(code){
    code=String(code||"").trim().toUpperCase();
    if(arabicCountries.has(code))return "ar";
    if(portugueseCountries.has(code))return "pt";
    if(spanishCountries.has(code))return "es";
    if(frenchCountries.has(code))return "fr";
    return "en";
  }

  function setDirection(language){
    const info=languages[language]||languages.en;
    document.documentElement.lang=language;
    document.documentElement.dir=info.dir;
    document.body?.classList.toggle("wtv-rtl",info.dir==="rtl");
  }

  function setGoogleCookie(language){
    const value=`/en/${language}`;
    const secure=location.protocol==="https:"?"; Secure":"";
    document.cookie=`googtrans=${value}; Path=/; SameSite=Lax${secure}`;
    const host=location.hostname.split(".");
    if(host.length>1){
      const domain="."+host.slice(-2).join(".");
      document.cookie=`googtrans=${value}; Domain=${domain}; Path=/; SameSite=Lax${secure}`;
    }
  }

  function applyGoogleLanguage(language,reload=false){
    setDirection(language);
    setGoogleCookie(language);
    const googleSelect=document.querySelector(".goog-te-combo");
    if(googleSelect){
      googleSelect.value=language;
      googleSelect.dispatchEvent(new Event("change",{bubbles:true}));
      return;
    }
    if(reload)location.reload();
  }

  function addStyles(){
    const style=document.createElement("style");
    style.textContent=`
      .wtv-language-control{display:flex;align-items:center;gap:7px;margin-left:8px;position:relative;z-index:9997}
      .wtv-language-control label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
      .wtv-language-select{max-width:150px;padding:9px 30px 9px 10px;border:1px solid #d8c9a7;border-radius:10px;background:#fff;color:#17130a;font:700 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer}
      #google_translate_element{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}
      body{top:0!important}.goog-te-banner-frame,.skiptranslate iframe{display:none!important}
      html[dir="rtl"] body{text-align:right}html[dir="rtl"] .wtv-language-control{margin-left:0;margin-right:8px}
      @media(max-width:760px){.wtv-language-control{position:fixed;right:10px;bottom:12px;margin:0;padding:6px;border-radius:12px;background:rgba(255,255,255,.96);box-shadow:0 5px 22px rgba(0,0,0,.18)}html[dir="rtl"] .wtv-language-control{right:auto;left:10px;margin:0}.wtv-language-select{max-width:135px}}
    `;
    document.head.appendChild(style);
  }

  function addControl(language){
    const wrapper=document.createElement("div");
    wrapper.className="wtv-language-control notranslate";
    wrapper.setAttribute("translate","no");
    const label=document.createElement("label");
    label.htmlFor="wtv-language-select";
    label.textContent="Choose website language";
    const select=document.createElement("select");
    select.id="wtv-language-select";
    select.className="wtv-language-select";
    select.setAttribute("aria-label","Choose website language");
    Object.entries(languages).forEach(([code,info])=>{
      const option=document.createElement("option");
      option.value=code;
      option.textContent=`${info.flag} ${info.label}`;
      select.appendChild(option);
    });
    select.value=language;
    select.addEventListener("change",()=>{
      const chosen=select.value;
      localStorage.setItem(STORAGE_KEY,chosen);
      applyGoogleLanguage(chosen,true);
    });
    wrapper.append(label,select);
    const target=document.querySelector("header .actions, header .nav-actions, header nav, header")||document.body;
    target.appendChild(wrapper);

    const googleHost=document.createElement("div");
    googleHost.id="google_translate_element";
    document.body.appendChild(googleHost);
  }

  function loadGoogleTranslate(language){
    window.googleTranslateElementInit=()=>{
      if(!window.google?.translate?.TranslateElement)return;
      new google.translate.TranslateElement({
        pageLanguage:"en",
        includedLanguages:"en,fr,es,pt,ar",
        autoDisplay:false
      },"google_translate_element");
      window.setTimeout(()=>applyGoogleLanguage(language,false),350);
    };
    const script=document.createElement("script");
    script.src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    script.async=true;
    script.onerror=()=>console.warn("Website translation service is temporarily unavailable.");
    document.head.appendChild(script);
  }

  async function detectedLanguage(){
    const manual=localStorage.getItem(STORAGE_KEY);
    if(languages[manual])return manual;
    try{
      const response=await fetch("/api/visitor-country",{headers:{Accept:"application/json"},cache:"no-store"});
      if(response.ok){
        const data=await response.json();
        return languageForCountry(data.country_code);
      }
    }catch(error){console.warn("Could not detect visitor country:",error);}
    const browser=String(navigator.language||"en").slice(0,2).toLowerCase();
    return languages[browser]?browser:"en";
  }

  async function init(){
    if(document.getElementById("wtv-language-select"))return;
    addStyles();
    const language=await detectedLanguage();
    setDirection(language);
    setGoogleCookie(language);
    addControl(language);
    if(language!=="en")loadGoogleTranslate(language);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
