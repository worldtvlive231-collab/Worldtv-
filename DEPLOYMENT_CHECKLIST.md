# World TV v2.0.0 - Deployment Checklist

## Pre-Deployment (Before pushing to main)

### Code Quality
- [ ] All modules tested locally with `npm run dev`
- [ ] No console errors in browser
- [ ] No unhandled promise rejections
- [ ] Database migrations verified
- [ ] Routes accessible and responding correctly

### Configuration
- [ ] `.env.example` contains all required variables
- [ ] `.env` created locally with actual API keys
- [ ] Redis connection tested
- [ ] RapidAPI credentials verified working
- [ ] OpenAI API quota available
- [ ] Cloudinary credentials working

### Documentation
- [ ] README.md updated with v2.0.0 features
- [ ] INTEGRATION_GUIDE.md reviewed
- [ ] API endpoints documented
- [ ] Database schema documented

### Files Created/Modified
- [ ] `package.json` - Dependencies added
- [ ] `lib/football-api.js` - New module
- [ ] `lib/ai-image-generator.js` - New module
- [ ] `lib/broadcast-manager.js` - New module
- [ ] `routes/api-live-scores.js` - New routes
- [ ] `routes/admin-broadcasts.js` - New routes
- [ ] `routes/api-ai-images.js` - New routes
- [ ] `components/live-scores.html` - New UI component
- [ ] `components/fixtures-broadcasts.html` - New UI component
- [ ] `server-enhanced.js` - New server (or merge into existing server.js)
- [ ] `Dockerfile.production` - Production Docker config
- [ ] `railway.json` - Railway deployment config
- [ ] `.env.example` - Environment template
- [ ] `INTEGRATION_GUIDE.md` - Setup guide

## Railway Pre-Deployment

### Environment Setup
- [ ] Log in to Railway dashboard
- [ ] Navigate to genuine-communication project
- [ ] Select production environment

### Services Configuration
- [ ] Add/verify Redis plugin
- [ ] Set all environment variables:
  - `RAPIDAPI_KEY`
  - `RAPIDAPI_HOST`
  - `OPENAI_API_KEY`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
  - `REDIS_URL` (auto-set by Redis plugin)
  - `NODE_ENV=production`
  - `PORT=8080`

### Database Preparation
- [ ] Worldtv- service is using latest deploy
- [ ] SQLite database directory exists: `/app/data`
- [ ] Database backups created
- [ ] Migration scripts ready (if needed)

## Deployment Steps

### 1. Create Feature Branch
```bash
git checkout -b feature/v2-full-integration
```

### 2. Stage All Changes
```bash
git add .
git commit -m "feat: Full integration of football API, broadcasts, and AI imagery

- Added Football API integration with RapidAPI
- Implemented broadcast scheduling system with SQLite
- Integrated DALL-E 3 for AI match artwork
- Added Redis caching for performance
- Created comprehensive REST API endpoints
- Built responsive UI components for live scores and fixtures
- Implemented background cron jobs for data polling
- Added production-ready Docker and Railway configs
- Full integration guide and troubleshooting docs

BREAKING CHANGE: Requires Redis and additional API keys for full functionality"
```

### 3. Push to Railway
```bash
git push origin feature/v2-full-integration
railway up
```

### 4. Monitor Deployment
- [ ] Check Railway dashboard for build progress
- [ ] Wait for deployment to complete (5-10 minutes typical)
- [ ] Check `/health` endpoint returns 200 OK
- [ ] Verify cron jobs started logging

### 5. Test Endpoints
```bash
# Test health
curl https://worldtv-production.up.railway.app/health

# Test live scores
curl https://worldtv-production.up.railway.app/api/live-scores

# Test fixtures
curl https://worldtv-production.up.railway.app/api/fixtures/upcoming

# Test AI placeholder
curl https://worldtv-production.up.railway.app/api/ai/placeholder-team?name=Manchester
```

### 6. Verify Services
- [ ] Live scores loading in browser
- [ ] Fixtures rendering correctly
- [ ] Database tables created
- [ ] Redis cache working (check logs)
- [ ] Cron jobs running (check logs)
- [ ] No API rate limiting errors

### 7. Admin Functions
- [ ] Admin can add TV channel via API
- [ ] Admin can schedule broadcast
- [ ] Admin can update channel info
- [ ] Admin can delete old channels

### 8. Performance Checks
- [ ] Live scores page loads in < 2s
- [ ] Fixtures page responsive on mobile
- [ ] Cache hit rate visible in logs
- [ ] Memory usage stable (< 512MB)
- [ ] CPU usage normal (< 30%)

## Post-Deployment

### Monitoring
- [ ] Set up error tracking (Sentry optional)
- [ ] Monitor cron job execution
- [ ] Watch Redis memory usage
- [ ] Monitor API rate limits with RapidAPI
- [ ] Check Cloudinary upload logs

### Data Management
- [ ] Seed initial TV channels
- [ ] Create test broadcasts
- [ ] Verify AI image generation works
- [ ] Test all API endpoints in production
- [ ] Confirm database persistence

### User Testing
- [ ] Test live scores on desktop browser
- [ ] Test fixtures on mobile
- [ ] Test broadcast scheduling (admin)
- [ ] Verify no console errors
- [ ] Check page performance (Lighthouse)

### Rollback Plan (If Issues)
If critical issues occur:
```bash
# Rollback to previous deploy
railway rollback

# Or revert git commit
git revert HEAD
git push origin main
```

## Post-Merge to Main

- [ ] Create release notes documenting v2.0.0 features
- [ ] Update homepage with live scores information
- [ ] Announce feature to users
- [ ] Monitor for 24+ hours
- [ ] Update documentation site

## Success Criteria

✅ **Deployment is successful when:**
1. Server starts without errors
2. `/health` endpoint returns 200 OK
3. Live scores API returns data
4. Fixtures API returns data
5. Broadcasts can be scheduled
6. AI image generation works
7. Redis cache is operational
8. Cron jobs execute on schedule
9. Database operations succeed
10. No critical errors in logs (24h observation)

## Version Info
- **Release**: v2.0.0 - Full Integration
- **Date**: 2024-08-17
- **Components**: Football API, Broadcast Manager, AI Images, Redis Cache
- **Breaking Changes**: Requires Redis service and additional API keys
- **Rollback**: Supported via Railway rollback feature

