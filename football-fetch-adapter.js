// LiveScore-backed adapter for the existing /matches football API contract.
// Keeps the website/admin routes unchanged while sourcing fixtures from LiveScore's public JSON feed.
const nativeFetch = global.fetch;
if (typeof nativeFetch !== "function") throw new Error("Global fetch is required");

const providerCache = new Map();
const LIVE_BASE = "https://prod-cdn-mev-api.livescore.com";
const DATE_BASE = "https://prod-cdn-public-api.livescore.com";
const STATIC_BASE = "https://lsm-static-prod.livescore.com/medium/";

const TOP_LEAGUES = [
  { canonical: "Premier League", countries: ["england"], names: [/^premier league(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "Serie A", countries: ["italy"], names: [/^serie a(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "La Liga", countries: ["spain"], names: [/^la\s*liga(?:\s+\d{2}\/\d{2})?$/i, /^laliga(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "Bundesliga", countries: ["germany"], names: [/^bundesliga(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "Ligue 1", countries: ["france"], names: [/^ligue 1(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "EFL Championship", countries: ["england"], names: [/^championship(?:\s+\d{2}\/\d{2})?$/i, /^efl championship(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "Belgian Pro League", countries: ["belgium"], names: [/^pro league(?:\s+\d{2}\/\d{2})?$/i, /^jupiler pro league(?:\s+\d{2}\/\d{2})?$/i, /^first division a(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "Primeira Liga", countries: ["portugal"], names: [/^primeira liga(?:\s+\d{2}\/\d{2})?$/i, /^liga portugal(?: betclic)?(?:\s+\d{2}\/\d{2})?$/i] },
  { canonical: "Brasileirão Serie A", countries: ["brazil", "brasil"], names: [/^serie a(?:\s+\d{4})?$/i, /^brasileir[aã]o(?: serie a)?(?:\s+\d{4})?$/i] },
  { canonical: "Eredivisie", countries: ["netherlands", "holland"], names: [/^eredivisie(?:\s+\d{2}\/\d{2})?$/i] }
];

const clean = v => String(v ?? "").trim();
const norm = v => clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function datesInclusive(from, to, maxDays = 8) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const out = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let d = start; d <= end && out.length < maxDays; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parsePackedUtc(value) {
  const s = clean(value);
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))).toISOString();
}

function assetUrl(path) {
  const p = clean(path);
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return STATIC_BASE + p.replace(/^\/+/, "");
}

function stageLeague(stage = {}) {
  const country = norm(stage.Cnm || stage.Csnm || stage.CompD || stage.CompST || stage.Ccd);
  const candidates = [stage.CompN, stage.Snm, stage.Sds, stage.CompUrlName, stage.Scd].map(clean).filter(Boolean);
  return TOP_LEAGUES.find(league => {
    if (league.countries.length && !league.countries.some(c => country === c || country.includes(c))) return false;
    return candidates.some(name => league.names.some(re => re.test(name)));
  }) || null;
}

function eventStatus(event = {}) {
  const esid = Number(event.Esid);
  const epr = Number(event.Epr);
  const eps = clean(event.Eps);
  const elapsedMatch = eps.match(/(\d+)/);
  const elapsed = elapsedMatch ? Number(elapsedMatch[1]) : null;

  if (epr === 1 || [2, 3, 10].includes(esid)) {
    return { short: "LIVE", long: eps || "Live", elapsed };
  }
  if (epr === 2 || [6, 13].includes(esid) || /^(FT|AP)$/i.test(eps)) {
    return { short: "FT", long: eps || "Finished", elapsed: null };
  }
  return { short: "NS", long: "Not Started", elapsed: null };
}

function firstTeam(value) {
  if (Array.isArray(value)) return value[0] || {};
  return value && typeof value === "object" ? value : {};
}

function normalizeEvent(stage, event) {
  const league = stageLeague(stage);
  if (!league || !event || typeof event !== "object") return null;
  const home = firstTeam(event.T1);
  const away = firstTeam(event.T2);
  const kickoff = parsePackedUtc(event.Esd) || (event.Etm?.ATm ? new Date(Number(event.Etm.ATm)).toISOString() : null);
  const status = eventStatus(event);

  return {
    fixture: {
      id: event.Eid || event.id || null,
      date: kickoff,
      status
    },
    league: {
      id: stage.CompId || stage.Sid || null,
      name: league.canonical,
      logo: assetUrl(stage.badgeUrl)
    },
    teams: {
      home: {
        id: home.ID || home.id || null,
        name: home.Nm || home.name || "Home",
        logo: assetUrl(home.Img || home.image)
      },
      away: {
        id: away.ID || away.id || null,
        name: away.Nm || away.name || "Away",
        logo: assetUrl(away.Img || away.image)
      }
    },
    goals: {
      home: event.Tr1 === undefined || event.Tr1 === null || event.Tr1 === "" ? null : Number(event.Tr1),
      away: event.Tr2 === undefined || event.Tr2 === null || event.Tr2 === "" ? null : Number(event.Tr2)
    }
  };
}

function normalizeStages(data) {
  const stages = Array.isArray(data?.Stages) ? data.Stages : Array.isArray(data?.response?.Stages) ? data.response.Stages : [];
  const out = [];
  for (const stage of stages) {
    if (!stageLeague(stage)) continue;
    const events = Array.isArray(stage?.Events) ? stage.Events : [];
    for (const event of events) {
      const normalized = normalizeEvent(stage, event);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`LiveScore returned invalid JSON (${response.status})`); }
}

async function fetchCached(url, key, ttlMs) {
  const cached = providerCache.get(key);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;

  const response = await nativeFetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "WorldTV/1.0"
    }
  });
  if (!response.ok) {
    if (cached?.data) return cached.data;
    throw new Error(`LiveScore API error ${response.status}`);
  }
  const data = await readJson(response);
  providerCache.set(key, { time: Date.now(), data });
  return data;
}

async function fetchLive() {
  const url = `${LIVE_BASE}/v1/api/app/live/soccer/0?countryCode=GH&locale=en`;
  const data = await fetchCached(url, "livescore:live:v1", 25 * 1000);
  return normalizeStages(data).filter(m => m.fixture?.status?.short === "LIVE");
}

async function fetchDate(date) {
  const ymd = date.replace(/-/g, "");
  const url = `${DATE_BASE}/v1/api/app/date/soccer/${encodeURIComponent(ymd)}/0?countryCode=GH&locale=en&MD=1`;
  const data = await fetchCached(url, `livescore:date:${ymd}:v1`, 30 * 60 * 1000);
  return normalizeStages(data);
}

async function handleMatches(url) {
  const p = url.searchParams;
  if (p.get("live") === "all") {
    return jsonResponse({ response: await fetchLive() });
  }

  if (p.get("date")) {
    return jsonResponse({ response: await fetchDate(p.get("date")) });
  }

  const from = p.get("dateFrom");
  const to = p.get("dateTo");
  if (from && to) {
    const all = [];
    for (const date of datesInclusive(from, to, 8)) {
      const matches = await fetchDate(date);
      all.push(...matches);
    }

    const finishedOnly = p.get("status") === "FT";
    const now = Date.now();
    const filtered = all.filter(match => {
      if (finishedOnly) return match.fixture?.status?.short === "FT";
      if (match.fixture?.status?.short === "FT") return false;
      const kickoffMs = new Date(match.fixture?.date || "").getTime();
      return Number.isNaN(kickoffMs) || kickoffMs >= now - 2 * 60 * 60 * 1000;
    });

    const deduped = Array.from(new Map(filtered.map(m => [String(m.fixture?.id || `${m.teams?.home?.name}-${m.teams?.away?.name}-${m.fixture?.date}`), m])).values());
    return jsonResponse({ response: deduped });
  }

  return null;
}

global.fetch = async function footballAwareFetch(input, init = {}) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  } catch {
    return nativeFetch(input, init);
  }

  const configuredHost = process.env.FOOTBALL_API_HOST;
  if (!configuredHost || url.hostname !== configuredHost || url.pathname !== "/matches") {
    return nativeFetch(input, init);
  }

  try {
    const response = await handleMatches(url);
    return response || nativeFetch(input, init);
  } catch (error) {
    console.error("[Football adapter]", error.message);
    return jsonResponse({ error: "Football data temporarily unavailable" }, 502);
  }
};
