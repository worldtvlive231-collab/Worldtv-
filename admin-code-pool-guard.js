'use strict';

const Database=require('better-sqlite3');

const originalPrepare=Database.prototype.prepare;
Database.prototype.prepare=function worldTvAdminCodePoolPrepare(sql,...args){
  let source=String(sql||'');
  const normalized=source.replace(/\s+/g,' ').trim().toLowerCase();

  const directCodeSelectors=new Set([
    "select id,code from subscription_codes where plan_id=? and status='unused' order by id asc limit 1",
    "select id, code from subscription_codes where plan_id=? and status='unused' order by id asc limit 1",
    "select id,code from subscription_codes where plan_id=? and status='unused' order by id limit 1",
    "select id, code from subscription_codes where plan_id=? and status='unused' order by id limit 1"
  ]);

  if(directCodeSelectors.has(normalized)){
    source=source.replace(/status\s*=\s*'unused'/i,"status='unused' AND reseller_id IS NULL");
  }

  const directAssignment=/update\s+subscription_codes\s+set\s+status\s*=\s*'used'\s*,\s*user_id\s*=\s*\?\s*,\s*expires_at\s*=\s*\?\s+where\s+id\s*=\s*\?\s+and\s+status\s*=\s*'unused'/i;
  if(directAssignment.test(source) && !/reseller_id\s+is\s+null/i.test(source)){
    source=source.replace(/and\s+status\s*=\s*'unused'/i,"AND status='unused' AND reseller_id IS NULL");
  }

  return originalPrepare.call(this,source,...args);
};

console.log('WORLD TV admin subscription code pool guard enabled');
