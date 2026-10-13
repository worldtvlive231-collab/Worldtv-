import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { hashSessionToken } from '../functions/_lib/staging-auth.js';
import { onRequestPost as report, onRequestGet as ownReports } from '../functions/api/staging/payment/pocketi-manual-report.js';
import { onRequestGet as adminReports } from '../functions/api/staging/admin/pocketi-manual-reports.js';
import { onRequestPost as review } from '../functions/api/staging/admin/pocketi-manual-review.js';
import { onRequestGet as stagingLab } from '../functions/staging-lab.js';
import { onRequestGet as stagingAdminUI } from '../functions/staging-admin.js';

const HOST = 'https://worldtv-preview.pages.dev';
const TEAM = 'https://worldtvtest.cloudflareaccess.com';
const AUD = 'worldtvpreviewtestaud123456789';
const COOKIE_A = '__Host-worldtv_staging=' + 'x'.repeat(43);
const COOKIE_B = '__Host-worldtv_staging=' + 'y'.repeat(43);
const REF = 'WTVTEST-POCKETI-ORDER_00001';

function makeRequest(path,{method='GET',body,cookie='',jwt='',origin=HOST,host=HOST}={}){
  const headers = { ...(cookie ? { cookie } : {}), ...(jwt ? {'cf-access-jwt-assertion':jwt}:{}) };
  if (method==='POST') { headers.origin=origin;headers['content-type']='application/json';}
  return new Request(host+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function dbFixture(){
  const db=new TestD1();
  const sqlite=db.sqlite;
  sqlite.prepare("INSERT INTO users(name,email,password_hash,role,email_verified_at) VALUES(?,?,?,'customer',CURRENT_TIMESTAMP)")
    .run('Test A','a@example.invalid','test-hash');
  sqlite.prepare("INSERT INTO users(name,email,password_hash,role,email_verified_at) VALUES(?,?,?,'customer',CURRENT_TIMESTAMP)")
    .run('Test B','b@example.invalid','test-hash');
  sqlite.prepare("INSERT INTO users(name,email,password_hash,role,email_verified_at) VALUES(?,?,?,'admin',CURRENT_TIMESTAMP)")
    .run('Test Admin','admin@example.invalid','test-hash');
  sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 day'))")
    .run(await hashSessionToken('x'.repeat(43)));
  sqlite.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,2,datetime('now','+1 day'))")
    .run(await hashSessionToken('y'.repeat(43)));
  return db;
}
const env = (db,extra={})=>({
 DB:db, WORLDTV_STAGING_AUTH_ENABLED:'true', WORLDTV_STAGING_POCKETI_MANUAL_ENABLED:'true',
 WORLDTV_STAGING_ADMIN_ENABLED:'true', WORLDTV_ACCESS_TEAM_DOMAIN:TEAM,WORLDTV_ACCESS_AUD:AUD,
 WORLDTV_STAGING_ADMIN_EMAILS:'admin@example.invalid', ...extra
});
const ctx=(db,req,extra={})=>({request:req,env:env(db,extra)});
const postReport=(db,reference=REF,cookie=COOKIE_A,extra={})=>report(ctx(db,
 makeRequest('/api/staging/payment/pocketi-manual-report',{method:'POST',cookie,body:{reference}}),extra));
function b64(data){return Buffer.from(data).toString('base64url');}
async function adminJwt(){
 const {privateKey,publicKey}=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',publicKey);jwk.kid='test-key';
 const now=Math.floor(Date.now()/1000);
 const payload={iss:TEAM,aud:AUD,email:'admin@example.invalid',exp:now+300,iat:now,sub:'trusted-admin'};
 const signing=b64(JSON.stringify({alg:'RS256',kid:'test-key'}))+'.'+b64(JSON.stringify(payload));
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(signing));
 return {jwt:signing+'.'+b64(signature),fetchJwks:async()=>({ok:true,json:async()=>({keys:[jwk]})})};
}

