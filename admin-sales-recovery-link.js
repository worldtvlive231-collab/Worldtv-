"use strict";

const fs = require("fs");
const path = require("path");

const assetPath = path.join(__dirname, "assets", "site-meta.js");
let baseAsset = "";
try { baseAsset = fs.readFileSync(assetPath, "utf8"); }
catch (error) { console.error("Admin recovery link asset read error:", error.message); }

const enhancement = `\n;(()=>{\n  function addSalesRecoveryLink(){\n    if(!/^\\/admin(?:\\.html)?$/.test(location.pathname)) return;\n    const tabs=document.querySelector('#dashboard .tabs');\n    if(!tabs||document.getElementById('salesRecoveryLink')) return;\n    const link=document.createElement('a');\n    link.id='salesRecoveryLink';\n    link.className='btn tab';\n    link.href='/sales-recovery.html';\n    link.textContent='Sales Recovery';\n    link.style.textDecoration='none';\n    const tv=[...tabs.children].find(el=>/TV Match Channels/i.test(el.textContent||''));\n    tv?tabs.insertBefore(link,tv):tabs.appendChild(link);\n  }\n  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',addSalesRecoveryLink); else addSalesRecoveryLink();\n  new MutationObserver(addSalesRecoveryLink).observe(document.documentElement,{childList:true,subtree:true});\n})();\n`;

const expressPath = require.resolve("express");
const originalExpress = require(expressPath);
function wrappedExpress(...args) {
  const app = originalExpress(...args);
  app.get("/assets/site-meta.js", (req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    res.type("application/javascript").send(baseAsset + enhancement);
  });
  return app;
}
Object.assign(wrappedExpress, originalExpress);
Object.setPrototypeOf(wrappedExpress, Object.getPrototypeOf(originalExpress));
require.cache[expressPath].exports = wrappedExpress;
