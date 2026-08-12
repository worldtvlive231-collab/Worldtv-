
// ==========================================
// FOOTBALL API INTEGRATION - RapidAPI
// ==========================================

const footballCache = new Map();

async function callFootballApi(endpoint) {
  if (!process.env.FOOTBALL_API_KEY) {
    throw new Error("FOOTBALL_API_KEY not configured");
  }
  if (!process.env.FOOTBALL_API_HOST) {
    throw new Error("FOOTBALL_API_HOST not configured");
  }

  const apiHost = process.env.FOOTBALL_API_HOST;
  const url = `https://${apiHost}${endpoint}`;

  try {
    const response = await fetch(url, {
      headers: {
        "x-rapidapi-key": process.env.FOOTBALL_API_KEY,
        "x-rapidapi-host": apiHost
      }
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error(`[Football API] ${endpoint}:`, error.message);
    throw error;
  }
}

async function getCachedFootball(key, endpoint, ttl = 30000) {
  const cached = footballCache.get(key);
  if (cached && Date.now() - cached.time < ttl) {
    return cached.data;
  }

  const data = await callFootballApi(endpoint);
  footballCache.set(key, { time: Date.now(), data });
  return data;
}

// TEST CONNECTION
app.get("/api/football/test", async (req, res) => {
  try {
    const hasKey = !!process.env.FOOTBALL_API_KEY;
    const hasHost = !!process.env.FOOTBALL_API_HOST;

    if (!hasKey || !hasHost) {
      return res.status(400).json({
        ok: false,
        error: "Missing environment variables",
        FOOTBALL_API_KEY: hasKey,
        FOOTBALL_API_HOST: hasHost
      });
    }

    const data = await callFootballApi("/matches?live=all&limit=1");
    res.json({
      ok: true,
      message: "Football API working",
      api_host: process.env.FOOTBALL_API_HOST,
      has_data: !!data.response
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      api_host: process.env.FOOTBALL_API_HOST
    });
  }
});

// LIVE MATCHES
app.get("/api/football/live", async (req, res) => {
  try {
    const data = await getCachedFootball("football-live", "/matches?live=all", 30000);

    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams && m.goals)
      .slice(0, 20)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: m.fixture?.status?.elapsed,
        status: m.fixture?.status?.short,
        status_long: m.fixture?.status?.long,
        kickoff: m.fixture?.date
      }));

    res.json({ ok: true, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// TODAY'S MATCHES
app.get("/api/football/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const data = await getCachedFootball(`football-today-${today}`, `/matches?date=${today}`, 120000);

    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams && m.goals)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: m.fixture?.status?.elapsed,
        status: m.fixture?.status?.short,
        status_long: m.fixture?.status?.long,
        kickoff: m.fixture?.date
      }));

    res.json({ ok: true, date: today, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// UPCOMING MATCHES
app.get("/api/football/upcoming", async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const data = await getCachedFootball("football-upcoming", `/matches?dateFrom=${today}&dateTo=${nextWeek}`, 600000);

    const matches = (data.response || [])
      .filter(m => m && m.fixture && m.teams)
      .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
      .slice(0, 20)
      .map(m => ({
        fixture_id: m.fixture?.id,
        league: m.league?.name || "Unknown",
        league_logo: m.league?.logo,
        home_team: m.teams?.home?.name,
        home_logo: m.teams?.home?.logo,
        away_team: m.teams?.away?.name,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        minute: m.fixture?.status?.elapsed,
        status: m.fixture?.status?.short,
        status_long: m.fixture?.status?.long,
        kickoff: m.fixture?.date
      }));

    res.json({ ok: true, period: `${today} to ${nextWeek}`, count: matches.length, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

