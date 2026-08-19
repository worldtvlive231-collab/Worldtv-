// Adapter for the configured RapidAPI provider: free-api-live-football-data.p.rapidapi.com
// The existing server.js football routes use API-Football-style /matches queries.
// This preload translates those requests to this provider's real endpoints and
// normalizes the response so the existing public API and frontend keep working.

const nativeFetch = global.fetch;
const providerCache = new Map();

if (typeof nativeFetch !== "function") {
  throw new Error("Global fetch is required for football-fetch-adapter.js");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
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

function leagueName(match) {
  return match?.league?.name || match?.tournament?.name || match?.leagueName || match?.competition?.name || "Football";
}

function leagueLogo(match) {
  return match?.league?.logo || match?.tournament?.logo || match?.tournament?.image || match?.competition?.logo || null;
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
  const status = normalizedStatus(match?.status || {});
  const kickoff = match?.status?.utcTime || match?.utcTime || match?.startTime || match?.date || null;

  return {
    fixture: {
      id: match?.id || match?.eventId || match?.matchId || null,
      date: kickoff,
      status
    },
    league: {
      id: match?.leagueId || match?.league?.id || match?.tournament?.id || null,
      name: leagueName(match),
      logo: leagueLogo(match)
    },
    teams: {
      home: {
        id: match?.home?.id || null,
        name: match?.home?.name || "Home",
        logo: teamLogo(match?.home)
      },
      away: {
        id: match?.away?.id || null,
        name: match?.away?.name || "Away",
        logo: teamLogo(match?.away)
      }
    },
    goals: {
      home: match?.home?.score ?? null,
      away: match?.away?.score ?? null
    }
  };
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
  const key = `date:${date}`;
  const cached = providerCache.get(key);
  if (cached && Date.now() - cached.time < ttl) return cached.matches;

  const providerDate = formatProviderDate(date);
  const url = `https://${host}/football-get-matches-by-date?date=${encodeURIComponent(providerDate)}`;
  const { response, data } = await fetchProvider(url, init);
  if (!response.ok) throw new Error(`Football provider API error ${response.status}`);

  const matches = Array.isArray(data?.response?.matches) ? data.response.matches : [];
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
    return jsonResponse({ response: live.map(normalizeMatch) });
  }

  if (params.get("date")) {
    try {
      const matches = await fetchMatchesByDate(host, params.get("date"), init);
      return jsonResponse({ response: matches.map(normalizeMatch) });
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
          const kickoff = new Date(m?.status?.utcTime || "").getTime();
          if (Number.isNaN(kickoff)) return m?.status?.started !== true && m?.status?.finished !== true;
          return kickoff >= now && m?.status?.finished !== true && m?.status?.cancelled !== true;
        });
      }

      return jsonResponse({ response: matches.map(normalizeMatch) });
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
