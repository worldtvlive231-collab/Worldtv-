document.addEventListener("DOMContentLoaded",()=>{
  const path=location.pathname;
  const descriptions={
    "/":"World TV — subscriptions, products, customer accounts and support.",
    "/products.html":"Shop World TV products and services.",
    "/subscribe.html":"Get your World TV 1-year subscription.",
    "/faq.html":"World TV frequently asked questions.",
    "/contact.html":"Contact World TV customer support."
  };
  let d=document.querySelector('meta[name="description"]');
  if(!d){d=document.createElement("meta");d.name="description";document.head.appendChild(d);}
  d.content=descriptions[path]||"World TV customer portal.";
});
