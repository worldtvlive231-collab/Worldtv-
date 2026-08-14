// ============ RESELLER SESSION STORE WITH EXPIRATION ============
const resellerSessions = new Map(); // token -> { resellerId, createdAt, expiresAt }
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of resellerSessions.entries()) {
    if (session.expiresAt < now) {
      resellerSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Every hour

// Middleware to validate reseller token
function resellerOnly(req, res, next) {
  const token = req.headers['x-reseller-token'];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  
  const session = resellerSessions.get(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  
  // Check if session expired
  if (session.expiresAt < Date.now()) {
    resellerSessions.delete(token);
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
  
  req.resellerId = session.resellerId;
  next();
}

// ============ RESELLER LOGIN ============
app.post("/api/reseller/login", async (req, res) => {
  const { email, password } = req.body || {};
  
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  
  try {
    const reseller = db.prepare("SELECT id, name, email, password_hash FROM resellers WHERE email = ? AND status = 'active'").get(email.toLowerCase());
    
    if (!reseller) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    
    const passwordMatch = await bcrypt.compare(password, reseller.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    
    // Generate token and store session with expiration
    const token = require('crypto').randomBytes(32).toString('hex');
    const now = Date.now();
    resellerSessions.set(token, { 
      resellerId: reseller.id, 
      createdAt: now,
      expiresAt: now + SESSION_DURATION_MS
    });
    
    res.json({ ok: true, token, resellerId: reseller.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RESELLER DASHBOARD ============
app.get("/api/reseller/dashboard", resellerOnly, (req, res) => {
  try {
    const reseller = db.prepare("SELECT id, name, email FROM resellers WHERE id = ?").get(req.resellerId);
    if (!reseller) return res.status(401).json({ error: "Unauthorized" });
    
    const quota = db.prepare(
      "SELECT allocated_count, used_count, available_count FROM reseller_code_allocation WHERE reseller_id = ?"
    ).get(req.resellerId) || { allocated_count: 0, used_count: 0, available_count: 0 };
    
    const codes = db.prepare(
      "SELECT code, status, created_at, used_at FROM subscription_codes WHERE reseller_id = ? ORDER BY created_at DESC LIMIT 100"
    ).all(req.resellerId);
    
    res.json({ reseller, quota, codes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RESELLER GENERATE CODES ============
app.post("/api/reseller/generate-codes", resellerOnly, (req, res) => {
  const { count } = req.body || {};
  const genCount = Number(count);
  
  if (!Number.isFinite(genCount) || genCount < 1 || genCount > 1000) {
    return res.status(400).json({ error: "Valid count required (1-1000)" });
  }
  
  try {
    const reseller = db.prepare("SELECT id FROM resellers WHERE id = ?").get(req.resellerId);
    if (!reseller) return res.status(401).json({ error: "Unauthorized" });
    
    const quota = db.prepare(
      "SELECT available_count FROM reseller_code_allocation WHERE reseller_id = ?"
    ).get(req.resellerId);
    
    if (!quota || quota.available_count < genCount) {
      const available = quota ? quota.available_count : 0;
      return res.status(400).json({ error: `Not enough codes available. You have ${available} codes available. Contact admin to allocate more.` });
    }
    
    // Generate codes
    const generated = [];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    
    // Use a transaction for atomicity
    const insertStmt = db.prepare("INSERT INTO subscription_codes(code, status, reseller_id) VALUES(?, 'active', ?)");
    const updateStmt = db.prepare("UPDATE reseller_code_allocation SET available_count = available_count - ? WHERE reseller_id = ?");
    
    const transaction = db.transaction(() => {
      for (let i = 0; i < genCount; i++) {
        let code = '';
        for (let j = 0; j < 8; j++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        insertStmt.run(code, req.resellerId);
        generated.push(code);
      }
      updateStmt.run(genCount, req.resellerId);
    });
    
    transaction();
    
    res.json({ ok: true, generated, count: genCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ RESELLER LOGOUT (OPTIONAL) ============
app.post("/api/reseller/logout", resellerOnly, (req, res) => {
  const token = req.headers['x-reseller-token'];
  if (token) {
    resellerSessions.delete(token);
  }
  res.json({ ok: true });
});

