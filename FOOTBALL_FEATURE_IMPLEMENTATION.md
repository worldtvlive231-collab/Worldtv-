# Live Football Feature - Complete Implementation Guide

## PHASE 1: Backend Infrastructure

### 1. Install Dependency
```bash
npm install axios
```

### 2. Environment Variables (Add to Railway)
```
FOOTBALL_API_KEY=your_api_key_from_rapidapi
FOOTBALL_API_PROVIDER=api-football
FOOTBALL_API_BASE_URL=https://api-football-v3.p.rapidapi.com
```

**Get API Key:**
1. Go to https://rapidapi.com/api-sports/api/api-football
2. Sign up for free account
3. Subscribe to free tier (250 requests/month)
4. Copy API key from dashboard
5. Add to Railway environment variables

### 3. Database Tables (Add to server.js in db.exec())
```sql
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
```

### 4. Create football-api.js Module
File: `/root/repo/football-api.js`

This module handles all football API integration with caching.

### 5. Backend Routes (Add to server.js)

**Public Routes:**
- GET /api/football/live
- GET /api/football/today
- GET /api/football/upcoming
- GET /api/worldtv/broadcasts

**Admin Routes:**
- GET /api/admin/football/fixtures
- POST /api/admin/worldtv/broadcasts
- PUT /api/admin/worldtv/broadcasts/:id
- DELETE /api/admin/worldtv/broadcasts/:id
- GET /api/admin/worldtv/broadcasts

## PHASE 2: Admin Dashboard

### Add "Football / Live Matches" Tab to admin.html
- Search football fixtures from API
- Display available matches
- Assign World TV channels
- Edit/delete broadcasts
- Show current broadcasts

## PHASE 3: Frontend Display

### Add Live Scores Section (index.html after "What You Get")
- Tabs: Live | Today | Upcoming | Finished
- Match cards with team logos, scores
- Auto-refresh every 30-60 seconds
- Responsive mobile design

### Add Watch Live Section (index.html)
- Display assigned broadcasts
- Team logos, competition, kickoff time
- "WATCH LIVE" button
- Featured matches prominently

## IMPLEMENTATION CHECKLIST

### Backend:
- [ ] Add axios to package.json
- [ ] Add environment variables to Railway
- [ ] Create worldtv_football_fixtures table
- [ ] Create worldtv_broadcasts table
- [ ] Create football-api.js module
- [ ] Add public football API routes
- [ ] Add admin football routes
- [ ] Implement caching strategy
- [ ] Test API integration

### Admin:
- [ ] Add "Football" tab to admin.html
- [ ] Add fixture search/display
- [ ] Add broadcast edit modal
- [ ] Add create/update/delete functions
- [ ] Test admin functionality

### Frontend:
- [ ] Add Live Scores section
- [ ] Add tabs (Live/Today/Upcoming/Finished)
- [ ] Add Watch Live section
- [ ] Add auto-refresh logic
- [ ] Add responsive CSS
- [ ] Test mobile layout

### Testing:
- [ ] API returns data correctly
- [ ] Caching works as expected
- [ ] Admin can assign matches
- [ ] Matches display on homepage
- [ ] Live scores auto-refresh
- [ ] Mobile responsive
- [ ] Error handling works
- [ ] No existing features broken

## FOOTBALL API RESPONSE MAPPING

API-Football provides:
```json
{
  "fixture": {
    "id": 12345,
    "date": "2024-08-12T19:00:00+00:00",
    "status": "live"
  },
  "league": {
    "name": "Premier League",
    "logo": "https://..."
  },
  "teams": {
    "home": {
      "name": "Arsenal",
      "logo": "https://..."
    },
    "away": {
      "name": "Chelsea",
      "logo": "https://..."
    }
  },
  "goals": {
    "home": 2,
    "away": 1
  },
  "score": {
    "halftime": {"home": 1, "away": 0},
    "fulltime": {"home": 2, "away": 1}
  }
}
```

Map to worldtv_football_fixtures table.

## CACHING STRATEGY

- Live matches: 30 second cache
- Today's matches: 5 minute cache
- Upcoming fixtures: 15 minute cache
- Use in-memory cache with timestamp
- Check expiry before API call
- Return cached data if fresh

## ERROR HANDLING

- API unavailable: return empty array, don't crash
- Missing fields: use defaults/empty strings
- Network timeout: use cached data or empty array
- Show user-friendly error messages

## NEXT STEPS

1. Create PR #11: Add football-api.js module + database tables
2. Create PR #12: Add backend API routes
3. Create PR #13: Add admin dashboard tab
4. Create PR #14: Add frontend Live Scores section
5. Create PR #15: Add frontend Watch Live section
6. Test end-to-end
7. Deploy to Railway
8. Add environment variables to Railway
9. Monitor first deployment


