'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(process.cwd(), 'data', 'worldtv.sqlite');
const helperDb = new Database(dbPath);
helperDb.pragma('journal_mode=WAL');

const WINDOW_SECONDS = 120;

function cleanupExistingDuplicates(){
  try{
    helperDb.prepare(`
      DELETE FROM analytics_v2_events AS e
      WHERE e.event_type='download_click'
        AND EXISTS (
          SELECT 1
          FROM analytics_v2_events AS p
          WHERE p.event_type='download_click'
            AND p.visitor_id=e.visitor_id
            AND p.id<e.id
            AND (strftime('%s',e.created_at)-strftime('%s',p.created_at)) BETWEEN 0 AND ?
        )
    `).run(WINDOW_SECONDS);
  }catch(e){
    if(!/no such table/i.test(String(e && e.message || ''))){
      console.error('Download analytics cleanup error:', e.message);
    }
  }
}

cleanupExistingDuplicates();

// better-sqlite3 statements share this prototype. Intercept only analytics event inserts
// and suppress repeated download requests from the same visitor for 2 minutes.
const probe = helperDb.prepare('SELECT 1');
const StatementProto = Object.getPrototypeOf(probe);
const originalRun = StatementProto.run;

if(!StatementProto.__wtvDownloadDedupePatched){
  Object.defineProperty(StatementProto, '__wtvDownloadDedupePatched', {value:true});
  StatementProto.run = function patchedRun(...args){
    try{
      const source = String(this.source || '');
      if(source.includes('INSERT INTO analytics_v2_events') && args[1] === 'download_click'){
        const visitorId = String(args[0] || '').trim();
        if(visitorId){
          const recent = helperDb.prepare(`
            SELECT id
            FROM analytics_v2_events
            WHERE visitor_id=?
              AND event_type='download_click'
              AND created_at >= datetime('now', '-' || ? || ' seconds')
            ORDER BY id DESC
            LIMIT 1
          `).get(visitorId, WINDOW_SECONDS);
          if(recent){
            return {changes:0,lastInsertRowid:recent.id};
          }
        }
      }
    }catch(e){
      console.error('Download analytics dedupe check error:', e.message);
    }
    return originalRun.apply(this,args);
  };
}

process.on('exit',()=>{
  try{ helperDb.close(); }catch(e){}
});
