/**
 * World TV - Enhanced Server
 * Integrates Football API, Broadcast Management, AI Image Generation
 * with existing authentication and product management
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const Database = require("better-sqlite3");
const cron = require("node-cron");

// Import new modules
const FootballAPI = require("./lib/football-api");
const AIImageGenerator = require("./lib/ai-image-generator");
const BroadcastManager = require("./lib/broadcast-manager");

const app = express();
const PORT = process.env.PORT || 8080;
const db = new Database("/app/data/worldtv.sqlite");
const adminSessions = new Map();
const customerSessions = new Map();

// ============================================================================
// MIDDLEWARE SETUP
// ============================================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
    cb(null, Date.now() + "-" + crypto.randomBytes(6).toString("hex") + (ext || ".jpg"));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// ============================================================================
// DATABASE SETUP
// ============================================================================

db.pragma("journal_mode=WAL");

// Create all existing tables (users, plans, orders, products, etc.)
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plans(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 price_ghs INTEGER NOT NULL,
 duration_days INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscription_codes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT NOT NULL UNIQUE,
 plan_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'unused',
 user_id INTEGER,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reference TEXT NOT NULL UNIQUE,
 user_id INTEGER NOT NULL,
 plan_id INTEGER NOT NULL,
 amount_pesewas INTEGER NOT NULL,
 currency TEXT NOT NULL DEFAULT 'GHS',
 status TEXT NOT NULL DEFAULT 'pending',
 code_id INTEGER,
 paid_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 price_ghs REAL,
 category TEXT NOT NULL DEFAULT 'General',
 image_url TEXT,
 stock_status TEXT NOT NULL DEFAULT 'in_stock',
 whatsapp_number TEXT,
 featured INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS promotions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 button_text TEXT,
 button_url TEXT,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// ============================================================================
// INITIALIZE SERVICES
// ============================================================================

const footballAPI = new FootballAPI(
  process.env.RAPIDAPI_KEY || "demo",
  process.env.RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com"
);

const aiImageGenerator = new AIImageGenerator({
  openaiApiKey: process.env.OPENAI_API_KEY,
  cloudinaryUrl: process.env.CLOUDINARY_URL,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
});

const broadcastManager = new BroadcastManager(db);

// Initialize Redis connection for football API
(async () => {
  try {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    await footballAPI.init(redisUrl);
    console.log("[Server] Football API initialized with Redis caching");
  } catch (err) {
    console.warn("[Server] Redis initialization warning:", err.message);
  }
})();

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

function isAdminAuthenticated(req, res, next) {
  const sessionId = req.query.admin_session || req.headers["x-admin-session"];
  if (!sessionId || !adminSessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: "Admin authentication required" });
  }
  req.adminId = adminSessions.get(sessionId);
  next();
}

function isCustomerAuthenticated(req, res, next) {
  const sessionId = req.query.session || req.headers["x-customer-session"];
  if (!sessionId || !customerSessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: "Customer authentication required" });
  }
  req.userId = customerSessions.get(sessionId);
  next();
}

// ============================================================================
// FOOTBALL & BROADCAST API ROUTES
// ============================================================================

// Live Scores
app.get("/api/live-scores", async (req, res) => {
  try {
    const league = req.query.league || 39;
    const liveScores = await footballAPI.getLiveScores(league);

    const enriched = await Promise.all(
      liveScores.map(async (match) => {
        const broadcasts = broadcastManager.getBroadcastsForMatch(match.id);
        return { ...match, broadcasts };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upcoming Fixtures
app.get("/api/fixtures/upcoming", async (req, res) => {
  try {
    const daysAhead = parseInt(req.query.days) || 7;
    const league = req.query.league || 39;
    const upcomingFixtures = await footballAPI.getUpcomingFixtures(daysAhead, league);

    const enriched = await Promise.all(
      upcomingFixtures.map(async (match) => {
        const broadcasts = broadcastManager.getBroadcastsForMatch(match.id);
        return { ...match, broadcasts };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Match Broadcasts
app.get("/api/match/:matchId/broadcasts", (req, res) => {
  try {
    const { matchId } = req.params;
    const broadcasts = broadcastManager.getBroadcastsForMatch(matchId);
    res.json({ success: true, data: broadcasts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Live Broadcasts
app.get("/api/broadcasts/live", (req, res) => {
  try {
    const liveBroadcasts = broadcastManager.getLiveBroadcasts();
    res.json({ success: true, data: liveBroadcasts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Team Stats
app.get("/api/team/:teamId/stats", async (req, res) => {
  try {
    const { teamId } = req.params;
    const stats = await footballAPI.getTeamStats(teamId);
    if (!stats) {
      return res.status(404).json({ success: false, error: "Team not found" });
    }
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// League Standings
app.get("/api/standings/:league", async (req, res) => {
  try {
    const { league } = req.params;
    const season = req.query.season || new Date().getFullYear();
    const standings = await footballAPI.getStandings(league, season);
    res.json({ success: true, data: standings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// ADMIN BROADCAST MANAGEMENT ROUTES
// ============================================================================

// Get all channels
app.get("/admin/broadcasts/channels", isAdminAuthenticated, (req, res) => {
  try {
    const activeOnly = req.query.active !== "false";
    const channels = broadcastManager.getAllChannels(activeOnly);
    res.json({ success: true, data: channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add channel
app.post("/admin/broadcasts/channels", isAdminAuthenticated, (req, res) => {
  try {
    const { name, country, logoUrl, website } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: "Channel name is required" });
    }
    const channel = broadcastManager.addChannel(name, country, logoUrl, website);
    res.status(201).json({ success: true, data: channel });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(400).json({ success: false, error: "Channel name already exists" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update channel
app.put("/admin/broadcasts/channels/:channelId", isAdminAuthenticated, (req, res) => {
  try {
    const { channelId } = req.params;
    const channel = broadcastManager.updateChannel(channelId, req.body);
    res.json({ success: true, data: channel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete channel
app.delete("/admin/broadcasts/channels/:channelId", isAdminAuthenticated, (req, res) => {
  try {
    const { channelId } = req.params;
    broadcastManager.deleteChannel(channelId);
    res.json({ success: true, message: "Channel deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Schedule broadcast
app.post("/admin/broadcasts/schedule", isAdminAuthenticated, (req, res) => {
  try {
    const { matchId, channelId, streamUrl, startTime, streamQuality, notes } = req.body;
    if (!matchId || !channelId || !streamUrl || !startTime) {
      return res.status(400).json({
        success: false,
        error: "matchId, channelId, streamUrl, and startTime are required",
      });
    }
    const broadcast = broadcastManager.scheduleMatch(
      matchId,
      channelId,
      streamUrl,
      startTime,
      streamQuality,
      notes
    );
    res.status(201).json({ success: true, data: broadcast });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// AI IMAGE GENERATION ROUTES
// ============================================================================

// Generate match banner
app.post("/api/ai/generate-match-banner", async (req, res) => {
  try {
    const { homeTeam, awayTeam, league } = req.body;
    if (!homeTeam || !awayTeam) {
      return res.status(400).json({
        success: false,
        error: "homeTeam and awayTeam are required",
      });
    }

    res.json({
      success: true,
      message: "Generating banner artwork. This may take a few seconds...",
      queued: true,
    });

    // Generate asynchronously
    (async () => {
      try {
        const result = await aiImageGenerator.generateMatchBanner(
          homeTeam,
          awayTeam,
          league || "League"
        );
        if (result) {
          console.log(`[AI] Banner generated for ${homeTeam} vs ${awayTeam}`);
        }
      } catch (err) {
        console.error("[AI] Background generation error:", err.message);
      }
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Placeholder team image
app.get("/api/ai/placeholder-team", (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ success: false, error: "Team name is required" });
    }

    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    const colors = [
      "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
      "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#A8E6CF",
    ];

    const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const color = colors[hash % colors.length];

    const svg = `
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="100" fill="${color}"/>
        <text x="100" y="120" font-size="60" font-weight="bold" text-anchor="middle" fill="white" font-family="Arial">
          ${initials}
        </text>
      </svg>
    `;

    res.set("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cache stats
app.get("/api/ai/cache-stats", (req, res) => {
  try {
    const cacheSize = aiImageGenerator.cache.size;
    res.json({
      success: true,
      data: {
        cachedBanners: cacheSize,
        maxCacheSize: aiImageGenerator.maxCacheSize,
        cacheUtilization: `${((cacheSize / aiImageGenerator.maxCacheSize) * 100).toFixed(2)}%`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// BACKGROUND JOBS (CRON)
// ============================================================================

// Poll live scores every 30 seconds
cron.schedule("*/30 * * * * *", async () => {
  try {
    console.log("[Cron] Polling live scores...");
    const liveScores = await footballAPI.getLiveScores(39);
    console.log(`[Cron] Found ${liveScores.length} live matches`);
  } catch (err) {
    console.error("[Cron] Live scores poll failed:", err.message);
  }
});

