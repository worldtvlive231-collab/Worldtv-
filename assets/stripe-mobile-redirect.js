(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  window.fetch=async function worldTvStripeRedirectFetch(input,init){
    const response=await originalFetch(input,init);
    try{
      const requestUrl=typeof input==='string'?input:String(input?.url||'');
      if(!requestUrl.includes('/api/payment/stripe/create-session'))return response;
      const data=await response.clone().json();
      if(!response.ok||!data?.checkout_url)return response;
      const target=new URL(String(data.checkout_url));
      if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')return response;
      const encoded=btoa(encodeURIComponent(target.href)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      data.checkout_url=`/stripe-launch.html#${encoded}`;
      return new Response(JSON.stringify(data),{
        status:response.status,
        statusText:response.statusText,
        headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
      });
    }catch(_){
      return response;
    }
  };
})();
