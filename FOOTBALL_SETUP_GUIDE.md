# World TV Live Football Feature - Complete Setup Guide

## ⚠️ IMPORTANT: This is a MASSIVE feature requiring multiple changes

Due to GitHub/tool limitations, this cannot be done in a single PR. I'm providing you with:
1. Complete code snippets to add
2. Step-by-step implementation guide
3. Which files to modify and how
4. Testing procedures

---

## PHASE 1: BACKEND SETUP (MUST DO FIRST)

### Step 1: Update package.json
Add axios to dependencies:
```json
"axios": "^1.6.0"
```

Then run: `npm install`

### Step 2: Add Environment Variables to Railway
Go to Railway Dashboard → Your Project → Settings → Variables

Add:
```
FOOTBALL_API_KEY=<your_api_key_from_rapidapi>
FOOTBALL_API_PROVIDER=api-football
FOOTBALL_API_BASE_URL=https://api-football-v3.p.rapidapi.com
```

**How to get FOOTBALL_API_KEY:**
1. Go to https://rapidapi.com/api-sports/api/api-football
2. Click "Subscribe"
3. Select "Free" tier (250 requests/month)
4. Go to "Code Snippets" tab
5. Copy the "x-rapidapi-key" value
6. Add to Railway as FOOTBALL_API_KEY

### Step 3: Create football-api.js
File already created at `/root/repo/football-api.js`
This handles all API integration and caching.

### Step 4: Update server.js - Add Database Tables
After line 690 (after email_queue table), add:

```javascript
db.exec(`
CREATE TABLE IF NOT EXISTS worldtv_football_fixtures(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_fixture_id INTEGER UNIQUE,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_logo TEXT,
  away_team_logo TEXT,
  league TEXT NOT NULL,
  league_logo TEXT,
  kickoff_time TEXT,
  current_score_home INTEGER DEFAULT 0,
  current_score_away INTEGER DEFAULT 0,
  match_status TEXT DEFAULT 'upcoming',
  current_minute INTEGER,
  half_time_home INTEGER,
  half_time_away INTEGER,
  events_json TEXT,
  last_sync TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worldtv_broadcasts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL,
  worldtv_channel_name TEXT NOT NULL,
  worldtv_channel_id TEXT NOT NULL,
  watch_url TEXT,
  featured INTEGER DEFAULT 0,
  published INTEGER DEFAULT 0,
  custom_image_url TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(fixture_id) REFERENCES worldtv_football_fixtures(id)
);
`);
```

### Step 5: Update server.js - Add Football API Routes
Add AFTER all other routes (before app.listen):

