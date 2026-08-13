# World TV - Full Integration Guide

## Overview
This enhanced World TV application includes:
- **Real-time Live Scores** from RapidAPI Football data
- **7-Day Upcoming Fixtures** with multiple view options
- **TV Channel Management** with broadcast scheduling
- **AI-Generated Match Artwork** using DALL-E 3
- **Redis Caching** for optimal performance
- **Background Cron Jobs** for automatic data polling
- **Production-Ready Deployment** configuration

## File Structure

```
worldtv-app/
├── lib/
│   ├── football-api.js              # RapidAPI integration
│   ├── ai-image-generator.js        # DALL-E 3 & Cloudinary
│   └── broadcast-manager.js         # TV channels & schedules
├── routes/
│   ├── api-live-scores.js          # Public API routes
│   ├── admin-broadcasts.js         # Admin management routes
│   └── api-ai-images.js            # AI image routes
├── components/
│   ├── live-scores.html            # Live scores UI component
│   └── fixtures-broadcasts.html    # Fixtures & broadcasts UI
├── server-enhanced.js              # Main application server
├── package.json                    # Dependencies
├── .env.example                    # Environment template
├── Dockerfile.production           # Production Docker image
├── railway.json                    # Railway deployment config
└── INTEGRATION_GUIDE.md            # This file
```

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

This installs:
- `express` - Web framework
- `better-sqlite3` - Local database
- `redis` - Caching layer
- `node-cron` - Background jobs
- `axios` - HTTP requests
- `cloudinary` - Image storage
- `dotenv` - Environment variables

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

**Required Variables:**
- `RAPIDAPI_KEY` - Get from https://rapidapi.com/api-sports/api/api-football
- `RAPIDAPI_HOST` - Set to `api-football-v1.p.rapidapi.com`
- `REDIS_URL` - Redis connection string (Railway provides this automatically)
- `OPENAI_API_KEY` - Get from https://platform.openai.com/api-keys
- `CLOUDINARY_API_KEY` - Get from https://cloudinary.com/console
- `CLOUDINARY_API_SECRET` - Cloudinary secret key
- `PORT` - Server port (default: 8080)

### 3. Start the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The server will start on `http://localhost:8080` and display:
```
╔════════════════════════════════════════════════════════════╗
║          WORLD TV - ENHANCED SERVER (v2.0.0)              ║
║  Real-Time Scores | Broadcasts | AI Imagery | Redis Cache ║
╚════════════════════════════════════════════════════════════╝
```

## API Endpoints

### Public Endpoints (No Authentication)

#### Live Scores
```bash
GET /api/live-scores?league=39
```
Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "homeTeam": { "name": "Manchester United", "score": 2, "logo": "url" },
      "awayTeam": { "name": "Arsenal", "score": 1, "logo": "url" },
      "status": "LIVE",
      "elapsed": 45,
      "broadcasts": [
        {
          "channel_name": "Sky Sports",
          "channel_logo": "url",
          "stream_url": "url",
          "stream_quality": "HD"
        }
      ]
    }
  ]
}
```

#### Upcoming Fixtures
```bash
GET /api/fixtures/upcoming?days=7&league=39
```

#### Match Broadcasts
```bash
GET /api/match/:matchId/broadcasts
```

#### Live Broadcasts
```bash
GET /api/broadcasts/live
```

#### Team Stats
```bash
GET /api/team/:teamId/stats
```

#### League Standings
```bash
GET /api/standings/:league?season=2024
```

### Admin Endpoints (Require Authentication)

#### List TV Channels
```bash
GET /admin/broadcasts/channels?admin_session=<SESSION_ID>
```

#### Add TV Channel
```bash
POST /admin/broadcasts/channels?admin_session=<SESSION_ID>
Content-Type: application/json

{
  "name": "Sky Sports",
  "country": "UK",
  "logoUrl": "https://...",
  "website": "https://skysports.com"
}
```

#### Schedule Broadcast
```bash
POST /admin/broadcasts/schedule?admin_session=<SESSION_ID>
Content-Type: application/json

{
  "matchId": 123,
  "channelId": 45,
  "streamUrl": "https://stream.example.com/match",
  "startTime": "2024-08-17T15:00:00Z",
  "streamQuality": "HD",
  "notes": "Live commentary in English"
}
```

#### Update Channel
```bash
PUT /admin/broadcasts/channels/:channelId?admin_session=<SESSION_ID>
Content-Type: application/json

{
  "is_active": 1,
  "logoUrl": "https://..."
}
```

#### Delete Channel
```bash
DELETE /admin/broadcasts/channels/:channelId?admin_session=<SESSION_ID>
```

### AI Image Generation

#### Generate Match Banner
```bash
POST /api/ai/generate-match-banner
Content-Type: application/json

{
  "homeTeam": "Manchester United",
  "awayTeam": "Arsenal",
  "league": "Premier League"
}
```

#### Get Placeholder Team Image
```bash
GET /api/ai/placeholder-team?name=Manchester United
```
Returns SVG placeholder image

#### Cache Statistics
```bash
GET /api/ai/cache-stats
```

## Integration into HTML

### 1. Add to index.html

Include the components after your main content:

```html
<!-- Live Scores Section -->
<div class="content-section">
  <script src="components/live-scores.html"></script>
