# 🔑 API Keys Checklist - Copy & Paste Reference

## Your Information (SAVE THIS SECURELY)

```
================================================================================
                        WORLD TV v2.0.0 - API KEYS
================================================================================

Project: genuine-communication
Service: Worldtv-
Environment: production
Created: 2024-08-17

================================================================================
                         RAPIDAPI FOOTBALL
================================================================================

Website: https://rapidapi.com/api-sports/api/api-football
Status: [ ] OBTAINED

Key Type: x-rapidapi-key
Your Key: _________________________________________

Host Type: x-rapidapi-host
Host Value: api-football-v1.p.rapidapi.com

Free Tier: 300 requests/day
Documentation: https://rapidapi.com/api-sports/api/api-football/details

Notes: This key expires if not used for 30 days (free tier)


================================================================================
                           OPENAI / DALL-E 3
================================================================================

Website: https://platform.openai.com
Status: [ ] OBTAINED

API Key: sk-__________________________________________

Important Notes:
⚠️  COPY IMMEDIATELY - Cannot be viewed again after creation
⚠️  Requires payment method or free credits to use
⚠️  Cost: ~$0.04 per image with DALL-E 3

Free Trial: Limited credits (check at https://platform.openai.com/account/billing/overview)

Pricing: https://openai.com/pricing


================================================================================
                            CLOUDINARY
================================================================================

Website: https://cloudinary.com
Status: [ ] OBTAINED

Cloud Name: _______________________________________
API Key: _______________________________________
API Secret: _______________________________________

Free Tier: 25GB/month storage
Dashboard: https://cloudinary.com/console/dashboard

Notes: API Secret should be kept private (backend only)


================================================================================
                       ENVIRONMENT VARIABLES
================================================================================

Copy and paste these into Railway Variables (with your actual values):

RAPIDAPI_KEY=_________________________________________

RAPIDAPI_HOST=api-football-v1.p.rapidapi.com

OPENAI_API_KEY=sk-__________________________________________

CLOUDINARY_NAME=_______________________________________

CLOUDINARY_API_KEY=_______________________________________

CLOUDINARY_API_SECRET=_______________________________________

NODE_ENV=production

PORT=8080


================================================================================
                      RAILROAD DEPLOYMENT
================================================================================

Project URL: https://railway.com/project/5e549c2d-bd28-472b-8d1b-8b2f61b634e1

Deployment Checklist:
[ ] Merge PR #21 on GitHub
[ ] Add Redis plugin in Railway
[ ] Set all 8 environment variables
[ ] Monitor deployment (3-5 min)
[ ] Test /health endpoint
[ ] Test /api/live-scores
[ ] Test /api/fixtures/upcoming
[ ] Test /api/ai/placeholder-team


================================================================================
                      SUPPORT & RESOURCES
================================================================================

Documentation:
- QUICK_START_SETUP.md - Step-by-step guide (you are here!)
- INTEGRATION_GUIDE.md - Full API documentation
- DEPLOYMENT_CHECKLIST.md - Verification steps

Test Endpoints:
- Health: https://www.myworldtvlive.com/health
- Live Scores: https://www.myworldtvlive.com/api/live-scores
- Fixtures: https://www.myworldtvlive.com/api/fixtures/upcoming
- Placeholder: https://www.myworldtvlive.com/api/ai/placeholder-team?name=Arsenal

API Rate Limits:
- RapidAPI: 300 requests/day (free)
- OpenAI: Based on account credits
- Cloudinary: 25GB/month (free)
- Railway: Unlimited (paying plan)


================================================================================
                         SECURITY NOTES
================================================================================

✅ DO:
- Keep API keys in Railway Variables (encrypted)
- Never commit keys to GitHub
- Use .env.example for template only
- Rotate keys periodically
- Monitor API usage in dashboards

❌ DON'T:
- Share API keys with anyone
- Paste keys in chat/email
- Commit .env file to git
- Use keys in frontend code
- Share screenshots with keys visible


================================================================================
```

## Quick Command Reference

### Test Health
```bash
curl https://www.myworldtvlive.com/health
```

### Test Live Scores
```bash
curl https://www.myworldtvlive.com/api/live-scores
```

### Test Fixtures
```bash
curl https://www.myworldtvlive.com/api/fixtures/upcoming
```

### Test AI Placeholder
```bash
curl "https://www.myworldtvlive.com/api/ai/placeholder-team?name=Arsenal"
```

## Railway Variables Template

Copy and paste into Railway (Variables tab):

```
RAPIDAPI_KEY=YOUR_KEY_HERE
RAPIDAPI_HOST=api-football-v1.p.rapidapi.com
OPENAI_API_KEY=YOUR_KEY_HERE
CLOUDINARY_NAME=YOUR_NAME_HERE
CLOUDINARY_API_KEY=YOUR_KEY_HERE
CLOUDINARY_API_SECRET=YOUR_SECRET_HERE
NODE_ENV=production
PORT=8080
```

---

**Save this file securely. Don't share the keys in the filled-in version!**

