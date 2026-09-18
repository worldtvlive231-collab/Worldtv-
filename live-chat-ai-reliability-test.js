const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const http=require("node:http");
const path=require("node:path");
const {spawn}=require("node:child_process");
const Database=require("better-sqlite3");

const appPort=3317;
const mockPort=4317;
const appBase=`http://127.0.0.1:${appPort}`;
const captured=[];
let retryFailures=0;

function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function waitFor(fn,timeoutMs=9000){
  const deadline=Date.now()+timeoutMs;
  let lastError;
  while(Date.now()<deadline){
    try{
      const value=await fn();
      if(value) return value;
    }catch(error){lastError=error;}
    await wait(120);
  }
  throw lastError||new Error("Timed out waiting for condition");
}

function mockOpenAi(){
  return http.createServer((req,res)=>{
    let raw="";
    req.on("data",chunk=>{raw+=chunk;});
    req.on("end",()=>{
      const body=JSON.parse(raw||"{}");
      captured.push(body);
      const text=(body.input||[]).map(item=>item.content).join("\n");
      if(text.includes("RETRY_TEST")&&retryFailures++===0){
        res.writeHead(500,{"content-type":"application/json"});
        res.end(JSON.stringify({error:{message:"temporary test failure"}}));
        return;
      }
      const answer=text.includes("RETRY_TEST")
        ? "Recovered after a temporary error."
        : "You can subscribe and download the app using the official WORLD TV links.";
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({output:[{type:"message",content:[{type:"output_text",text:answer}]}]}));
    });
  });
}

function createStartupPendingMessage(token){
  const db=new Database(path.join(__dirname,"data","worldtv.sqlite"));
  try{
    const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
    const result=db.prepare(`
      INSERT INTO live_chat_conversations(
        visitor_token_hash,name,email,page_path,status,unread_admin,unread_customer
      ) VALUES(?,?,'','/download.html','open',1,0)
    `).run(tokenHash,"Startup Recovery Test");
    db.prepare(`
      INSERT INTO live_chat_messages(conversation_id,sender,body)
      VALUES(?,'customer','STARTUP_RECOVERY_TEST')
    `).run(result.lastInsertRowid);
    return Number(result.lastInsertRowid);
  }finally{
    db.close();
  }
}

async function postMessage(token,body){
  const response=await fetch(`${appBase}/api/chat/messages`,{
    method:"POST",
    headers:{"content-type":"application/json","x-chat-token":token},
    body:JSON.stringify({name:"Reliability Test",body,page_path:"/subscribe.html"})
  });
  assert.equal(response.status,201);
}

async function messages(token){
  const response=await fetch(`${appBase}/api/chat/messages?after=0&mark_read=1`,{
    headers:{"x-chat-token":token}
  });
  assert.equal(response.status,200);
  return (await response.json()).messages||[];
}

async function main(){
  const mock=mockOpenAi();
  await new Promise(resolve=>mock.listen(mockPort,"127.0.0.1",resolve));
  const startupToken=`startup-${Date.now()}-abcdefghijklmnopqrstuvwxyz`;
  createStartupPendingMessage(startupToken);
  const app=spawn(process.execPath,["server.js"],{
    cwd:__dirname,
    env:{
      ...process.env,
      PORT:String(appPort),
      OPENAI_API_KEY:"sk-proj-reliability-test-key-1234567890",
      OPENAI_MODEL:"gpt-5-mini",
      OPENAI_API_BASE_URL:`http://127.0.0.1:${mockPort}`
    },
    stdio:["ignore","pipe","pipe"]
  });
  let appOutput="";
  app.stdout.on("data",chunk=>{appOutput+=chunk;});
  app.stderr.on("data",chunk=>{appOutput+=chunk;});

  try{
    await waitFor(async()=>{
      const response=await fetch(`${appBase}/`);
      return response.ok;
    });

    const recoveredMessages=await waitFor(async()=>{
      const rows=await messages(startupToken);
      return rows.some(row=>row.sender==="admin"&&row.source==="ai")?rows:null;
    });
    assert.ok(recoveredMessages.some(row=>row.body.includes("official WORLD TV links")));

    const rapidToken=`rapid-${Date.now()}-abcdefghijklmnopqrstuvwxyz`;
    await postMessage(rapidToken,"I want to subscribe");
    await postMessage(rapidToken,"How do I download the app?");
    const rapidMessages=await waitFor(async()=>{
      const rows=await messages(rapidToken);
      return rows.some(row=>row.sender==="admin"&&row.source==="ai")?rows:null;
    });
    assert.equal(rapidMessages.filter(row=>row.sender==="customer").length,2);
    assert.equal(rapidMessages.filter(row=>row.sender==="admin"&&row.source==="ai").length,1);
    const rapidRequest=captured.find(request=>(request.input||[]).some(item=>String(item.content).includes("How do I download")));
    assert.ok(rapidRequest,"Rapid follow-up request was not sent to OpenAI");
    assert.match(rapidRequest.instructions,/https:\/\/paystack\.shop\/pay\/x4sqejilmz/);
    assert.match(rapidRequest.instructions,/https:\/\/myworldtvlive\.com\/download\.html/);
    assert.match(rapidRequest.instructions,/4193413/);
    assert.match(rapidRequest.instructions,/US\$19 per one-year code/);

    const retryToken=`retry-${Date.now()}-abcdefghijklmnopqrstuvwxyz`;
    await postMessage(retryToken,"RETRY_TEST");
    const retryMessages=await waitFor(async()=>{
      const rows=await messages(retryToken);
      return rows.some(row=>row.sender==="admin"&&row.source==="ai")?rows:null;
    });
    assert.ok(retryMessages.some(row=>row.body.includes("Recovered after")));
    assert.equal(retryFailures,2,"Expected one failed request followed by a retry");

    process.stdout.write("Live chat AI reliability tests passed.\n");
  }finally{
    app.kill("SIGTERM");
    await Promise.race([new Promise(resolve=>app.once("exit",resolve)),wait(1500)]);
    await new Promise(resolve=>mock.close(resolve));
    if(app.exitCode&&app.exitCode!==0) process.stderr.write(appOutput);
  }
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
