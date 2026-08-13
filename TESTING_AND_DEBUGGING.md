# 🧪 Testing & Debugging Guide - World TV v2.0.0

## Pre-Deployment Testing (Local)

### Test 1: Install Dependencies
```bash
npm install
```

**Expected Output:**
```
added 45 packages in 2s
```

**If Error:**
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again

---

### Test 2: Start Server
```bash
npm run dev
```

**Expected Output:**
```
╔════════════════════════════════════════════════════════════╗
║          WORLD TV - ENHANCED SERVER (v2.0.0)              ║
║  Real-Time Scores | Broadcasts | AI Imagery | Redis Cache ║
╚════════════════════════════════════════════════════════════╝

🚀 Server running on port 8080
```

**If Error - "EADDRINUSE":**
- Port 8080 already in use
- Kill process: `lsof -ti:8080 | xargs kill -9`
- Or use different port: `PORT=3000 npm run dev`

**If Error - "Cannot find module":**
- Run `npm install` again
- Check `package.json` has all dependencies

---

### Test 3: Test Health Endpoint
```bash
curl http://localhost:8080/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-08-17T12:34:56.789Z",
  "version": "2.0.0",
  "services": {
    "football": "active",
    "broadcasts": "active",
    "ai": "active"
  }
}
```

**If you get error:**
- Check server is running (see Test 2)
- Check no firewall blocking port 8080

---

## Post-Deployment Testing (Railway)

### Test 1: Monitor Deployment Progress

1. Go to https://railway.com/project/5e549c2d-bd28-472b-8d1b-8b2f61b634e1
2. Click **"Worldtv-"** service
3. Click **"Deployments"** tab
4. Watch the latest deployment

**Status Stages:**
- 🟡 Building - Docker image being created (2-3 min)
- 🟡 Deploying - Starting container (1-2 min)
- 🟢 Success - Green checkmark, deployment complete

**If Stuck on "Building":**
- Wait 5+ minutes (Docker build is slow)
- Check logs: click deployment → "Logs" tab
- Look for error messages (usually npm install issues)

**If Shows "Failure":**
- Click the failed deployment
- Scroll to "Build Logs" and look for red error text
- Common issues:
  - Missing environment variables
  - Invalid Node version
  - Syntax error in code

---

### Test 2: Health Check (Production)

```bash
curl https://www.myworldtvlive.com/health
```

**If 404 error:**
- Deployment not complete yet, wait 2 minutes
- Check service is "Active" in Railway

**If timeout:**
- Service might be crashing
- Check logs in Railway dashboard
- Verify environment variables are set

**Expected 200 Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-08-17T...",
  "version": "2.0.0",
  "services": {
    "football": "active",
    "broadcasts": "active",
    "ai": "active"
  }
}
```

---

### Test 3: Live Scores API

```bash
curl https://www.myworldtvlive.com/api/live-scores
```

**Possible Responses:**

✅ **Success (no live matches):**
```json
{
  "success": true,
  "data": []
}
```

✅ **Success (with live matches):**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "date": "2024-08-17T14:00:00Z",
      "homeTeam": {
        "id": 45,
        "name": "Manchester United",
        "logo": "https://...",
        "score": 2
      },
      "awayTeam": {
        "id": 67,
        "name": "Arsenal",
        "logo": "https://...",
        "score": 1
      },
      "status": "LIVE",
      "elapsed": 45,
      "broadcasts": []
    }
  ]
}
```

❌ **Error - Missing RapidAPI Key:**
```json
{
  "success": false,
  "error": "RapidAPI key not configured"
}
```

**Solution:** Add `RAPIDAPI_KEY` variable in Railway

---

### Test 4: Fixtures API

```bash
curl https://www.myworldtvlive.com/api/fixtures/upcoming?days=7
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 456,
      "date": "2024-08-18T15:00:00Z",
      "venue": "Old Trafford",
      "homeTeam": {
        "id": 45,
        "name": "Manchester United",
        "logo": "https://..."
      },
      "awayTeam": {
        "id": 67,
        "name": "Liverpool",
        "logo": "https://..."
      },
      "league": {
        "id": 39,
        "name": "Premier League",
        "logo": "https://..."
      },
      "broadcasts": []
    }
  ]
}
```

**If Empty Data:**
- It's okay! This means no upcoming fixtures scheduled yet in the API
- Real data appears during football season

---

### Test 5: AI Placeholder Image

```bash
curl https://www.myworldtvlive.com/api/ai/placeholder-team?name=Manchester
```

**Expected Response:**
- SVG XML (starts with `<svg width="200" height="200"...`)
- This is an image in SVG format

**View in Browser:**
- Open in browser: https://www.myworldtvlive.com/api/ai/placeholder-team?name=Arsenal
- Should show colorful team badge with initials

**If Error:**
- Team name query parameter missing
- Try: `?name=Arsenal`

---

### Test 6: Database Check

Connect to Railway console and check database:

```bash
# In Railway terminal
sqlite3 /app/data/worldtv.sqlite

# Inside SQLite shell
.tables

# Should show:
# tv_channels  broadcast_schedules  streaming_links
```

**Check TV Channels Table:**
```sql
SELECT * FROM tv_channels;
```

**If Empty:**
- No channels created yet (normal for new setup)
- Add one via admin API (see below)

---

## Admin API Testing

### Get Admin Session

First, you need an admin session ID. Check your existing code for how admin login works, or look for active session in the system.

Assuming you have `admin_session` ID:

### Test: Add TV Channel

