const fs = require("fs");
const path = require("path");

// Keep admin-uploaded product images on the Railway volume instead of the
// ephemeral application filesystem. The existing server writes to
// /app/public/uploads and stores URLs as /uploads/..., so both paths are linked
// to the same persistent directory before server.js starts.
(function setupPersistentUploads(){
  const appRoot = __dirname;
  const volumeBase = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(appRoot, "data");
  const persistentUploads = path.join(volumeBase, "uploads");
  const publicUploads = path.join(appRoot, "public", "uploads");
  const rootUploads = path.join(appRoot, "uploads");

  fs.mkdirSync(persistentUploads, { recursive: true });

  function copyExistingFiles(sourceDir){
    try{
      if(!fs.existsSync(sourceDir)) return;
      const stat = fs.lstatSync(sourceDir);
      if(!stat.isDirectory() || stat.isSymbolicLink()) return;
      for(const entry of fs.readdirSync(sourceDir, { withFileTypes: true })){
        if(!entry.isFile()) continue;
        const from = path.join(sourceDir, entry.name);
        const to = path.join(persistentUploads, entry.name);
        if(!fs.existsSync(to)) fs.copyFileSync(from, to);
      }
    }catch(err){
      console.warn("[storage] Could not copy existing uploads:", err.message);
    }
  }

  function linkToPersistent(linkPath){
    try{
      if(fs.existsSync(linkPath)){
        const stat = fs.lstatSync(linkPath);
        if(stat.isSymbolicLink()){
          const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
          if(currentTarget === persistentUploads) return;
          fs.unlinkSync(linkPath);
        }else{
          copyExistingFiles(linkPath);
          fs.rmSync(linkPath, { recursive: true, force: true });
        }
      }
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.symlinkSync(persistentUploads, linkPath, "dir");
    }catch(err){
      console.error(`[storage] Could not link ${linkPath}:`, err.message);
    }
  }

  linkToPersistent(publicUploads);
  linkToPersistent(rootUploads);
  console.log(`[storage] Product uploads directory: ${persistentUploads}`);
})();

// Older cached order pages used name/product/customer_phone aliases while the
// backend expects customer_name/product_id/phone. Normalize both shapes so a
// customer can submit successfully even if their browser still has an older
// copy of order.html cached.
(function patchProductOrderCompatibility(){
  const express = require("express");
  const originalPost = express.application.post;

  express.application.post = function(route, ...handlers){
    if(route === "/api/product-orders"){
      handlers.unshift((req, res, next) => {
        const body = req.body || {};
        if(!body.customer_name && body.name) body.customer_name = body.name;
        if(!body.phone && body.customer_phone) body.phone = body.customer_phone;
        if(!body.product_id && body.product) body.product_id = body.product;
        if(!body.delivery_location && body.country && body.shipping_address){
          body.delivery_location = `${String(body.country).trim()} — ${String(body.shipping_address).trim()}`;
        }
        req.body = body;
        next();
      });
    }
    return originalPost.call(this, route, ...handlers);
  };
})();

// Ghana retail price for the WORLD TV Box is GH₵850. International checkout
// pricing is handled separately as the local-currency equivalent of US$100.
(function setWorldTvBoxGhanaPrice(){
  try{
    const Database = require("better-sqlite3");
    const dbPath = path.join(__dirname, "data", "worldtv.sqlite");
    if(!fs.existsSync(dbPath)) return;
    const db = new Database(dbPath);
    const hasProducts = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'").get();
    if(hasProducts){
      const result = db.prepare(`
        UPDATE products
        SET price_ghs=850, updated_at=CURRENT_TIMESTAMP
        WHERE lower(name) LIKE '%world tv%box%'
           OR lower(name) LIKE '%android tv box%'
      `).run();
      if(result.changes) console.log(`[pricing] Updated ${result.changes} WORLD TV Box product(s) to GH₵850 for Ghana.`);
    }
    db.close();
  }catch(err){
    console.warn("[pricing] Could not apply Ghana TV box price:", err.message);
  }
})();