</div>

<!-- Upcoming Fixtures Section -->
<div class="content-section">
  <script src="components/fixtures-broadcasts.html"></script>
</div>
```

Or embed directly:

```html
<!-- Include live scores component -->
<div id="live-scores-wrapper"></div>

<script>
  fetch('components/live-scores.html')
    .then(r => r.text())
    .then(html => {
      document.getElementById('live-scores-wrapper').innerHTML = html;
    });
</script>
```

### 2. Update server-enhanced.js

Replace `server.js` with `server-enhanced.js`:

```bash
mv server.js server-original.js
mv server-enhanced.js server.js
```

Or update existing server.js to include:

```javascript
const FootballAPI = require("./lib/football-api");
const AIImageGenerator = require("./lib/ai-image-generator");
const BroadcastManager = require("./lib/broadcast-manager");

// Initialize services
const footballAPI = new FootballAPI(
  process.env.RAPIDAPI_KEY,
  process.env.RAPIDAPI_HOST
);

const broadcastManager = new BroadcastManager(db);
```

## Background Jobs

The server runs three automatic background jobs:

### 1. Live Scores Poll (Every 30 seconds)
```javascript
cron.schedule("*/30 * * * * *", async () => {
  // Fetches current live matches and updates cache
});
```

### 2. Upcoming Fixtures Update (Hourly)
```javascript
cron.schedule("0 * * * *", async () => {
  // Refreshes 7-day upcoming fixtures
});
```

### 3. Image Cache Cleanup (Every 6 hours)
```javascript
cron.schedule("0 */6 * * *", () => {
  // Removes old cached match banners
});
```

## Redis Caching Strategy

| Data Type | Cache Duration | Refresh |
|-----------|-----------------|---------|
| Live Scores | 30 seconds | Auto-poll every 30s |
| Upcoming Fixtures | 1 hour | Auto-poll every hour |
| Team Stats | 24 hours | Manual or on-demand |
| League Standings | 24 hours | Manual or on-demand |
| AI Match Banners | In-memory | Auto-cleanup every 6h |

## Deployment to Railway

### 1. Connect Railway
```bash
railway init
railway link
```

### 2. Add Environment Variables
```bash
railway variable set RAPIDAPI_KEY=your_key
railway variable set RAPIDAPI_HOST=api-football-v1.p.rapidapi.com
railway variable set OPENAI_API_KEY=your_key
railway variable set CLOUDINARY_API_KEY=your_key
railway variable set CLOUDINARY_API_SECRET=your_secret
railway variable set REDIS_URL=your_redis_url
```

### 3. Add Redis Plugin
In Railway dashboard:
1. New → Add Redis
2. Connect to project
3. Railway auto-populates REDIS_URL

### 4. Deploy
```bash
git push origin main
```

Railway will:
1. Build Docker image using `Dockerfile.production`
2. Read deploy config from `railway.json`
3. Start healthcheck on `/health`
4. Automatically restart on failure

## Database Schema

### tv_channels
```sql
CREATE TABLE tv_channels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  country TEXT,
  logo_url TEXT,
  website TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
```

### broadcast_schedules
```sql
CREATE TABLE broadcast_schedules (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  stream_url TEXT NOT NULL,
  stream_quality TEXT DEFAULT 'HD',
  start_time TEXT NOT NULL,
  end_time TEXT,
  notes TEXT,
  is_live INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
```

### streaming_links
```sql
CREATE TABLE streaming_links (
  id INTEGER PRIMARY KEY,
  broadcast_schedule_id INTEGER NOT NULL,
  provider_name TEXT NOT NULL,
  url TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  region TEXT,
  created_at TEXT
);
```

## Performance Optimization

### 1. Caching
- Redis handles all frequently-accessed data
- In-memory cache for AI match banners (500MB max)
- Automatic cache invalidation

### 2. Database
- SQLite with WAL mode for concurrent writes
- Indexed queries on match_id, channel_id, is_live
- Prepared statements prevent SQL injection

### 3. API Rate Limiting
- RapidAPI requests cached to minimize quota usage
- 30-second cache for live data
- Batch requests where possible

### 4. Image Optimization
- DALL-E 3 generation runs asynchronously
- Cloudinary CDN serves images globally
- SVG placeholders as instant fallback

## Troubleshooting

### Redis Connection Issues
```
[FootballAPI] Redis init failed, running without cache
```
Solution: Check REDIS_URL environment variable and Redis availability

### Missing API Keys
```
Football API: ✗ Missing RAPIDAPI_KEY
```
Solution: Set required environment variables in .env

### Slow AI Image Generation
- DALL-E 3 takes 10-30 seconds
- Images generate asynchronously (user won't wait)
- Check Cloudinary quota if uploads fail

### Database Lock
```
Error: SQLITE_BUSY
```
Solution: SQLite WAL mode prevents this, but restart if needed

## Support

For issues:
1. Check `/health` endpoint for service status
2. Review server logs for errors
3. Verify all API keys are configured
4. Check Redis connection: `redis-cli ping`
5. Ensure database directory `/app/data` is writable

## Version History

- **v2.0.0** - Full integration: Football API, Broadcasts, AI Images, Redis caching
- **v1.4.0** - Original World TV subscription management

