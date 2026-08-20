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

  if(path==="/admin"||path==="/admin.html"){
    const tabs=document.querySelector(".tabs");
    if(tabs&&!document.getElementById("salesRecoveryLink")){
      const link=document.createElement("a");
      link.id="salesRecoveryLink";
      link.className="btn tab";
      link.href="/sales-recovery.html";
      link.textContent="Sales Recovery";
      link.style.textDecoration="none";
      link.style.color="inherit";
      tabs.appendChild(link);
    }
  }
});
