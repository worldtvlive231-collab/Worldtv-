"use strict";

function cleanText(value,maxLength){
  return String(value??"").replace(/\u0000/g,"").trim().slice(0,maxLength);
}

function enabledValue(value,defaultValue=true){
  const normalized=String(value??"").trim().toLowerCase();
  if(!normalized) return defaultValue;
  return !["0","false","off","no"].includes(normalized);
}

function digitsOnly(value){
  return String(value??"").replace(/\D/g,"");
}

function createLiveChatWhatsAppNotifier({env=process.env,fetchImpl=globalThis.fetch,logger=console}={}){
  let lastError=null;
  let lastSentAt=null;

  function config(){
    const accessToken=cleanText(env.WHATSAPP_CLOUD_ACCESS_TOKEN,4096);
    const phoneNumberId=digitsOnly(env.WHATSAPP_CLOUD_PHONE_NUMBER_ID);
    const recipient=digitsOnly(env.WHATSAPP_LIVE_CHAT_RECIPIENT);
    const templateName=cleanText(env.WHATSAPP_LIVE_CHAT_TEMPLATE,512);
    const templateLanguage=cleanText(env.WHATSAPP_LIVE_CHAT_TEMPLATE_LANGUAGE,32)||"en_US";
    const apiVersion=/^v\d+\.\d+$/.test(String(env.WHATSAPP_CLOUD_API_VERSION||""))
      ? String(env.WHATSAPP_CLOUD_API_VERSION)
      : "v23.0";
    const apiBase=String(env.WHATSAPP_CLOUD_API_BASE_URL||"https://graph.facebook.com").replace(/\/+$/,"");
    const publicBase=String(env.PUBLIC_BASE_URL||env.APP_URL||"https://myworldtvlive.com").replace(/\/+$/,"");
    const enabled=enabledValue(env.WHATSAPP_LIVE_CHAT_NOTIFY_ENABLED,true);
    const configured=Boolean(
      accessToken && /^\d{5,30}$/.test(phoneNumberId) && /^\d{8,15}$/.test(recipient)
    );
    return {
      accessToken,
      phoneNumberId,
      recipient,
      templateName,
      templateLanguage,
      apiVersion,
      apiBase,
      publicBase,
      enabled,
      configured,
      active:enabled&&configured,
      mode:templateName?"template":"text"
    };
  }

  function status(){
    const current=config();
    return {
      enabled:current.enabled,
      configured:current.configured,
      active:current.active,
      mode:current.mode,
      template_configured:Boolean(current.templateName),
      recipient_hint:current.recipient ? `ending ${current.recipient.slice(-4)}` : "",
      last_error:lastError,
      last_sent_at:lastSentAt
    };
  }

  function notificationText(conversation,message,current){
    const name=cleanText(conversation?.name,80)||"Website visitor";
    const email=cleanText(conversation?.email,160)||"Not provided";
    const pagePath=cleanText(conversation?.page_path,300)||"/";
    const pageUrl=pagePath.startsWith("http")
      ? pagePath
      : `${current.publicBase}${pagePath.startsWith("/")?"":"/"}${pagePath}`;
    const adminUrl=`${current.publicBase}/admin.html#liveChatTab`;
    const body=cleanText(message?.body,2200)||"(Empty message)";
    return {
      name,
      adminUrl,
      body,
      full:[
        "🔔 New WORLD TV website live chat",
        `Customer: ${name}`,
        `Email: ${email}`,
        `Message: ${body}`,
        `Page: ${pageUrl}`,
        `Reply: ${adminUrl}`
      ].join("\n")
    };
  }

  function payloadFor(conversation,message,current=config()){
    const text=notificationText(conversation,message,current);
    if(current.templateName){
      return {
        messaging_product:"whatsapp",
        to:current.recipient,
        type:"template",
        template:{
          name:current.templateName,
          language:{code:current.templateLanguage},
          components:[{
            type:"body",
            parameters:[
              {type:"text",text:text.name},
              {type:"text",text:cleanText(text.body,900)},
              {type:"text",text:text.adminUrl}
            ]
          }]
        }
      };
    }
    return {
      messaging_product:"whatsapp",
      recipient_type:"individual",
      to:current.recipient,
      type:"text",
      text:{preview_url:false,body:cleanText(text.full,3900)}
    };
  }

  async function notify({conversation,message}={}){
    const current=config();
    if(!current.enabled) return {sent:false,reason:"disabled"};
    if(!current.configured) return {sent:false,reason:"not_configured"};
    if(typeof fetchImpl!=="function"){
      lastError="WhatsApp notification fetch is unavailable";
      return {sent:false,reason:"fetch_unavailable"};
    }

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    if(typeof timeout.unref==="function") timeout.unref();
    try{
      const response=await fetchImpl(
        `${current.apiBase}/${current.apiVersion}/${current.phoneNumberId}/messages`,
        {
          method:"POST",
          headers:{
            "Authorization":`Bearer ${current.accessToken}`,
            "Content-Type":"application/json"
          },
          body:JSON.stringify(payloadFor(conversation,message,current)),
          signal:controller.signal
        }
      );
      const raw=await response.text();
      let data={};
      try{data=raw?JSON.parse(raw):{};}catch(error){data={};}
      if(!response.ok){
        const detail=cleanText(data?.error?.message||raw||`HTTP ${response.status}`,300);
        lastError=`WhatsApp ${response.status}: ${detail}`;
        logger.error("Live chat WhatsApp notification failed:",lastError);
        return {sent:false,reason:"api_error",status:response.status};
      }
      lastError=null;
      lastSentAt=new Date().toISOString();
      return {sent:true,message_id:cleanText(data?.messages?.[0]?.id,300)||null};
    }catch(error){
      lastError=error?.name==="AbortError"
        ? "WhatsApp notification timed out"
        : `WhatsApp connection error: ${cleanText(error?.message,240)||"unknown error"}`;
      logger.error("Live chat WhatsApp notification failed:",lastError);
      return {sent:false,reason:error?.name==="AbortError"?"timeout":"connection_error"};
    }finally{
      clearTimeout(timeout);
    }
  }

  return {notify,status,payloadFor};
}

module.exports={createLiveChatWhatsAppNotifier};
