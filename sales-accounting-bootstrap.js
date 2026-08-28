"use strict";

require("dotenv").config();
const path = require("path");
const Database = require("better-sqlite3");
const express = require("express");
const { getExchangeRates } = require("./exchange-rates");

const db = new Database(path.join(process.cwd(), "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("busy_timeout=5000");
const DEFAULT_CODE_COST_USD = 4;

function tableExists(name){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function columnExists(table, column){
  if(!tableExists(table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

async function dashboardUsdRate(){
  try{
    const result = await getExchangeRates();
    const rate = Number(result?.rates?.USD);
    if(Number.isFinite(rate) && rate > 0) return rate;
  }catch(_){ }
  return 0.084;
}

function pendingPaymentsBetween(startDate,endDate){
  if(!tableExists("checkout_requests")){
    return { transaction_count:0, revenue_usd:0, unique_customers:0 };
  }
  const stripeJoin = tableExists("stripe_payments")
    ? "LEFT JOIN stripe_payments sp ON sp.reference=c.reference"
    : "";
  const amountSql = tableExists("stripe_payments")
    ? "CASE WHEN sp.reference IS NOT NULL THEN sp.amount_usd ELSE c.final_amount_usd END"
    : "c.final_amount_usd";
  return db.prepare(`
    SELECT
      COUNT(*) AS transaction_count,
      COALESCE(SUM(${amountSql}),0) AS revenue_usd,
      COUNT(DISTINCT c.user_id) AS unique_customers
    FROM checkout_requests c
    ${stripeJoin}
    WHERE c.status='payment_confirmed'
      AND DATE(c.updated_at) BETWEEN ? AND ?
      AND NOT EXISTS(
        SELECT 1 FROM orders o
        WHERE o.reference=c.reference AND o.status='paid'
      )
  `).get(startDate,endDate);
}

function pendingPaymentsForDate(date){
  return pendingPaymentsBetween(date,date);
}

function subscriptionCustomersForDate(date){
  if(!tableExists("checkout_requests")){
    return Number(db.prepare(`
      SELECT COUNT(DISTINCT user_id) n
      FROM orders
      WHERE status='paid' AND DATE(paid_at)=?
    `).get(date).n||0);
  }
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT user_id) n FROM (
      SELECT user_id FROM orders
      WHERE status='paid' AND DATE(paid_at)=?
      UNION ALL
      SELECT c.user_id FROM checkout_requests c
      WHERE c.status='payment_confirmed'
        AND DATE(c.updated_at)=?
        AND NOT EXISTS(
          SELECT 1 FROM orders o
          WHERE o.reference=c.reference AND o.status='paid'
        )
    )
  `).get(date,date).n||0);
}

async function enhancedLiveSummary(req,res){
  try{
    const today = new Date().toISOString().split("T")[0];
    const usdRate = await dashboardUsdRate();

    const todaySales = db.prepare(`
      SELECT
        COUNT(*) AS transaction_count,
        COALESCE(SUM(CASE WHEN UPPER(o.currency)='USD' THEN o.amount_pesewas/100.0 ELSE 0 END),0) AS revenue_usd,
        COALESCE(SUM(CASE WHEN UPPER(o.currency)<>'USD' THEN o.amount_pesewas/100.0 ELSE 0 END),0) AS revenue_ghs,
        COALESCE(SUM(sc.cost_price_usd),0) AS total_code_cost,
        COUNT(DISTINCT o.user_id) AS unique_customers
      FROM orders o
      LEFT JOIN subscription_codes sc ON sc.id=o.code_id
      WHERE o.status='paid' AND DATE(o.paid_at)=?
    `).get(today);

    const pending = pendingPaymentsForDate(today);
    todaySales.transaction_count = Number(todaySales.transaction_count||0) + Number(pending.transaction_count||0);
    todaySales.revenue_usd = Number(todaySales.revenue_usd||0) + Number(pending.revenue_usd||0);
    todaySales.total_code_cost = Number(todaySales.total_code_cost||0) + Number(pending.transaction_count||0) * DEFAULT_CODE_COST_USD;
    todaySales.unique_customers = subscriptionCustomersForDate(today);
    todaySales.pending_activation_count = Number(pending.transaction_count||0);
    todaySales.pending_activation_revenue_usd = Number(pending.revenue_usd||0);
    todaySales.total_revenue = Number(todaySales.revenue_usd||0) + Number(todaySales.revenue_ghs||0) * usdRate;

    const todayProductOrders = db.prepare(`
      SELECT COUNT(*) AS order_count, SUM(total_ghs) AS total_sales, SUM(quantity) AS items_sold
      FROM product_orders po
      WHERE EXISTS (
        SELECT 1 FROM product_payment_attempts ppa
        WHERE ppa.order_number=po.order_number
          AND ppa.status='paid'
          AND DATE(ppa.updated_at)=?
      )
    `).get(today);
    todayProductOrders.total_sales_usd = Number(todayProductOrders.total_sales||0) * usdRate;

    const todayExpenses = db.prepare(`
      SELECT SUM(amount_ghs) AS total_expenses
      FROM expenses WHERE DATE(expense_date)=?
    `).get(today);
    todayExpenses.total_expenses_usd = Number(todayExpenses.total_expenses||0) * usdRate;

    const stockCount = db.prepare(`
      SELECT
        COUNT(*) AS total_products,
        SUM(CASE WHEN stock_status='in_stock' THEN 1 ELSE 0 END) AS in_stock_count,
        SUM(CASE WHEN stock_status='out_of_stock' THEN 1 ELSE 0 END) AS out_of_stock_count
      FROM products WHERE active=1
    `).get();

    res.setHeader("Cache-Control","no-store");
    res.json({
      today:{ date:today, subscriptions:todaySales, product_orders:todayProductOrders, expenses:todayExpenses },
      inventory:stockCount
    });
  }catch(error){
    console.error("Enhanced Live Sales summary failed:", error);
    res.status(500).json({error:error.message});
  }
}

async function enhancedRecentSales(req,res){
  try{
    const usdRate = await dashboardUsdRate();
    const sales = db.prepare(`
      SELECT
        'subscription' AS type,
        o.reference AS ref_id,
        o.amount_pesewas/100.0 AS amount_original,
        o.currency,
        o.status,
        o.paid_at AS timestamp,
        u.name AS customer_name,
        p.name AS product_name,
        COALESCE(sc.cost_price_usd,0) AS cost_usd
      FROM orders o
      JOIN users u ON u.id=o.user_id
      JOIN plans p ON p.id=o.plan_id
      LEFT JOIN subscription_codes sc ON sc.id=o.code_id
      WHERE o.status='paid'

      UNION ALL

      SELECT
        'subscription' AS type,
        c.reference AS ref_id,
        ${tableExists("stripe_payments") ? "CASE WHEN sp.reference IS NOT NULL THEN sp.amount_usd ELSE c.final_amount_usd END" : "c.final_amount_usd"} AS amount_original,
        'USD' AS currency,
        'Paid — Activation Pending' AS status,
        c.updated_at AS timestamp,
        u.name AS customer_name,
        p.name AS product_name,
        ${DEFAULT_CODE_COST_USD} AS cost_usd
      FROM checkout_requests c
      JOIN users u ON u.id=c.user_id
      JOIN plans p ON p.id=c.plan_id
      ${tableExists("stripe_payments") ? "LEFT JOIN stripe_payments sp ON sp.reference=c.reference" : ""}
      WHERE c.status='payment_confirmed'
        AND NOT EXISTS(
          SELECT 1 FROM orders o
          WHERE o.reference=c.reference AND o.status='paid'
        )

      UNION ALL

      SELECT
        'product' AS type,
        po.order_number AS ref_id,
        po.total_ghs AS amount_original,
        'GHS' AS currency,
        'paid' AS status,
        MAX(ppa.updated_at) AS timestamp,
        po.customer_name,
        pr.name AS product_name,
        0 AS cost_usd
      FROM product_orders po
      JOIN product_payment_attempts ppa
        ON ppa.order_number=po.order_number AND ppa.status='paid'
      LEFT JOIN products pr ON pr.id=po.product_id
      GROUP BY po.id

      ORDER BY timestamp DESC
      LIMIT 50
    `).all();

    res.setHeader("Cache-Control","no-store");
    res.json(sales.map(s=>{
      const amountUsd = Number(s.amount_original||0) * (String(s.currency||"").toUpperCase()==="USD" ? 1 : usdRate);
      return { ...s, amount_usd:amountUsd, profit_usd:amountUsd-Number(s.cost_usd||0) };
    }));
  }catch(error){
    console.error("Enhanced recent sales failed:", error);
    res.status(500).json({error:error.message});
  }
}

async function enhancedProfitSummary(req,res){
  try{
    const today = new Date().toISOString().split("T")[0];
    const usdRate = await dashboardUsdRate();
    const monthStartDate = new Date();
    monthStartDate.setUTCDate(1);
    const monthStart = monthStartDate.toISOString().split("T")[0];

    const calculate = (start,end) => {
      const fulfilled = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN UPPER(o.currency)='USD' THEN o.amount_pesewas/100.0 ELSE 0 END),0) usd,
          COALESCE(SUM(CASE WHEN UPPER(o.currency)<>'USD' THEN o.amount_pesewas/100.0 ELSE 0 END),0) ghs,
          COALESCE(SUM(sc.cost_price_usd),0) code_cost
        FROM orders o
        LEFT JOIN subscription_codes sc ON sc.id=o.code_id
        WHERE o.status='paid' AND DATE(o.paid_at) BETWEEN ? AND ?
      `).get(start,end);
      const pending = pendingPaymentsBetween(start,end);
      const subscriptionRevenue = Number(fulfilled.usd||0) + Number(fulfilled.ghs||0)*usdRate + Number(pending.revenue_usd||0);
      const subscriptionCost = Number(fulfilled.code_cost||0) + Number(pending.transaction_count||0)*DEFAULT_CODE_COST_USD;
      const productRevenue = Number(db.prepare(`
        SELECT COALESCE(SUM(po.total_ghs),0) total FROM product_orders po
        WHERE EXISTS (
          SELECT 1 FROM product_payment_attempts ppa
          WHERE ppa.order_number=po.order_number
            AND ppa.status='paid'
            AND DATE(ppa.updated_at) BETWEEN ? AND ?
        )
      `).get(start,end).total||0)*usdRate;
      const expenses = Number(db.prepare(`
        SELECT COALESCE(SUM(amount_ghs),0) total
        FROM expenses WHERE DATE(expense_date) BETWEEN ? AND ?
      `).get(start,end).total||0)*usdRate;
      const revenue = subscriptionRevenue + productRevenue;
      return {
        subscription_revenue:subscriptionRevenue,
        subscription_cost:subscriptionCost,
        subscription_profit:subscriptionRevenue-subscriptionCost,
        product_revenue:productRevenue,
        revenue,
        expenses,
        profit:revenue-subscriptionCost-expenses,
        pending_activation_count:Number(pending.transaction_count||0),
        pending_activation_revenue_usd:Number(pending.revenue_usd||0)
      };
    };

    res.setHeader("Cache-Control","no-store");
    res.json({today:calculate(today,today),this_month:calculate(monthStart,today)});
  }catch(error){
    console.error("Enhanced profit summary failed:",error);
    res.status(500).json({error:error.message});
  }
}

async function enhancedDailyReport(req,res){
  try{
    const usdRate = await dashboardUsdRate();
    const rows=[];
    const now=new Date();
    for(let i=0;i<=30;i++){
      const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-i));
      const date=d.toISOString().split("T")[0];
      const fulfilled=db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN UPPER(o.currency)='USD' THEN o.amount_pesewas/100.0 ELSE 0 END),0) revenue_usd,
          COALESCE(SUM(CASE WHEN UPPER(o.currency)<>'USD' THEN o.amount_pesewas/100.0 ELSE 0 END),0) revenue_ghs,
          COALESCE(SUM(sc.cost_price_usd),0) code_cost
        FROM orders o
        LEFT JOIN subscription_codes sc ON sc.id=o.code_id
        WHERE o.status='paid' AND DATE(o.paid_at)=?
      `).get(date);
      const pending=pendingPaymentsForDate(date);
      const subscriptionRevenue=Number(fulfilled.revenue_usd||0)+Number(fulfilled.revenue_ghs||0)*usdRate+Number(pending.revenue_usd||0);
      const subscriptionCost=Number(fulfilled.code_cost||0)+Number(pending.transaction_count||0)*DEFAULT_CODE_COST_USD;
      const productRevenue=Number(db.prepare(`
        SELECT COALESCE(SUM(po.total_ghs),0) total FROM product_orders po
        WHERE EXISTS (
          SELECT 1 FROM product_payment_attempts ppa
          WHERE ppa.order_number=po.order_number
            AND ppa.status='paid'
            AND DATE(ppa.updated_at)=?
        )
      `).get(date).total||0)*usdRate;
      const expenses=Number(db.prepare(`
        SELECT COALESCE(SUM(amount_ghs),0) total FROM expenses WHERE DATE(expense_date)=?
      `).get(date).total||0)*usdRate;
      rows.push({
        date,
        subscription_revenue:subscriptionRevenue,
        subscription_cost:subscriptionCost,
        product_revenue:productRevenue,
        expenses,
        customers:subscriptionCustomersForDate(date),
        pending_activation_count:Number(pending.transaction_count||0),
        pending_activation_revenue_usd:Number(pending.revenue_usd||0)
      });
    }
    res.setHeader("Cache-Control","no-store");
    res.json(rows);
  }catch(error){
    console.error("Enhanced daily report failed:",error);
    res.status(500).json({error:error.message});
  }
}

// Preserve the server's existing admin authentication middleware while replacing
// only final dashboard data handlers. All dashboard views then follow the same
// accounting rules for fulfilled and payment-confirmed/pending-activation sales.
const originalGet = express.application.get;
express.application.get = function worldTvSalesAccountingGet(route, ...handlers){
  if(route === "/api/admin/dashboard/live-summary" && handlers.length){
    handlers[handlers.length-1] = enhancedLiveSummary;
  }else if(route === "/api/admin/dashboard/recent-sales" && handlers.length){
    handlers[handlers.length-1] = enhancedRecentSales;
  }else if(route === "/api/admin/dashboard/profit-summary" && handlers.length){
    handlers[handlers.length-1] = enhancedProfitSummary;
  }else if(route === "/api/admin/dashboard/daily-report" && handlers.length){
    handlers[handlers.length-1] = enhancedDailyReport;
  }
  return originalGet.call(this, route, ...handlers);
};

function installSalesAccounting(){
  if(!tableExists("subscription_codes") || !tableExists("orders")) return false;

  if(!columnExists("subscription_codes", "cost_price_usd")){
    db.prepare("ALTER TABLE subscription_codes ADD COLUMN cost_price_usd REAL NOT NULL DEFAULT 4").run();
  }
  db.prepare("UPDATE subscription_codes SET cost_price_usd=4 WHERE cost_price_usd IS NULL OR cost_price_usd<0").run();

  if(tableExists("stripe_payments")){
    db.prepare(`
      UPDATE orders
      SET currency='USD',
          amount_pesewas=CAST(ROUND((
            SELECT sp.amount_usd * 100 FROM stripe_payments sp
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
              SELECT sp.amount_usd * 100 FROM stripe_payments sp
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
              SELECT sp.amount_usd * 100 FROM stripe_payments sp
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
    }
  }catch(error){
    console.error("WORLD TV sales accounting migration failed:", error.message);
  }
}

setImmediate(runMigration);
