'use strict';

const path=require('path');
const fs=require('fs');
const express=require('express');
const Database=require('better-sqlite3');
const db=new Database(path.join(process.cwd(),'data','worldtv.sqlite'));
db.pragma('journal_mode=WAL');

function injectHtml(filePath,scriptSrc,res){
  fs.readFile(filePath,'utf8',(err,html)=>{
    if(err)return res.status(500).send('Page unavailable');
    const tag=`<script src="${scriptSrc}?v=20260821"></script>`;
    res.type('html').send(html.includes('</body>')?html.replace('</body>',tag+'\n</body>'):html+tag);
  });
}

const originalStatic=express.static;
express.static=function patchedStatic(root,...args){
  const middleware=originalStatic(root,...args);
  return function(req,res,next){
    const p=String(req.path||'').toLowerCase();
    if(p==='/admin.html')return injectHtml(path.join(root,'admin.html'),'/assets/reseller-admin-controls.js',res);
    if(p==='/reseller.html')return injectHtml(path.join(root,'reseller.html'),'/assets/reseller-panel-enhancements.js',res);
    return middleware(req,res,next);
  };
};

function getCodeControl(req,res){
  const id=Number(req.params.id);
  const reseller=db.prepare('SELECT id,name,email,status FROM resellers WHERE id=?').get(id);
  if(!reseller)return res.status(404).json({error:'Reseller not found'});
  const quota=db.prepare('SELECT allocated_count,used_count,available_count FROM reseller_code_allocation WHERE reseller_id=?').get(id)||{allocated_count:0,used_count:0,available_count:0};
  const codes=db.prepare(`SELECT id,code,status,created_at,expires_at FROM subscription_codes WHERE reseller_id=? ORDER BY id DESC LIMIT 2000`).all(id);
  res.json({reseller,quota,codes});
}

function revokeCredits(req,res){
  const id=Number(req.params.id),count=Math.floor(Number(req.body&&req.body.count));
  if(!Number.isFinite(count)||count<1)return res.status(400).json({error:'Enter a positive number of credits to revoke.'});
  const quota=db.prepare('SELECT * FROM reseller_code_allocation WHERE reseller_id=?').get(id);
  if(!quota)return res.status(404).json({error:'No code allocation found for this reseller.'});
  if(count>Number(quota.available_count||0))return res.status(400).json({error:`Only ${quota.available_count||0} unused credits are available to revoke.`});
  db.prepare(`UPDATE reseller_code_allocation SET available_count=available_count-?,allocated_count=allocated_count-?,updated_at=CURRENT_TIMESTAMP WHERE reseller_id=?`).run(count,count,id);
  res.json({ok:true,revoked:count});
}

function revokeGeneratedCode(req,res){
  const id=Number(req.params.id),code=String(req.body&&req.body.code||'').trim().toUpperCase();
  if(!code)return res.status(400).json({error:'Code is required.'});
  const row=db.prepare('SELECT id,code,status FROM subscription_codes WHERE reseller_id=? AND code=?').get(id,code);
  if(!row)return res.status(404).json({error:'Code not found on this reseller account.'});
  if(String(row.status).toLowerCase()==='used')return res.status(400).json({error:'An already-used customer code cannot be revoked from here.'});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE subscription_codes SET status='revoked', reseller_id=NULL WHERE id=?").run(row.id);
    const q=db.prepare('SELECT * FROM reseller_code_allocation WHERE reseller_id=?').get(id);
    if(q){
      const used=Math.max(0,Number(q.used_count||0)-1);
      const allocated=Math.max(Number(q.available_count||0),Number(q.allocated_count||0)-1);
      db.prepare('UPDATE reseller_code_allocation SET used_count=?,allocated_count=?,updated_at=CURRENT_TIMESTAMP WHERE reseller_id=?').run(used,allocated,id);
    }
  });
  tx();
  res.json({ok:true,code});
}

function deleteReseller(req,res){
  const id=Number(req.params.id);
  const reseller=db.prepare('SELECT id,name,email,status FROM resellers WHERE id=?').get(id);
  if(!reseller)return res.status(404).json({error:'Reseller not found'});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE resellers SET status='deleted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    const q=db.prepare('SELECT available_count FROM reseller_code_allocation WHERE reseller_id=?').get(id);
    if(q&&Number(q.available_count||0)>0){
      db.prepare('UPDATE reseller_code_allocation SET allocated_count=MAX(0,allocated_count-available_count),available_count=0,updated_at=CURRENT_TIMESTAMP WHERE reseller_id=?').run(id);
    }
  });
  tx();
  res.json({ok:true,message:'Reseller account deleted. Login is disabled and unused credits were revoked.'});
}

const originalGet=express.application.get;
const originalPost=express.application.post;
const originalDelete=express.application.delete;

express.application.get=function patchedGet(routePath,...handlers){
  if(routePath==='/admin')return originalGet.call(this,routePath,(req,res)=>injectHtml(path.join(process.cwd(),'admin.html'),'/assets/reseller-admin-controls.js',res));
  if(routePath==='/reseller')return originalGet.call(this,routePath,(req,res)=>injectHtml(path.join(process.cwd(),'reseller.html'),'/assets/reseller-panel-enhancements.js',res));

  if((routePath==='/api/admin/resellers-with-quotas'||routePath==='/api/admin/resellers')&&handlers.length){
    const finalHandler=handlers[handlers.length-1];
    if(typeof finalHandler==='function'){
      const wrapped=function(req,res,next){
        const json=res.json.bind(res);
        res.json=payload=>json(Array.isArray(payload)?payload.filter(r=>String(r.status||'active')!=='deleted'):payload);
        return finalHandler(req,res,next);
      };
      const result=originalGet.call(this,routePath,...handlers.slice(0,-1),wrapped);
      if(routePath==='/api/admin/resellers'&&!this.__wtvResellerAdminControlRoutes){
        const adminOnly=handlers[0];
        originalGet.call(this,'/api/admin/resellers/:id/code-control',adminOnly,getCodeControl);
        originalPost.call(this,'/api/admin/resellers/:id/revoke-credits',adminOnly,revokeCredits);
        originalPost.call(this,'/api/admin/resellers/:id/revoke-code',adminOnly,revokeGeneratedCode);
        originalDelete.call(this,'/api/admin/resellers/:id',adminOnly,deleteReseller);
        this.__wtvResellerAdminControlRoutes=true;
      }
      return result;
    }
  }
  return originalGet.call(this,routePath,...handlers);
};
