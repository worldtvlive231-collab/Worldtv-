const assert=require("node:assert/strict");
const http=require("node:http");
const {createLiveChatWhatsAppNotifier}=require("./live-chat-whatsapp");

async function listen(server){
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return server.address().port;
}

async function close(server){
  await new Promise(resolve=>server.close(resolve));
}

async function main(){
  const inactive=createLiveChatWhatsAppNotifier({env:{},logger:{error(){}}});
  assert.equal(inactive.status().enabled,true);
  assert.equal(inactive.status().configured,false);
  assert.deepEqual(await inactive.notify({}),{sent:false,reason:"not_configured"});

  let received=null;
  const api=http.createServer((req,res)=>{
    let raw="";
    req.on("data",chunk=>{raw+=chunk;});
    req.on("end",()=>{
      received={url:req.url,authorization:req.headers.authorization,body:JSON.parse(raw)};
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({messages:[{id:"wamid.test-message"}]}));
    });
  });
  const port=await listen(api);
  const env={
    WHATSAPP_LIVE_CHAT_NOTIFY_ENABLED:"true",
    WHATSAPP_CLOUD_ACCESS_TOKEN:"test-token",
    WHATSAPP_CLOUD_PHONE_NUMBER_ID:"1234567890",
    WHATSAPP_LIVE_CHAT_RECIPIENT:"+233 24 000 0000",
    WHATSAPP_CLOUD_API_VERSION:"v23.0",
    WHATSAPP_CLOUD_API_BASE_URL:`http://127.0.0.1:${port}`,
    WHATSAPP_LIVE_CHAT_TEMPLATE:"world_tv_live_chat_alert",
    WHATSAPP_LIVE_CHAT_TEMPLATE_LANGUAGE:"en_US",
    PUBLIC_BASE_URL:"https://myworldtvlive.com"
  };
  const notifier=createLiveChatWhatsAppNotifier({env,logger:{error(){}}});

  try{
    const result=await notifier.notify({
      conversation:{name:"Ama",email:"ama@example.com",page_path:"/subscribe.html"},
      message:{body:"Please help me subscribe"}
    });
    assert.equal(result.sent,true);
    assert.equal(result.message_id,"wamid.test-message");
    assert.equal(received.url,"/v23.0/1234567890/messages");
    assert.equal(received.authorization,"Bearer test-token");
    assert.equal(received.body.messaging_product,"whatsapp");
    assert.equal(received.body.to,"233240000000");
    assert.equal(received.body.type,"template");
    assert.equal(received.body.template.name,"world_tv_live_chat_alert");
    assert.deepEqual(
      received.body.template.components[0].parameters.map(item=>item.text),
      ["Ama","Please help me subscribe","https://myworldtvlive.com/admin.html#liveChatTab"]
    );
    assert.equal(notifier.status().last_error,null);
    assert.match(notifier.status().last_sent_at,/^\d{4}-\d{2}-\d{2}T/);
  }finally{
    await close(api);
  }

  const textPayload=createLiveChatWhatsAppNotifier({
    env:{...env,WHATSAPP_LIVE_CHAT_TEMPLATE:""},
    logger:{error(){}}
  }).payloadFor(
    {name:"Kojo",email:"kojo@example.com",page_path:"/download.html"},
    {body:"Installation help"},
    {
      recipient:"233240000000",
      templateName:"",
      publicBase:"https://myworldtvlive.com"
    }
  );
  assert.equal(textPayload.type,"text");
  assert.match(textPayload.text.body,/Kojo/);
  assert.match(textPayload.text.body,/Installation help/);
  assert.match(textPayload.text.body,/admin\.html#liveChatTab/);

  process.stdout.write("Live chat WhatsApp notification tests passed.\n");
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
