// Adapter for the configured RapidAPI provider: free-api-live-football-data.p.rapidapi.com
// The existing server.js football routes use API-Football-style /matches queries.
// This preload translates those requests to the provider's real endpoints,
// normalizes the response, filters to the requested top 10 leagues, and keeps
// team logos when the provider supplies them.

const nativeFetch = global.fetch;
const providerCache = new Map();

if (typeof nativeFetch !== "function") {
  throw new Error("Global fetch is required for football-fetch-adapter.js");
}

const TOP_LEAGUES = [
  { canonical: "Premier League", countries: ["ENG"], names: [/^premier league$/i] },
  { canonical: "Serie A", countries: ["ITA"], names: [/^serie a$/i] },
  { canonical: "La Liga", countries: ["ESP"], names: [/^la ?liga$/i, /^laliga$/i] },
  { canonical: "Bundesliga", countries: ["GER", "DEU"], names: [/^bundesliga$/i] },
  { canonical: "Ligue 1", countries: ["FRA"], names: [/^ligue 1$/i] },
  { canonical: "EFL Championship", countries: ["ENG"], names: [/^championship$/i, /^efl championship$/i] },
  { canonical: "Belgian Pro League", countries: ["BEL"], names: [/^belgian pro league$/i, /^jupiler pro league$/i, /^pro league$/i, /^first division a$/i] },
  { canonical: "Primeira Liga", countries: ["POR"], names: [/^primeira liga$/i, /^liga portugal$/i, /^liga portugal betclic$/i] },
  { canonical: "Brasileirão Serie A", countries: ["BRA"], names: [/^brasileir[aã]o.*serie a$/i, /^serie a$/i] },
  { canonical: "Eredivisie", countries: ["NED", "NLD"], names: [/^eredivisie$/i] }
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function cleanCode(value) {
  return String(value || "").trim().toUpperCase();
}

function cleanName(value) {
  return String(value || "").trim();
}

function formatProviderDate(dateString) {
  return String(dateString || "").replace(/-/g, "");
}

function datesInclusive(from, to, maxDays = 8) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const out = [];
  for (let d = start; d <= end && out.length < maxDays; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function teamLogo(team) {
  return team?.logo || team?.image || team?.imageUrl || team?.imagePath || team?.img || null;
}

function rawLeagueName(match) {
  return cleanName(
    match?._league?.name ||
    match?.league?.name ||
    match?.tournament?.name ||
    match?.tournament?.leagueName ||
    match?.leagueName ||
    match?.competition?.name ||
    ""
  );
}

function rawCountryCode(match) {
  return cleanCode(
    match?._league?.ccode ||
    match?._league?.countryCode ||
    match?.tournament?.ccode ||
    match?.tournament?.countryCode ||
    match?.league?.ccode ||
    match?.league?.countryCode ||
    match?.countryCode ||
    ""
  );
}

function topLeagueFor(match) {
  const name = rawLeagueName(match);
  const country = rawCountryCode(match);
  if (!name) return null;

  for (const league of TOP_LEAGUES) {
    const nameMatches = league.names.some(re => re.test(name));
    if (!nameMatches) continue;

    if (country && league.countries.length && !league.countries.includes(country)) continue;

    // Generic league names such as Serie A and Premier League must have a country
    // code when possible, to avoid including unrelated competitions with the same name.
    if (!country && /^(serie a|premier league|championship|pro league)$/i.test(name)) continue;

    return league;
  }
  return null;
}

function leagueLogo(match) {
  return match?._league?.logo ||
    match?._league?.image ||
    match?.league?.logo ||
    match?.tournament?.logo ||
    match?.tournament?.image ||
    match?.competition?.logo ||
    null;
}

function parseMinute(status) {
  const raw = status?.liveTime?.short || status?.liveTime?.long || "";
  const m = String(raw).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function normalizedStatus(status) {
  if (status?.cancelled) return { short: "CANC", long: "Cancelled", elapsed: null };
  if (status?.finished) return { short: "FT", long: "Finished", elapsed: null };
  if (status?.ongoing) return { short: "LIVE", long: "Live", elapsed: parseMinute(status) };
  if (status?.started) return { short: "LIVE", long: "Live", elapsed: parseMinute(status) };
  return { short: "NS", long: "Not Started", elapsed: null };
}

function normalizeMatch(match) {
  const preferredLeague = topLeagueFor(match);
  if (!preferredLeague) return null;

  const status = normalizedStatus(match?.status || {});
  const kickoff = match?.status?.utcTime || match?.utcTime || match?.startTime || match?.date || null;

  return {
    fixture: {
      id: match?.id || match?.eventId || match?.matchId || null,
      date: kickoff,
      status
    },
    league: {
      id: match?.leagueId || match?._league?.id || match?.league?.id || match?.tournament?.id || null,
      name: preferredLeague.canonical,
      logo: leagueLogo(match)
    },
    teams: {
      home: {
        id: match?.home?.id || null,
        name: match?.home?.name || match?.home?.longName || "Home",
        logo: teamLogo(match?.home)
      },
      away: {
        id: match?.away?.id || null,
        name: match?.away?.name || match?.away?.longName || "Away",
        logo: teamLogo(match?.away)
      }
    },
    goals: {
      home: match?.home?.score ?? null,
      away: match?.away?.score ?? null
    }
  };
}

function normalizeMany(matches) {
  return matches.map(normalizeMatch).filter(Boolean);
}

function flattenProviderMatches(data) {
  const raw = Array.isArray(data?.response?.matches) ? data.response.matches : [];
  const out = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    // Provider may return a league-grouped structure:
    // { league: { name, ccode, ... }, matches: [ ... ] }
    if (Array.isArray(item.matches)) {
      const leagueMeta = item.league && typeof item.league === "object" ? item.league : item;
      for (const match of item.matches) {
        if (match && typeof match === "object") out.push({ ...match, _league: leagueMeta });
      }
      continue;
    }

    // Alternate grouped shape: { league: { ..., matches: [...] } }
    if (item.league && Array.isArray(item.league.matches)) {
      const leagueMeta = item.league;
      for (const match of item.league.matches) {
        if (match && typeof match === "object") out.push({ ...match, _league: leagueMeta });
      }
      continue;
    }

    // Flat match object.
    out.push(item);
  }

  return out;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`Football provider returned invalid JSON (${response.status})`); }
}

