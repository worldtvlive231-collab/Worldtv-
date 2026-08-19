require("dotenv").config();

const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const { getExchangeRates } = require("./exchange-rates");

const db = new Database(path.join(__dirname, "data", "worldtv.sqlite"));
db.pragma("journal_mode=WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS paypal_payments(
  reference TEXT PRIMARY KEY,
  paypal_order_id TEXT NOT NULL UNIQUE,
  amount_usd REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  capture_id TEXT,
  captured_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_paypal_payments_order_id
  ON paypal_payments(paypal_order_id);
`);

const mode = String(process.env.PAYPAL_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
const apiBase = mode === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

let tokenCache = { token: "", expiresAt: 0 };

function paypalConfigured(){
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function getAccessToken(){
  if(!paypalConfigured()) throw new Error("PayPal is not configured");

  if(tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000){
    return tokenCache.token;
  }

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json().catch(()=>({}));

  if(!response.ok || !data.access_token){
    console.error("PayPal OAuth error:", data);
    throw new Error(data.error_description || "Could not connect to PayPal");
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 300) * 1000)
  };

  return tokenCache.token;
}

async function paypalRequest(endpoint, options={}){
  const accessToken = await getAccessToken();
  const response = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(()=>({}));
  return { response, data };
}

async function usdAmountForGhs(ghsAmount){
  const ratesResult = await getExchangeRates();
  const rates = ratesResult?.rates || ratesResult?.data?.rates || {};
  const usdRate = Number(rates.USD);

  if(!Number.isFinite(usdRate) || usdRate <= 0){
    throw new Error("USD exchange rate is unavailable");
  }

  const value = Number(ghsAmount) * usdRate;
  if(!Number.isFinite(value) || value <= 0) throw new Error("Invalid payment amount");

  return Number(value.toFixed(2));
}

function checkoutByReference(reference){
  return db.prepare(`
    SELECT c.*,p.name AS plan_name,p.duration_days,u.email
    FROM checkout_requests c
    JOIN plans p ON p.id=c.plan_id
    JOIN users u ON u.id=c.user_id
    WHERE c.reference=?
  `).get(reference);
}

function alreadyFulfilled(reference){
  return db.prepare(`
    SELECT o.reference,sc.code,sc.expires_at
    FROM orders o
    LEFT JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.reference=? AND o.status='paid'
  `).get(reference);
}

function fulfillCheckout(reference){
  const existing = alreadyFulfilled(reference);
  if(existing){
    return {
      ok:true,
      paid:true,
      fulfilled:true,
      already_processed:true,
      code:existing.code || null,
      expires_at:existing.expires_at || null
    };
  }

  const checkout = checkoutByReference(reference);
  if(!checkout) throw new Error("Checkout not found");

  const code = db.prepare(`
    SELECT id,code
    FROM subscription_codes
    WHERE plan_id=? AND status='unused'
    ORDER BY id
    LIMIT 1
  `).get(checkout.plan_id);

  if(!code){
    db.prepare(`
      UPDATE checkout_requests
      SET status='payment_confirmed',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(checkout.id);

    return {
      ok:true,
      paid:true,
      fulfilled:false,
      message:"Payment received successfully. Subscription activation is pending because no unused subscription code is available."
    };
  }

  let start = new Date();
  const current = db.prepare(`
    SELECT MAX(sc.expires_at) AS expiry
    FROM orders o
    JOIN subscription_codes sc ON sc.id=o.code_id
    WHERE o.user_id=? AND o.status='paid'
  `).get(checkout.user_id);

  if(current?.expiry && new Date(current.expiry) > start){
    start = new Date(current.expiry);
  }

  const expiry = new Date(start);
  expiry.setUTCDate(expiry.getUTCDate() + Number(checkout.duration_days));
  const expiresAt = expiry.toISOString();
  const paidAt = new Date().toISOString();
  const expectedAmountPesewas = Math.round(Number(checkout.final_amount_ghs) * 100);

  const tx = db.transaction(()=>{
    const assigned = db.prepare(`
      UPDATE subscription_codes
      SET status='used',user_id=?,expires_at=?
      WHERE id=? AND status='unused'
    `).run(checkout.user_id,expiresAt,code.id);

    if(assigned.changes !== 1){
      throw new Error("Subscription code assignment failed");
    }

    db.prepare(`
      INSERT INTO orders(
        reference,user_id,plan_id,amount_pesewas,currency,status,code_id,paid_at
      ) VALUES(?,?,?,?,?,'paid',?,?)
    `).run(
      checkout.reference,
      checkout.user_id,
      checkout.plan_id,
      expectedAmountPesewas,
      "GHS",
      code.id,
      paidAt
    );

    db.prepare(`
      UPDATE checkout_requests
      SET status='fulfilled',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(checkout.id);

    if(checkout.coupon_code){
      db.prepare("UPDATE coupons SET used_count=used_count+1 WHERE code=?")
        .run(checkout.coupon_code);
    }

    db.prepare(`
      INSERT INTO notifications(user_id,title,message)
      VALUES(?,?,?)
    `).run(
      checkout.user_id,
      "Subscription Activated",
      `Your World TV subscription has been activated. Your code is ${code.code}.`
    );
  });

  try{
    tx();
  }catch(error){
    db.prepare(`
      UPDATE checkout_requests
      SET status='payment_confirmed',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(checkout.id);

    console.error("PayPal fulfillment pending:", error);
    return {
      ok:true,
      paid:true,
      fulfilled:false,
      message:"Payment received successfully. Subscription activation is pending."
    };
  }

  return {
    ok:true,
    paid:true,
    fulfilled:true,
    message:"PayPal payment verified and subscription activated",
    code:code.code,
    expires_at:expiresAt
  };
}

function registerRoutes(app){
  app.get("/api/payment/paypal/config", (req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.json({
      ok:true,
      configured:paypalConfigured(),
      mode,
      currency:"USD"
    });
  });

  app.post("/api/payment/paypal/create-order", async (req,res)=>{
    try{
      if(!paypalConfigured()){
        return res.status(503).json({error:"PayPal is not configured"});
      }

      const reference = String(req.body?.reference || "").trim();
      if(!reference) return res.status(400).json({error:"Payment reference required"});

      const checkout = checkoutByReference(reference);
      if(!checkout) return res.status(404).json({error:"Checkout not found"});
      if(checkout.status === "fulfilled"){
        const existing = alreadyFulfilled(reference);
        return res.json({
          ok:true,
          paid:true,
          already_processed:true,
          code:existing?.code || null,
          expires_at:existing?.expires_at || null
        });
      }
      if(checkout.status === "cancelled"){
        return res.status(409).json({error:"This checkout request was cancelled"});
      }

      const amountUsd = await usdAmountForGhs(checkout.final_amount_ghs);
      const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
      if(!base || !base.startsWith("https://")){
        return res.status(500).json({error:"PUBLIC_BASE_URL must be configured with HTTPS for PayPal"});
      }

      const returnUrl = `${base}/subscribe.html?paypal=success&reference=${encodeURIComponent(reference)}`;
      const cancelUrl = `${base}/subscribe.html?paypal=cancelled&reference=${encodeURIComponent(reference)}`;

      const { response, data } = await paypalRequest("/v2/checkout/orders", {
        method:"POST",
        headers:{
          "PayPal-Request-Id": `worldtv-${reference}-${Date.now()}`
        },
        body:JSON.stringify({
          intent:"CAPTURE",
          purchase_units:[{
            reference_id:reference,
            custom_id:reference,
            description:`World TV ${checkout.plan_name} subscription`,
            amount:{
              currency_code:"USD",
              value:amountUsd.toFixed(2)
            }
          }],
          payment_source:{
            paypal:{
              experience_context:{
                brand_name:"World TV",
                shipping_preference:"NO_SHIPPING",
                user_action:"PAY_NOW",
                return_url:returnUrl,
                cancel_url:cancelUrl
              }
            }
          }
        })
      });

      if(!response.ok || !data.id){
        console.error("PayPal create-order error:", data);
        return res.status(502).json({error:data.message || "Could not start PayPal payment"});
      }

      const approval = (data.links || []).find(link =>
        link.rel === "payer-action" || link.rel === "approve"
      );

      if(!approval?.href){
        console.error("PayPal approval URL missing:", data);
        return res.status(502).json({error:"PayPal approval URL was not received"});
      }

      db.prepare(`
        INSERT INTO paypal_payments(reference,paypal_order_id,amount_usd,currency,capture_id,captured_at,updated_at)
        VALUES(?,?,?,'USD',NULL,NULL,CURRENT_TIMESTAMP)
        ON CONFLICT(reference) DO UPDATE SET
          paypal_order_id=excluded.paypal_order_id,
          amount_usd=excluded.amount_usd,
          currency='USD',
          capture_id=NULL,
          captured_at=NULL,
          updated_at=CURRENT_TIMESTAMP
      `).run(reference,data.id,amountUsd);

      res.json({
        ok:true,
        reference,
        paypal_order_id:data.id,
        approval_url:approval.href,
        amount_usd:amountUsd.toFixed(2),
        mode
      });
    }catch(error){
      console.error("PayPal create-order error:", error);
      res.status(500).json({error:error.message || "Could not start PayPal payment"});
    }
  });

  app.post("/api/payment/paypal/capture", async (req,res)=>{
    try{
      if(!paypalConfigured()){
        return res.status(503).json({error:"PayPal is not configured"});
      }

      const reference = String(req.body?.reference || "").trim();
      const orderId = String(req.body?.orderID || req.body?.orderId || "").trim();
      if(!reference || !orderId){
        return res.status(400).json({error:"PayPal order ID and reference are required"});
      }

      const existingOrder = alreadyFulfilled(reference);
      if(existingOrder){
        return res.json({
          ok:true,
          paid:true,
          fulfilled:true,
          already_processed:true,
          code:existingOrder.code || null,
          expires_at:existingOrder.expires_at || null
        });
      }

      const paymentRow = db.prepare(`
        SELECT * FROM paypal_payments
        WHERE reference=? AND paypal_order_id=?
      `).get(reference,orderId);

      if(!paymentRow){
        return res.status(400).json({error:"PayPal order does not match this checkout"});
      }

      if(!paymentRow.captured_at){
        let captureResult = await paypalRequest(
          `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
          {method:"POST",body:"{}"}
        );

        let orderData = captureResult.data;

        if(!captureResult.response.ok){
          const shown = await paypalRequest(
            `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
            {method:"GET"}
          );
          if(!shown.response.ok || shown.data?.status !== "COMPLETED"){
            console.error("PayPal capture error:", captureResult.data);
            return res.status(502).json({
              error:captureResult.data?.message || "Could not capture PayPal payment"
            });
          }
          orderData = shown.data;
        }

        if(orderData.status !== "COMPLETED"){
          return res.status(400).json({
            error:"PayPal payment has not been completed",
            payment_status:orderData.status
          });
        }

        const unit = orderData.purchase_units?.[0] || {};
        const capture = unit.payments?.captures?.[0] || {};
        const captureAmount = capture.amount || unit.amount || {};
        const customId = unit.custom_id || unit.reference_id || "";
        const capturedValue = Number(captureAmount.value);
        const expectedValue = Number(paymentRow.amount_usd);

        if(
          customId !== reference ||
          captureAmount.currency_code !== "USD" ||
          !Number.isFinite(capturedValue) ||
          Math.abs(capturedValue - expectedValue) > 0.001
        ){
          console.error("PayPal payment mismatch:", {
            reference,
            customId,
            capturedValue,
            expectedValue,
            currency:captureAmount.currency_code
          });
          return res.status(400).json({error:"PayPal payment details do not match this subscription"});
        }

        db.prepare(`
          UPDATE paypal_payments
          SET capture_id=?,captured_at=?,updated_at=CURRENT_TIMESTAMP
          WHERE reference=? AND paypal_order_id=?
        `).run(
          capture.id || null,
          capture.create_time || new Date().toISOString(),
          reference,
          orderId
        );
      }

      const result = fulfillCheckout(reference);
      res.json(result);
    }catch(error){
      console.error("PayPal capture error:", error);
      res.status(500).json({error:error.message || "Could not verify PayPal payment"});
    }
  });
}

const originalListen = express.application.listen;
express.application.listen = function patchedPayPalListen(...args){
  if(!this.__worldTvPayPalInstalled){
    this.__worldTvPayPalInstalled = true;
    const router = this._router;
    if(router && Array.isArray(router.stack)){
      const before = router.stack.length;
      registerRoutes(this);
      const added = router.stack.splice(before);
      const insertAt = Math.max(0, router.stack.length - 1);
      router.stack.splice(insertAt,0,...added);
    }else{
      registerRoutes(this);
    }
  }
  return originalListen.apply(this,args);
};
