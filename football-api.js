const axios = require('axios');

const CACHE = {
  live: { data: [], timestamp: 0 },
  today: { data: [], timestamp: 0 },
  upcoming: { data: [], timestamp: 0 }
};

const CACHE_TTL = {
  live: 30 * 1000, // 30 seconds
  today: 5 * 60 * 1000, // 5 minutes
  upcoming: 15 * 60 * 1000 // 15 minutes
};

function isCacheValid(cacheKey) {
  const now = Date.now();
  return CACHE[cacheKey].timestamp > 0 && 
         (now - CACHE[cacheKey].timestamp) < CACHE_TTL[cacheKey];
}

function getApiHeaders() {
  return {
    'x-rapidapi-key': process.env.FOOTBALL_API_KEY,
    'x-rapidapi-host': 'api-football-v3.p.rapidapi.com'
  };
}

function parseFixture(apiFixture) {
  return {
    api_fixture_id: apiFixture.fixture.id,
    home_team: apiFixture.teams.home.name,
    away_team: apiFixture.teams.away.name,
    home_team_logo: apiFixture.teams.home.logo,
    away_team_logo: apiFixture.teams.away.logo,
    league: apiFixture.league.name,
    league_logo: apiFixture.league.logo,
    kickoff_time: apiFixture.fixture.date,
    current_score_home: apiFixture.goals.home || 0,
    current_score_away: apiFixture.goals.away || 0,
    match_status: apiFixture.fixture.status,
    current_minute: apiFixture.fixture.status === 'live' ? apiFixture.fixture.elapsed : null,
    half_time_home: apiFixture.score?.halftime?.home || null,
    half_time_away: apiFixture.score?.halftime?.away || null,
    events_json: JSON.stringify(apiFixture.events || [])
  };
}

async function fetchFromApi(endpoint, params = {}) {
  try {
    const url = `${process.env.FOOTBALL_API_BASE_URL}${endpoint}`;
    const response = await axios.get(url, {
      headers: getApiHeaders(),
      params,
      timeout: 10000
    });
    return response.data.response || [];
  } catch (error) {
    console.error('Football API Error:', error.message);
    return [];
  }
}

async function fetchLiveMatches() {
  if (isCacheValid('live')) {
    return CACHE.live.data;
  }

  const fixtures = await fetchFromApi('/fixtures', {
    live: 'all'
  });

  CACHE.live = {
    data: fixtures.map(parseFixture),
    timestamp: Date.now()
  };

  return CACHE.live.data;
}

async function fetchTodayMatches() {
  if (isCacheValid('today')) {
    return CACHE.today.data;
  }

  const today = new Date().toISOString().split('T')[0];
  const fixtures = await fetchFromApi('/fixtures', {
    date: today
  });

  CACHE.today = {
    data: fixtures.map(parseFixture),
    timestamp: Date.now()
  };

  return CACHE.today.data;
}

async function fetchUpcomingMatches(days = 7) {
  if (isCacheValid('upcoming')) {
    return CACHE.upcoming.data;
  }

  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const fixtures = await fetchFromApi('/fixtures', {
    from,
    to
  });

  CACHE.upcoming = {
    data: fixtures.map(parseFixture),
    timestamp: Date.now()
  };

  return CACHE.upcoming.data;
}

async function searchMatches(query) {
  try {
    const fixtures = await fetchFromApi('/fixtures', {
      search: query
    });
    return fixtures.map(parseFixture);
  } catch (error) {
    console.error('Search error:', error.message);
    return [];
  }
}

function clearCache() {
  CACHE.live = { data: [], timestamp: 0 };
  CACHE.today = { data: [], timestamp: 0 };
  CACHE.upcoming = { data: [], timestamp: 0 };
}

module.exports = {
  fetchLiveMatches,
  fetchTodayMatches,
  fetchUpcomingMatches,
  searchMatches,
  clearCache,
  parseFixture
};

