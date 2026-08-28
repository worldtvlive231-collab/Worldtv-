"use strict";

require("dotenv").config();
const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(process.cwd(), "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");

function tableExists(name){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function columnExists(table, column){
  if(!tableExists(table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function installSalesAccounting(){
  if(!tableExists("subscription_codes") || !tableExists("orders")) return false;

  // Every subscription code has a real inventory cost. Keep old codes usable and
  // default historical/missing costs to the business default of US$4 per code.
  if(!columnExists("subscription_codes", "cost_price_usd")){
    db.prepare("ALTER TABLE subscription_codes ADD COLUMN cost_price_usd REAL NOT NULL DEFAULT 4").run();
  }
  db.prepare("UPDATE subscription_codes SET cost_price_usd=4 WHERE cost_price_usd IS NULL OR cost_price_usd<0").run();

  // Stripe charges subscriptions in USD. Older fulfillment code stored a converted
  // GHS value in orders, which made Live Sales reconvert it using a later FX rate.
  // Normalize both existing and future Stripe orders to the exact USD amount Stripe
  // recorded so revenue and profit remain stable and auditable.
  if(tableExists("stripe_payments")){
    db.prepare(`
      UPDATE orders
      SET currency='USD',
          amount_pesewas=CAST(ROUND((
            SELECT sp.amount_usd * 100
            FROM stripe_payments sp
            WHERE sp.reference=orders.reference
          )) AS INTEGER)
      WHERE status='paid'
        AND EXISTS(
          SELECT 1 FROM stripe_payments sp
          WHERE sp.reference=orders.reference
            AND sp.status IN ('fulfilled','paid','paid_pending_code')
        )
    `).run();

    db.exec(`
      DROP TRIGGER IF EXISTS trg_worldtv_stripe_order_accounting_insert;
      CREATE TRIGGER trg_worldtv_stripe_order_accounting_insert
      AFTER INSERT ON orders
      WHEN NEW.status='paid'
       AND EXISTS(SELECT 1 FROM stripe_payments sp WHERE sp.reference=NEW.reference)
      BEGIN
        UPDATE orders
        SET currency='USD',
            amount_pesewas=CAST(ROUND((
              SELECT sp.amount_usd * 100
              FROM stripe_payments sp
              WHERE sp.reference=NEW.reference
            )) AS INTEGER)
        WHERE id=NEW.id;
      END;

      DROP TRIGGER IF EXISTS trg_worldtv_stripe_order_accounting_update;
      CREATE TRIGGER trg_worldtv_stripe_order_accounting_update
      AFTER UPDATE OF status ON orders
      WHEN NEW.status='paid'
       AND EXISTS(SELECT 1 FROM stripe_payments sp WHERE sp.reference=NEW.reference)
      BEGIN
        UPDATE orders
        SET currency='USD',
            amount_pesewas=CAST(ROUND((
              SELECT sp.amount_usd * 100
              FROM stripe_payments sp
              WHERE sp.reference=NEW.reference
            )) AS INTEGER)
        WHERE id=NEW.id;
      END;
    `);
  }

  return true;
}

function runMigration(){
  try{
    if(installSalesAccounting()){
      console.log("WORLD TV sales accounting normalized: Stripe=USD, subscription code cost default=$4");
      return;
    }
  }catch(error){
    console.error("WORLD TV sales accounting migration failed:", error.message);
  }
}

// Preload modules execute before server.js. setImmediate lets server.js finish its
// table creation on a fresh database, while still installing accounting rules before
// normal HTTP traffic is processed.
setImmediate(runMigration);