```bash
curl -X POST https://www.myworldtvlive.com/admin/broadcasts/channels \
  -H "Content-Type: application/json" \
  -H "x-admin-session: YOUR_ADMIN_SESSION_ID_HERE" \
  -d '{
    "name": "Sky Sports",
    "country": "United Kingdom",
    "logoUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Sky_Sports_logo.svg/1280px-Sky_Sports_logo.svg.png",
    "website": "https://www.skysports.com"
  }'
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Sky Sports",
    "country": "United Kingdom",
    "logoUrl": "https://...",
    "website": "https://www.skysports.com",
    "is_active": 1,
    "created_at": "2024-08-17T12:34:56Z"
  }
}
```

**Error - Unauthorized:**
```json
{
  "success": false,
  "error": "Admin authentication required"
}
```

**Solution:** Check admin session ID is correct

---

### Test: List TV Channels

```bash
curl https://www.myworldtvlive.com/admin/broadcasts/channels \
  -H "x-admin-session: YOUR_ADMIN_SESSION_ID_HERE"
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Sky Sports",
      "country": "United Kingdom",
      "is_active": 1,
      ...
    }
  ]
}
```

---

## Monitoring & Debugging in Production

### Check Logs

Go to Railway dashboard:
1. Worldtv- service
2. "Logs" tab
3. Scroll down to see all output

**What to Look For:**

✅ **Good Signs:**
```
[Server] Football API initialized with Redis caching
[Cron] Polling live scores...
[Cron] Found 2 live matches
[Cron] Updating upcoming fixtures...
```

❌ **Bad Signs:**
```
Error: Cannot find module 'redis'
Error: RAPIDAPI_KEY is required
Error: Failed to connect to Redis
ENOENT: no such file or directory, open '/app/data'
```

---

### Check Resource Usage

Railway Dashboard:
1. Worldtv- service
2. "Metrics" tab
3. Monitor:
   - CPU usage (should be < 30%)
   - Memory usage (should be < 200MB)
   - Network throughput
   - Request count

**If Memory > 300MB:**
- AI image cache might be full
- Try: `curl https://www.myworldtvlive.com/api/ai/clear-cache` (admin only)

**If CPU spiking:**
- Check if cron jobs running
- Verify RapidAPI responses are fast

---

### Check Background Jobs

Look at logs for cron job execution:

```
[Cron] Polling live scores...          # Every 30 seconds
[Cron] Found 0 live matches
[Cron] Updating upcoming fixtures...   # Every hour
[Cron] Fetched 12 upcoming fixtures
[Cron] Clearing old image cache...    # Every 6 hours
```

**If Cron Jobs Not Running:**
- Check if service restarted recently
- Cron jobs restart automatically when server starts
- Check logs for any "Error" messages

---

## Common Error Messages & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot find module 'redis'` | npm install incomplete | Run `npm install` again, restart |
| `Error: RAPIDAPI_KEY is required` | Environment variable missing | Add RAPIDAPI_KEY in Railway Variables |
| `Error: getaddrinfo ENOTFOUND api-football-v1.p.rapidapi.com` | Network/DNS issue | Check firewall, verify RAPIDAPI_HOST is set |
| `Error: SQLITE_BUSY` | Database locked | Restart service (Railway handles auto-recovery) |
| `Error: DALL-E 429 Too Many Requests` | OpenAI rate limit | Wait 1 minute, try again |
| `Error: Cloudinary signature invalid` | Wrong API secret | Verify CLOUDINARY_API_SECRET in Variables |
| `502 Bad Gateway` | Service crashed | Check logs, restart service |
| `504 Gateway Timeout` | Server slow to respond | Check metrics, might need to upgrade plan |

---

## Performance Benchmarks

**Expected Response Times:**
- `/health` - < 10ms
- `/api/live-scores` (cached) - < 50ms (first call 1-2s)
- `/api/fixtures/upcoming` (cached) - < 100ms
- `/api/ai/placeholder-team` - < 30ms (SVG generation)
- Admin API calls - < 200ms

**Memory Usage:**
- Base server - ~80MB
- With fixtures loaded - ~100MB
- With AI cache - up to 150MB
- Critical limit - 512MB (Railway warns at this point)

**Database Size:**
- Initial - ~2MB
- With 1000 broadcasts - ~5MB
- With 10000 broadcasts - ~20MB

---

## Testing Checklist

- [ ] `npm install` succeeds
- [ ] Local server starts (`npm run dev`)
- [ ] `/health` returns 200 OK locally
- [ ] PR #21 merged to GitHub
- [ ] Deployment completes in Railway (green check)
- [ ] `/health` returns 200 OK in production
- [ ] `/api/live-scores` returns valid JSON
- [ ] `/api/fixtures/upcoming` returns valid JSON
- [ ] `/api/ai/placeholder-team` returns SVG
- [ ] Can add TV channel via admin API
- [ ] Database tables exist (`sqlite3` check)
- [ ] No errors in Railway logs
- [ ] CPU usage normal (< 30%)
- [ ] Memory usage normal (< 200MB)
- [ ] Cron jobs logging execution

---

## Still Stuck?

1. **Check the logs** - Railway Logs tab shows everything
2. **Verify variables** - Are all 8 environment variables set?
3. **Test locally first** - Does it work with `npm run dev`?
4. **Check API keys** - Are they actually working?
5. **Read the guides** - INTEGRATION_GUIDE.md has full API docs

**Get Help:**
- Check INTEGRATION_GUIDE.md
- Review DEPLOYMENT_CHECKLIST.md
- Read server output messages carefully
- Google the specific error message

You've got this! 🚀