async function fetchProvider(url, init) {
  const response = await nativeFetch(url, init);
  if (!response.ok) return { response, data: null };
  return { response, data: await readJson(response) };
}

async function fetchMatchesByDate(host, date, init) {
  const today = new Date().toISOString().slice(0, 10);
  const ttl = date === today ? 10 * 60 * 1000 : 6 * 60 * 60 * 1000;
  const key = `date:${date}:top10`;
  const cached = providerCache.get(key);
  if (cached && Date.now() - cached.time < ttl) return cached.matches;

  const providerDate = formatProviderDate(date);
  const url = `https://${host}/football-get-matches-by-date?date=${encodeURIComponent(providerDate)}`;
  const { response, data } = await fetchProvider(url, init);
  if (!response.ok) throw new Error(`Football provider API error ${response.status}`);

  const matches = flattenProviderMatches(data);
  providerCache.set(key, { time: Date.now(), matches });
  return matches;
}

async function translateMatchesRequest(requestUrl, init) {
  const host = process.env.FOOTBALL_API_HOST;
  const params = requestUrl.searchParams;

  if (params.get("live") === "all") {
    const url = `https://${host}/football-current-live`;
    const { response, data } = await fetchProvider(url, init);
    if (!response.ok) return response;

    const live = Array.isArray(data?.response?.live) ? data.response.live : [];
    return jsonResponse({ response: normalizeMany(live) });
  }

  if (params.get("date")) {
    try {
      const matches = await fetchMatchesByDate(host, params.get("date"), init);
      return jsonResponse({ response: normalizeMany(matches) });
    } catch (error) {
      return jsonResponse({ error: error.message }, 502);
    }
  }

  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  if (dateFrom && dateTo) {
    try {
      const days = datesInclusive(dateFrom, dateTo, 8);
      const groups = [];
      for (const day of days) groups.push(await fetchMatchesByDate(host, day, init));

      let matches = groups.flat();
      const wantsFinished = params.get("status") === "FT";
      const now = Date.now();

      if (wantsFinished) {
        matches = matches.filter(m => m?.status?.finished === true);
      } else {
        matches = matches.filter(m => {
          const kickoff = new Date(m?.status?.utcTime || m?.utcTime || "").getTime();
          if (Number.isNaN(kickoff)) return m?.status?.started !== true && m?.status?.finished !== true;
          return kickoff >= now && m?.status?.finished !== true && m?.status?.cancelled !== true;
        });
      }

      return jsonResponse({ response: normalizeMany(matches) });
    } catch (error) {
      return jsonResponse({ error: error.message }, 502);
    }
  }

  return nativeFetch(requestUrl, init);
}

global.fetch = async function footballAwareFetch(input, init = {}) {
  let requestUrl;
  try {
    requestUrl = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  } catch (e) {
    return nativeFetch(input, init);
  }

  const configuredHost = process.env.FOOTBALL_API_HOST;
  if (!configuredHost || requestUrl.hostname !== configuredHost || requestUrl.pathname !== "/matches") {
    return nativeFetch(input, init);
  }

  try {
    return await translateMatchesRequest(requestUrl, init);
  } catch (error) {
    console.error("[Football adapter]", error.message);
    return jsonResponse({ error: "Football data temporarily unavailable" }, 502);
  }
};