// Update upcoming fixtures every 1 hour
cron.schedule("0 * * * *", async () => {
  try {
    console.log("[Cron] Updating upcoming fixtures...");
    const fixtures = await footballAPI.getUpcomingFixtures(7, 39);
    console.log(`[Cron] Fetched ${fixtures.length} upcoming fixtures`);
  } catch (err) {
    console.error("[Cron] Fixtures update failed:", err.message);
  }
});

// Clear old cache every 6 hours
cron.schedule("0 */6 * * *", () => {
  console.log("[Cron] Clearing old image cache...");
  aiImageGenerator.clearOldCache();
  console.log(`[Cron] Cache now contains ${aiImageGenerator.cache.size} items`);
});

// ============================================================================
// HEALTH CHECK & STATUS
// ============================================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
    services: {
      football: "active",
      broadcasts: "active",
      ai: process.env.OPENAI_API_KEY ? "active" : "inactive",
    },
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          WORLD TV - ENHANCED SERVER (v2.0.0)              ║
║  Real-Time Scores | Broadcasts | AI Imagery | Redis Cache ║
╚════════════════════════════════════════════════════════════╝

🚀 Server running on port ${PORT}
📍 Environment: ${process.env.NODE_ENV || "development"}
🏟️  Football API: ${process.env.RAPIDAPI_KEY ? "✓ Configured" : "✗ Missing RAPIDAPI_KEY"}
📡 Redis: ${process.env.REDIS_URL ? "✓ Configured" : "✗ Using in-memory (dev mode)"}
🤖 OpenAI: ${process.env.OPENAI_API_KEY ? "✓ Configured" : "✗ Missing OPENAI_API_KEY"}
☁️  Cloudinary: ${process.env.CLOUDINARY_API_KEY ? "✓ Configured" : "✗ Missing CLOUDINARY_API_KEY"}

📊 API Endpoints:
   GET  /api/live-scores              - Current live matches
   GET  /api/fixtures/upcoming        - Next 7 days
   GET  /api/match/:matchId/broadcasts - Match broadcasts
   GET  /api/broadcasts/live          - Live broadcasts
   GET  /api/standings/:league        - League standings

🎨 AI Routes:
   POST /api/ai/generate-match-banner - Generate artwork
   GET  /api/ai/placeholder-team      - Team placeholder
   GET  /api/ai/cache-stats           - Cache info

⚙️  Admin Routes (require auth):
   GET    /admin/broadcasts/channels        - List channels
   POST   /admin/broadcasts/channels        - Add channel
   PUT    /admin/broadcasts/channels/:id    - Update channel
   DELETE /admin/broadcasts/channels/:id    - Delete channel
   POST   /admin/broadcasts/schedule        - Schedule broadcast

📅 Background Jobs:
   • Live scores poll (every 30s)
   • Upcoming fixtures update (hourly)
   • Image cache cleanup (every 6h)

✅ Ready to serve requests!
  `);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down gracefully...");
  await footballAPI.disconnect();
  db.close();
  process.exit(0);
});

module.exports = app;

