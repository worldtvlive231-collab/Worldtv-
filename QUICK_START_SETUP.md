# 🚀 World TV v2.0.0 - Complete Setup Guide (Step-by-Step)

## Phase 1: Get API Keys (15-20 minutes)

### 1️⃣ RapidAPI Football Key

**Sign Up / Login:**
1. Go to https://rapidapi.com
2. Sign up or login with Google/GitHub
3. Click your avatar → "Dashboard"

**Get API Key:**
1. Go to https://rapidapi.com/api-sports/api/api-football
2. Click blue **"Subscribe to Test"** button
3. Select **"Free"** plan (300 requests/day)
4. Click **"Subscribe"**
5. You'll see a success message

**Copy Your Key:**
1. On the API page, look for **"API Key"** section on the right
2. Click the key under "x-rapidapi-key"
3. Copy it (looks like: `1a2b3c4d5e6f7g8h9i0j`)
4. Save it somewhere safe ✅

**Important Note:**
- Host: `api-football-v1.p.rapidapi.com` (always the same)

---

### 2️⃣ OpenAI API Key (DALL-E 3)

**Sign Up / Login:**
1. Go to https://platform.openai.com
2. Sign up or login
3. Click your account icon (bottom-left) → "Settings"

**Create API Key:**
1. Go to https://platform.openai.com/api-keys
2. Click **"Create new secret key"** button
3. Name it: "World TV" (optional)
4. Click **"Create secret key"**