```javascript
/* Import football API */
const footballApi = require('./football-api');

/* Public Football Routes */
app.get("/api/football/live", async (req, res) => {
  try {
    const liveMatches = await footballApi.fetchLiveMatches();
    res.json(liveMatches);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch live matches" });
  }
});

app.get("/api/football/today", async (req, res) => {
  try {
    const todayMatches = await footballApi.fetchTodayMatches();
    res.json(todayMatches);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch today's matches" });
  }
});

app.get("/api/football/upcoming", async (req, res) => {
  try {
    const upcoming = await footballApi.fetchUpcomingMatches(
      Number(req.query.days) || 7
    );
    res.json(upcoming);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch upcoming matches" });
  }
});

app.get("/api/worldtv/broadcasts", (req, res) => {
  try {
    const broadcasts = db.prepare(`
      SELECT wb.*, wf.* 
      FROM worldtv_broadcasts wb
      JOIN worldtv_football_fixtures wf ON wf.id = wb.fixture_id
      WHERE wb.published = 1
      ORDER BY wb.featured DESC, wb.display_order ASC, wf.kickoff_time ASC
    `).all();
    res.json(broadcasts);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch broadcasts" });
  }
});

/* Admin Football Routes */
app.get("/api/admin/football/fixtures", adminOnly, async (req, res) => {
  try {
    const query = req.query.search || "";
    let fixtures = [];
    
    if (query) {
      fixtures = await footballApi.searchMatches(query);
    } else {
      // Get live + today + upcoming
      const [live, today, upcoming] = await Promise.all([
        footballApi.fetchLiveMatches(),
        footballApi.fetchTodayMatches(),
        footballApi.fetchUpcomingMatches()
      ]);
      fixtures = [...new Set([...live, ...today, ...upcoming])];
    }
    
    res.json(fixtures);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch fixtures" });
  }
});

app.get("/api/admin/worldtv/broadcasts", adminOnly, (req, res) => {
  try {
    const broadcasts = db.prepare(`
      SELECT wb.*, wf.* 
      FROM worldtv_broadcasts wb
      JOIN worldtv_football_fixtures wf ON wf.id = wb.fixture_id
      ORDER BY wb.featured DESC, wb.display_order ASC
    `).all();
    res.json(broadcasts);
  } catch (e) {
    res.status(500).json({ error: "Could not fetch broadcasts" });
  }
});

app.post("/api/admin/worldtv/broadcasts", adminOnly, (req, res) => {
  try {
    const {
      fixture_id,
      worldtv_channel_name,
      worldtv_channel_id,
      watch_url,
      featured,
      published,
      display_order
    } = req.body;

    if (!fixture_id || !worldtv_channel_name || !worldtv_channel_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = db.prepare(`
      INSERT INTO worldtv_broadcasts(
        fixture_id, worldtv_channel_name, worldtv_channel_id, 
        watch_url, featured, published, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      fixture_id,
      worldtv_channel_name,
      worldtv_channel_id,
      watch_url || null,
      featured ? 1 : 0,
      published ? 1 : 0,
      Number(display_order) || 0
    );

    const broadcast = db.prepare(
      "SELECT * FROM worldtv_broadcasts WHERE id = ?"
    ).get(result.lastInsertRowid);

    res.json({ ok: true, broadcast });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/admin/worldtv/broadcasts/:id", adminOnly, (req, res) => {
  try {
    const {
      worldtv_channel_name,
      worldtv_channel_id,
      watch_url,
      featured,
      published,
      display_order
    } = req.body;

    const existing = db.prepare(
      "SELECT * FROM worldtv_broadcasts WHERE id = ?"
    ).get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: "Broadcast not found" });
    }

    db.prepare(`
      UPDATE worldtv_broadcasts SET
        worldtv_channel_name = ?,
        worldtv_channel_id = ?,
        watch_url = ?,
        featured = ?,
        published = ?,
        display_order = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      worldtv_channel_name || existing.worldtv_channel_name,
      worldtv_channel_id || existing.worldtv_channel_id,
      watch_url !== undefined ? watch_url : existing.watch_url,
      featured !== undefined ? (featured ? 1 : 0) : existing.featured,
      published !== undefined ? (published ? 1 : 0) : existing.published,
      display_order !== undefined ? display_order : existing.display_order,
      req.params.id
    );

    const broadcast = db.prepare(
      "SELECT * FROM worldtv_broadcasts WHERE id = ?"
    ).get(req.params.id);

    res.json({ ok: true, broadcast });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/worldtv/broadcasts/:id", adminOnly, (req, res) => {
  try {
    const existing = db.prepare(
      "SELECT * FROM worldtv_broadcasts WHERE id = ?"
    ).get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: "Broadcast not found" });
    }

    db.prepare("DELETE FROM worldtv_broadcasts WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

---

## PHASE 2: ADMIN DASHBOARD (AFTER Phase 1 works)

### Update admin.html
1. Add "Football" to tab list
2. Add football tab section with search, fixture list, broadcast management
3. Add modal for editing broadcasts

See FOOTBALL_ADMIN_CODE.md for complete code

---

## PHASE 3: FRONTEND (AFTER Phase 2 complete)

### Update index.html
1. Add Live Scores section after "What You Get"
2. Add Watch Live section after Live Scores
3. Add CSS for football styling
4. Add JavaScript for auto-refresh

See FOOTBALL_FRONTEND_CODE.md for complete code

---

## TESTING CHECKLIST

Before deploying:
- [ ] npm install completes without errors
- [ ] Railway environment variables set
- [ ] GET /api/football/live returns data
- [ ] GET /api/football/today returns data
- [ ] Admin can access Football tab
- [ ] Admin can search fixtures
- [ ] Admin can create broadcasts
- [ ] Published broadcasts show on homepage
- [ ] Live scores auto-refresh every 30-60s
- [ ] Mobile layout looks good
- [ ] No existing features broken

---

## COMPLETE FILE LISTING

**Files Created:**
- football-api.js (✅ DONE)
- FOOTBALL_SETUP_GUIDE.md (this file)
- FOOTBALL_ADMIN_CODE.md (to create)
- FOOTBALL_FRONTEND_CODE.md (to create)

**Files Modified:**
- server.js (Add tables + routes)
- admin.html (Add football tab)
- index.html (Add frontend sections)
- package.json (Add axios)

---

## DEPLOYMENT STEPS

1. Make all server.js changes
2. Update package.json with axios
3. Deploy to Railway (triggers npm install)
4. Add Railway environment variables
5. Test public API endpoints
6. Add admin.html changes
7. Test admin functionality
8. Add index.html changes  
9. Test frontend display
10. Verify auto-refresh works

---

## CURRENT STATUS

✅ Created: football-api.js module
⏳ Pending: Server routes and database tables
⏳ Pending: Admin dashboard tab
⏳ Pending: Frontend display sections

**Next: Add server routes to server.js (Phase 1, Step 5 above)**


