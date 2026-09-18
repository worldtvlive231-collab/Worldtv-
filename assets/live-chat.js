(function(){
  "use strict";

  if(window.__worldTvLiveChatLoaded) return;
  window.__worldTvLiveChatLoaded=true;

  const language=(document.documentElement.lang||navigator.language||"en").toLowerCase();
  const locale=language.startsWith("fr")?"fr":language.startsWith("es")?"es":"en";
  const copy={
    en:{button:"Chat with us",title:"WORLD TV Support",subtitle:"AI-assisted support",welcome:"Hello! How can we help you today?",name:"Your name",email:"Email (optional)",message:"Type your message…",send:"Send",start:"Enter your name, then send us a message.",thinking:"WORLD TV AI is preparing a reply…",offline:"Your message is saved. We will reply here.",error:"Chat is temporarily unavailable. Please try again.",closed:"This conversation was closed. Send a new message to reopen it.",agent:"WORLD TV Support",ai:"WORLD TV AI",you:"You"},
    fr:{button:"Discutez avec nous",title:"Assistance WORLD TV",subtitle:"Assistance aidée par l’IA",welcome:"Bonjour ! Comment pouvons-nous vous aider aujourd’hui ?",name:"Votre nom",email:"E-mail (facultatif)",message:"Écrivez votre message…",send:"Envoyer",start:"Entrez votre nom, puis envoyez-nous un message.",thinking:"L’IA WORLD TV prépare une réponse…",offline:"Votre message est enregistré. Nous répondrons ici.",error:"Le chat est temporairement indisponible. Réessayez.",closed:"Cette conversation est fermée. Envoyez un nouveau message pour la rouvrir.",agent:"Assistance WORLD TV",ai:"IA WORLD TV",you:"Vous"},
    es:{button:"Chatea con nosotros",title:"Soporte WORLD TV",subtitle:"Soporte asistido por IA",welcome:"¡Hola! ¿Cómo podemos ayudarte hoy?",name:"Tu nombre",email:"Correo (opcional)",message:"Escribe tu mensaje…",send:"Enviar",start:"Escribe tu nombre y envíanos un mensaje.",thinking:"La IA de WORLD TV está preparando una respuesta…",offline:"Tu mensaje está guardado. Responderemos aquí.",error:"El chat no está disponible temporalmente. Inténtalo de nuevo.",closed:"Esta conversación está cerrada. Envía un mensaje para reabrirla.",agent:"Soporte WORLD TV",ai:"IA WORLD TV",you:"Tú"}
  }[locale];

  const storage={
    token:"worldtv_live_chat_token",
    name:"worldtv_live_chat_name",
    email:"worldtv_live_chat_email"
  };
  let token=localStorage.getItem(storage.token)||"";
  if(!token){
    token=(window.crypto&&crypto.randomUUID)
      ? `${crypto.randomUUID()}-${crypto.randomUUID()}`
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(storage.token,token);
  }

  const style=document.createElement("style");
  style.textContent=`
    #wtv-chat-root{--wtv-gold:#d89a00;--wtv-dark:#17130a;position:fixed;right:20px;bottom:20px;z-index:2147482000;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--wtv-dark)}
    #wtv-chat-root *{box-sizing:border-box}
    .wtv-chat-launcher{height:56px;border:0;border-radius:999px;padding:0 20px;background:linear-gradient(135deg,#f2bd2b,#d68f00);color:#17130a;box-shadow:0 12px 32px #0003;font:800 15px/1 system-ui;cursor:pointer;display:flex;align-items:center;gap:10px}
    .wtv-chat-launcher svg{width:23px;height:23px}.wtv-chat-badge{display:none;min-width:21px;height:21px;padding:0 6px;border-radius:99px;background:#c72c2c;color:#fff;align-items:center;justify-content:center;font-size:11px}.wtv-chat-badge.show{display:inline-flex}
    .wtv-chat-panel{display:none;position:absolute;right:0;bottom:68px;width:min(380px,calc(100vw - 28px));height:min(580px,calc(100vh - 110px));background:#fff;border:1px solid #eadfc8;border-radius:20px;box-shadow:0 24px 70px #0004;overflow:hidden;flex-direction:column}.wtv-chat-panel.open{display:flex}
    .wtv-chat-head{background:linear-gradient(135deg,#17130a,#32270d);color:#fff;padding:17px 18px;display:flex;align-items:center;gap:12px}.wtv-chat-logo{width:42px;height:42px;border-radius:12px;background:#fff;object-fit:contain}.wtv-chat-heading{min-width:0;flex:1}.wtv-chat-heading strong{display:block;font-size:16px}.wtv-chat-heading span{font-size:12px;color:#f4d886}.wtv-chat-close{border:0;background:#ffffff18;color:#fff;border-radius:9px;width:34px;height:34px;font-size:24px;line-height:1;cursor:pointer}
    .wtv-chat-messages{flex:1;overflow-y:auto;padding:16px;background:#fffaf0;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}.wtv-chat-welcome{align-self:flex-start;background:#fff;border:1px solid #eadfc8;border-radius:14px 14px 14px 4px;padding:11px 13px;max-width:86%;font-size:14px;line-height:1.4}.wtv-chat-message{max-width:86%;padding:10px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}.wtv-chat-message.customer{align-self:flex-end;background:#e1a200;color:#181208;border-radius:14px 14px 4px 14px}.wtv-chat-message.admin{align-self:flex-start;background:#fff;border:1px solid #e3d8bf;border-radius:14px 14px 14px 4px}.wtv-chat-meta{display:block;margin-top:5px;font-size:10px;opacity:.65}.wtv-chat-state{padding:7px 16px;background:#fff8e8;border-top:1px solid #f0e5cd;color:#756b55;font-size:11px;min-height:27px}
    .wtv-chat-identity{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px 0;background:#fff;border-top:1px solid #eee5d2}.wtv-chat-identity.hidden{display:none}.wtv-chat-input{width:100%;border:1px solid #d8ccb2;border-radius:10px;padding:10px;font:inherit;font-size:13px;outline:none}.wtv-chat-input:focus,.wtv-chat-textarea:focus{border-color:#d89a00;box-shadow:0 0 0 3px #d89a0018}
    .wtv-chat-compose{display:flex;gap:8px;padding:10px 12px 12px;background:#fff}.wtv-chat-textarea{min-height:44px;max-height:96px;resize:none;flex:1;border:1px solid #d8ccb2;border-radius:12px;padding:11px;font:inherit;font-size:14px;outline:none}.wtv-chat-send{border:0;border-radius:12px;padding:0 16px;background:#dfa000;color:#17130a;font-weight:900;cursor:pointer}.wtv-chat-send:disabled{opacity:.55;cursor:not-allowed}
    @media(max-width:520px){#wtv-chat-root{right:12px;bottom:12px}.wtv-chat-panel{position:fixed;inset:10px;width:auto;height:auto;max-height:none;border-radius:18px}.wtv-chat-launcher{height:54px;padding:0 17px}.wtv-chat-identity{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const root=document.createElement("div");
  root.id="wtv-chat-root";
  root.innerHTML=`
    <section class="wtv-chat-panel" role="dialog" aria-label="${copy.title}">
      <header class="wtv-chat-head">
        <img class="wtv-chat-logo" src="/world-tv-logo.png" alt="WORLD TV">
        <div class="wtv-chat-heading"><strong>${copy.title}</strong><span>${copy.subtitle}</span></div>
        <button class="wtv-chat-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="wtv-chat-messages" aria-live="polite"><div class="wtv-chat-welcome">${copy.welcome}</div></div>
      <div class="wtv-chat-state">${copy.start}</div>
      <div class="wtv-chat-identity">
        <input class="wtv-chat-input wtv-chat-name" maxlength="80" autocomplete="name" placeholder="${copy.name}">
        <input class="wtv-chat-input wtv-chat-email" maxlength="160" type="email" autocomplete="email" placeholder="${copy.email}">
      </div>
      <form class="wtv-chat-compose">
        <textarea class="wtv-chat-textarea" maxlength="2000" rows="1" placeholder="${copy.message}" aria-label="${copy.message}"></textarea>
        <button class="wtv-chat-send" type="submit">${copy.send}</button>
      </form>
    </section>
    <button class="wtv-chat-launcher" type="button" aria-label="${copy.button}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 6v2h12V9H6Zm0 4v2h8v-2H6Z"/></svg>
      <span>${copy.button}</span><span class="wtv-chat-badge">0</span>
    </button>`;
  document.body.appendChild(root);

  const panel=root.querySelector(".wtv-chat-panel");
  const launcher=root.querySelector(".wtv-chat-launcher");
  const closeButton=root.querySelector(".wtv-chat-close");
  const messagesEl=root.querySelector(".wtv-chat-messages");
  const stateEl=root.querySelector(".wtv-chat-state");
  const identityEl=root.querySelector(".wtv-chat-identity");
  const nameEl=root.querySelector(".wtv-chat-name");
  const emailEl=root.querySelector(".wtv-chat-email");
  const form=root.querySelector(".wtv-chat-compose");
  const textarea=root.querySelector(".wtv-chat-textarea");
  const sendButton=root.querySelector(".wtv-chat-send");
  const badge=root.querySelector(".wtv-chat-badge");
  let lastMessageId=0;
  let hasConversation=false;
  let busy=false;
  let awaitingReply=false;

  nameEl.value=localStorage.getItem(storage.name)||"";
  emailEl.value=localStorage.getItem(storage.email)||"";

  function setState(text){stateEl.textContent=text||"";}
  function updateBadge(count){
    const n=Math.max(0,Number(count)||0);
    badge.textContent=n>99?"99+":String(n);
    badge.classList.toggle("show",n>0);
  }
  function formatTime(value){
    const date=new Date(String(value||"").replace(" ","T")+(/Z$|[+-]\d\d:?\d\d$/.test(value||"")?"":"Z"));
    return Number.isNaN(date.getTime())?"":date.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  }
  function addMessage(message){
    const id=Number(message.id)||0;
    if(id&&messagesEl.querySelector(`[data-message-id="${id}"]`)) return;
    const item=document.createElement("div");
    item.className=`wtv-chat-message ${message.sender==="admin"?"admin":"customer"}`;
    if(id) item.dataset.messageId=String(id);
    item.appendChild(document.createTextNode(message.body||""));
    const meta=document.createElement("span");
    meta.className="wtv-chat-meta";
    meta.textContent=`${message.sender==="admin"?(message.source==="ai"?copy.ai:copy.agent):copy.you}${formatTime(message.created_at)?" • "+formatTime(message.created_at):""}`;
    item.appendChild(meta);
    messagesEl.appendChild(item);
    lastMessageId=Math.max(lastMessageId,id);
    awaitingReply=message.sender!=="admin";
  }
  function scrollToBottom(){messagesEl.scrollTop=messagesEl.scrollHeight;}

  async function loadMessages(markRead){
    try{
      const response=await fetch(`/api/chat/messages?after=${lastMessageId}&mark_read=${markRead?1:0}`,{
        headers:{"x-chat-token":token},cache:"no-store"
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||copy.error);
      hasConversation=!!data.conversation;
      if(hasConversation) identityEl.classList.add("hidden");
      (data.messages||[]).forEach(addMessage);
      if(markRead) updateBadge(0); else updateBadge(data.unread||0);
      if(data.conversation?.status==="closed") setState(copy.closed);
      else if(hasConversation) setState(awaitingReply?copy.thinking:copy.offline);
      if(markRead&&data.messages?.length) scrollToBottom();
    }catch(error){
      setState(copy.error);
    }
  }

  async function sendMessage(){
    const body=textarea.value.trim();
    const name=nameEl.value.trim();
    const email=emailEl.value.trim();
    if(!body) return;
    if(!hasConversation&&!name){
      setState(copy.start);
      nameEl.focus();
      return;
    }
    busy=true;
    sendButton.disabled=true;
    try{
      const response=await fetch("/api/chat/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-chat-token":token},
        body:JSON.stringify({body,name,email,page_path:location.pathname})
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||copy.error);
      localStorage.setItem(storage.name,name||copy.you);
      localStorage.setItem(storage.email,email);
      hasConversation=true;
      identityEl.classList.add("hidden");
      textarea.value="";
      addMessage(data.message);
      awaitingReply=true;
      setState(data.ai?copy.thinking:copy.offline);
      scrollToBottom();
    }catch(error){
      setState(error.message||copy.error);
    }finally{
      busy=false;
      sendButton.disabled=false;
      textarea.focus();
    }
  }

  launcher.addEventListener("click",()=>{
    panel.classList.add("open");
    launcher.setAttribute("aria-expanded","true");
    loadMessages(true).then(()=>{scrollToBottom();textarea.focus();});
  });
  closeButton.addEventListener("click",()=>{
    panel.classList.remove("open");
    launcher.setAttribute("aria-expanded","false");
  });
  form.addEventListener("submit",event=>{event.preventDefault();if(!busy) sendMessage();});
  textarea.addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(!busy) sendMessage();}
  });

  loadMessages(false);
  setInterval(()=>loadMessages(panel.classList.contains("open")),4000);
})();