**⚠️ COPY IMMEDIATELY** (You can't see it again!)
1. Copy the key (looks like: `sk-proj-abc123def456...`)
2. Save it right now in a text file
3. Click "Done"

**Check Your Account:**
- Go to https://platform.openai.com/account/billing/overview
- Make sure you have credits or a payment method added
- (Free trial has limited credits, paid plans start at $5/month)

---

### 3️⃣ Cloudinary Keys (Image Storage)

**Sign Up:**
1. Go to https://cloudinary.com
2. Click **"Sign Up"** (choose Free plan)
3. Create account with email/Google
4. Verify email

**Get Your Keys:**
1. Go to https://cloudinary.com/console/dashboard
2. Look at the top section titled **"Account Details"**
3. You'll see:
   - **Cloud Name** (looks like: `dxyz12345`)
   - **API Key** (looks like: `123456789012345`)
   - **API Secret** (looks like: `a1b2c3d4e5f6g7h8i9j0k1l2`)

**Save All Three:**
```
Cloud Name: dxyz12345
API Key: 123456789012345
API Secret: a1b2c3d4e5f6g7h8i9j0k1l2
```

---

## Phase 2: GitHub - Merge PR #21 (5 minutes)

**Go to Your PR:**
1. Open https://github.com/worldtvlive231-collab/Worldtv-/pull/21
2. Scroll down to the green button
3. Click **"Merge pull request"**
4. Click **"Confirm merge"**

**What Happens:**
- GitHub merges the code to `main` branch
- Railway **automatically detects** the change
- Railway **starts building** your new Docker image
- Takes about 3-5 minutes

---

## Phase 3: Railway Configuration (10 minutes)

### Step 1: Add Redis Plugin

1. Go to https://railway.com/project/5e549c2d-bd28-472b-8d1b-8b2f61b634e1
2. Click **"New"** button (top right)
3. Search for **"Redis"**
4. Click the Redis option
5. Click **"Create"**

**What Railway Does Automatically:**
- Creates Redis instance
- Sets `REDIS_URL` environment variable on your service
- Connects it to your project

---

### Step 2: Add Environment Variables

1. Go to https://railway.com/project/5e549c2d-bd28-472b-8d1b-8b2f61b634e1
2. Click the **"Worldtv-"** service
3. Click **"Variables"** tab
4. Click **"Add Variable"** button

**Add Each One:**

```
Name: RAPIDAPI_KEY
Value: [paste your key from RapidAPI]
Click "Add"

Name: RAPIDAPI_HOST
Value: api-football-v1.p.rapidapi.com
Click "Add"

Name: OPENAI_API_KEY
Value: [paste your key from OpenAI]
Click "Add"

Name: CLOUDINARY_API_KEY
Value: [paste your API Key from Cloudinary]
Click "Add"

Name: CLOUDINARY_API_SECRET
Value: [paste your API Secret from Cloudinary]
Click "Add"

Name: CLOUDINARY_NAME
Value: [paste your Cloud Name from Cloudinary]
Click "Add"

Name: NODE_ENV
Value: production
Click "Add"

Name: PORT
Value: 8080
Click "Add"
```

✅ All variables set! Railway will auto-redeploy when you save.

---

## Phase 4: Monitor Deployment (5 minutes)

1. Go to https://railway.com/project/5e549c2d-bd28-472b-8d1b-8b2f61b634e1
2. Click **"Worldtv-"** service
3. Click **"Deployments"** tab
4. Watch the deployment process:
   - 🔨 Building (takes 2-3 min)
   - 🚀 Deploying (takes 1-2 min)
   - ✅ Success (green checkmark)

**What's Building:**
- Docker image from `Dockerfile.production`
- Installs npm dependencies
- Builds optimized Node.js container

**When Done:**
- Service will restart
- All 3 background cron jobs start
- Redis cache ready
- API endpoints live

---

## Phase 5: Verify Everything Works (10 minutes)

### Test 1: Health Check
```bash
curl https://www.myworldtvlive.com/health
```

**Expected Response:**
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

### Test 2: Live Scores
```bash
curl https://www.myworldtvlive.com/api/live-scores
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "homeTeam": { "name": "Team A", "score": 2 },
      "awayTeam": { "name": "Team B", "score": 1 },
      "status": "LIVE",
      "broadcasts": []
    }
  ]
}
```

### Test 3: Upcoming Fixtures
```bash
curl https://www.myworldtvlive.com/api/fixtures/upcoming
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 456,
      "homeTeam": { "name": "Team C" },
      "awayTeam": { "name": "Team D" },
      "date": "2024-08-18T15:00:00Z",
      "venue": "Stadium Name",
      "broadcasts": []
    }
  ]
}
```

### Test 4: AI Placeholder
```bash
curl https://www.myworldtvlive.com/api/ai/placeholder-team?name=Arsenal
```

**Expected Response:**
- Returns SVG image of team placeholder

---

## Phase 6: Create First TV Channel (5 minutes)

You need your admin session. Check your existing code for how to login as admin.

**Once you have admin_session:**

```bash
curl -X POST https://www.myworldtvlive.com/admin/broadcasts/channels \
  -H "Content-Type: application/json" \
  -H "x-admin-session: YOUR_ADMIN_SESSION_ID" \
  -d '{
    "name": "Sky Sports",
    "country": "United Kingdom",
    "logoUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Sky_Sports_logo.svg/1280px-Sky_Sports_logo.svg.png",
    "website": "https://www.skysports.com"
  }'
```

**Expected Response:**
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
    "created_at": "2024-08-17T..."
  }
}
```

---

## Troubleshooting

### ❌ "Invalid API key" Error
**Problem:** RapidAPI key is wrong or not set
**Solution:**
1. Copy your key again from https://rapidapi.com/api-sports/api/api-football
2. Update RAPIDAPI_KEY in Railway variables
3. Wait 2 minutes for re-deployment

### ❌ "DALL-E quota exceeded"
**Problem:** No OpenAI credits
**Solution:**
1. Go to https://platform.openai.com/account/billing/overview
2. Add payment method
3. AI image generation will work once credits available

### ❌ "Redis connection failed"
**Problem:** Redis plugin not connected
**Solution:**
1. Go to Railway dashboard
2. Verify Redis is showing in your project
3. Check REDIS_URL variable is set
4. Restart Worldtv- service

### ❌ "Deployment keeps failing"
**Problem:** Docker build error
**Solution:**
1. Check build logs in Railway dashboard
2. Look for specific error message
3. Most common: Missing environment variables
4. Verify all 8 variables are set

### ✅ All tests passing but no live data
**Problem:** No live matches at the moment
**Solution:** This is normal! Live scores only appear when matches are actually being played. Try `/api/fixtures/upcoming` to see scheduled matches instead.

---

## Success Checklist ✅

- [ ] RapidAPI key obtained
- [ ] OpenAI key obtained  
- [ ] Cloudinary keys obtained
- [ ] PR #21 merged to main
- [ ] Redis plugin added to Railway
- [ ] All 8 environment variables set in Railway
- [ ] Deployment completed (green checkmark)
- [ ] `/health` endpoint returns 200 OK
- [ ] `/api/live-scores` returns valid JSON
- [ ] `/api/fixtures/upcoming` returns valid JSON
- [ ] `/api/ai/placeholder-team` returns SVG
- [ ] Can add TV channel via admin API

---

## Next Steps

Once everything is working:

1. **Update Your Homepage** - Add live scores and fixtures sections
2. **Create More Channels** - Add ESPN, BBC Sport, etc. via admin API
3. **Schedule Broadcasts** - Link matches to channels
4. **Test AI Images** - Generate match artwork
5. **Monitor Performance** - Watch Redis cache and cron jobs in logs

**Need Help?**
- Check `INTEGRATION_GUIDE.md` for API documentation
- Check `DEPLOYMENT_CHECKLIST.md` for verification steps
- Check Railway logs if things aren't working
- All logs visible in Railway dashboard → Logs tab

---

**You've got this! 🚀**