test('manual Pocketi routes disabled by default, and blocked outside preview',async()=>{
 const db=await dbFixture();
 assert.equal((await postReport(db,REF,COOKIE_A,{WORLDTV_STAGING_POCKETI_MANUAL_ENABLED:'false'})).status,404);
 assert.equal((await adminReports(ctx(db,makeRequest('/api/staging/admin/pocketi-manual-reports'),
   {WORLDTV_STAGING_POCKETI_MANUAL_ENABLED:'false'}))).status,404);
 assert.equal((await report(ctx(db,makeRequest('/api/staging/payment/pocketi-manual-report',
   {method:'POST',cookie:COOKIE_A,host:'https://myworldtvlive.com',body:{reference:REF},origin:'https://myworldtvlive.com'})))).status,404);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) as n FROM pocketi_manual_reports').get().n,0);
});
test('only authenticated verified customers can submit test refs, and cannot self-mark paid',async()=>{
 const db=await dbFixture();
 assert.equal((await postReport(db,REF,'')).status,401);
 assert.equal((await postReport(db,'REAL-POCKETI-TRANSACTION')).status,400);
 const cross=await report(ctx(db,makeRequest('/api/staging/payment/pocketi-manual-report',
   {method:'POST',cookie:COOKIE_A,origin:'https://attacker.invalid',body:{reference:REF}})));
 assert.equal(cross.status,403);
 const claimed=await report(ctx(db,makeRequest('/api/staging/payment/pocketi-manual-report',
   {method:'POST',cookie:COOKIE_A,body:{reference:REF,paid:true,user_id:2}})));
 assert.equal(claimed.status,201);
 const json=await claimed.json();
 assert.equal(json.status,'pending_review');
 const row=db.sqlite.prepare('SELECT user_id,status,reviewed_by FROM pocketi_manual_reports').get();
 assert.equal(row.user_id,1);
 assert.equal(row.status,'pending');
 assert.equal(row.reviewed_by,null);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM subscription_codes').get().n,0);
 assert.equal((await postReport(db)).status,409);
 const foreign=await ownReports(ctx(db,makeRequest('/api/staging/payment/pocketi-manual-report',{cookie:COOKIE_B})));
 assert.deepEqual((await foreign.json()).reports,[]);
 const own=await ownReports(ctx(db,makeRequest('/api/staging/payment/pocketi-manual-report',{cookie:COOKIE_A})));
 assert.equal((await own.json()).reports.length,1);
});
test('Pocketi admin review requires signed Access identity plus independent merchant attestation',async()=>{
 const db=await dbFixture();
 await postReport(db);
 const base='/api/staging/admin/pocketi-manual-review';
 const body={report_id:1,decision:'verified',verified_amount_pesewas:25000,
  review_note:'Matched merchant transaction record and settled GHS amount',merchant_confirmed:true};
 const anon=await review(ctx(db,makeRequest(base,{method:'POST',body})));
 assert.equal(anon.status,403);
 const {jwt,fetchJwks}=await adminJwt();
 const request=(data,origin=HOST)=>makeRequest(base,{method:'POST',body:data,jwt,origin});
 const adminCtx=(req)=>({request:req,env:env(db),data:{accessJwksFetch:fetchJwks}});
 assert.equal((await review(adminCtx(request(body,'https://attacker.invalid')))).status,403);
 assert.equal((await review(adminCtx(request({...body,merchant_confirmed:false})))).status,400);
 assert.equal((await review(adminCtx(request({...body,verified_amount_pesewas:null})))).status,400);
 assert.equal(db.sqlite.prepare('SELECT status FROM pocketi_manual_reports').get().status,'pending');
 const success=await review(adminCtx(request(body)));
 assert.equal(success.status,200);
 assert.equal((await success.json()).subscription_activated,false);
 assert.equal((await review(adminCtx(request(body)))).status,409);
 const merchantReport=await adminReports(adminCtx(makeRequest('/api/staging/admin/pocketi-manual-reports',{jwt})));
 assert.equal(merchantReport.status,200);
 assert.equal((await merchantReport.json()).reports[0].status,'verified');
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='paid'").get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM subscription_codes').get().n,0);
});
test('staging UI contains no Pocketi live checkout link or claim of automatic delivery',async()=>{
 const db=await dbFixture();
 const lab=await stagingLab(ctx(db,makeRequest('/staging-lab'),{WORLDTV_STAGING_UI_ENABLED:'true'}));
 assert.equal(lab.status,200);const html=await lab.text();
 assert.match(html,/WTVTEST-POCKETI-/);
 assert.match(html,/pocketi-manual-report/);
 assert.doesNotMatch(html,/pocketi\.shop/);
 const {jwt,fetchJwks}=await adminJwt();
 const admin=await stagingAdminUI({request:makeRequest('/staging-admin',{jwt}),
  env:env(db,{WORLDTV_STAGING_ADMIN_UI_ENABLED:'true'}),data:{accessJwksFetch:fetchJwks}});
 assert.equal(admin.status,200);
 const ui=await admin.text();
 assert.match(ui,/pocketi-manual-review/);
 assert.match(ui,/merchant_confirmed/);
});
