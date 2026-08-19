// Strong Top 10 league classifier layered after football-fetch-adapter.js.
// It classifies fixtures by current team membership when provider league metadata is incomplete.
const previousFetch = global.fetch;
if (typeof previousFetch !== "function") throw new Error("Global fetch is required");

const TOP_LEAGUES = [
  { id: 47, name: "Premier League" },
  { id: 55, name: "Serie A" },
  { id: 87, name: "La Liga" },
  { id: 54, name: "Bundesliga" },
  { id: 53, name: "Ligue 1" },
  { id: 48, name: "EFL Championship" },
  { id: 40, name: "Belgian Pro League" },
  { id: 61, name: "Primeira Liga" },
  { id: 268, name: "Brasileirão Serie A" },
  { id: 57, name: "Eredivisie" }
];

const cache = new Map();
const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const fmtDate = v => String(v || "").replace(/-/g, "");
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function datesInclusive(from, to, maxDays = 8) {
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`), out = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let d = start; d <= end && out.length < maxDays; d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`Football provider returned invalid JSON (${response.status})`); }
}

async function providerJson(host, path, init) {
  const response = await previousFetch(`https://${host}${path}`, init);
  if (!response.ok) throw new Error(`Football provider API error ${response.status}`);
  return readJson(response);
}

function flattenMatches(data) {
  const roots = [];
  if (Array.isArray(data?.response?.matches)) roots.push(...data.response.matches);
  else if (Array.isArray(data?.response)) roots.push(...data.response);
  else if (Array.isArray(data?.matches)) roots.push(...data.matches);
  const out = [];
  for (const item of roots) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.matches)) {
      const meta = item.league && typeof item.league === "object" ? { ...item, ...item.league } : item;
      for (const m of item.matches) if (m && typeof m === "object") out.push({ ...m, _league: meta });
    } else if (item.league && Array.isArray(item.league.matches)) {
      const meta = { ...item, ...item.league };
      for (const m of item.league.matches) if (m && typeof m === "object") out.push({ ...m, _league: meta });
    } else out.push(item);
  }
  return out;
}

function objectId(o) {
  return o?.id ?? o?.teamId ?? o?.team_id ?? o?.team?.id ?? null;
}
function objectName(o) {
  return o?.name ?? o?.teamName ?? o?.team_name ?? o?.longName ?? o?.shortName ?? o?.team?.name ?? "";
}

function collectTeamTokens(data) {
  const ids = new Set(), names = new Set(), seen = new Set();
  function walk(value, depth = 0) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) { for (const v of value) walk(v, depth + 1); return; }
    if (typeof value !== "object") return;
    if (seen.has(value)) return; seen.add(value);
    const id = objectId(value), name = objectName(value);
    if (id != null && name) { ids.add(String(id)); names.add(norm(name)); }
    for (const [key, child] of Object.entries(value)) {
      if (["players", "staff", "news", "transfers"].includes(String(key).toLowerCase())) continue;
      walk(child, depth + 1);
    }
  }
  walk(data);
  return { ids, names };
}

async function getLeagueTeams(host, league, init) {
  const key = `teams:${league.id}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const data = await providerJson(host, `/football-get-list-all-team?leagueid=${league.id}`, init);
    const value = collectTeamTokens(data);
    cache.set(key, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return value;
  } catch (error) {
    console.warn(`[Football Top10] teams ${league.id}: ${error.message}`);
    const value = { ids: new Set(), names: new Set() };
    cache.set(key, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
    return value;
  }
}

async function teamMembership(host, init) {
  const values = await Promise.all(TOP_LEAGUES.map(async league => ({ league, teams: await getLeagueTeams(host, league, init) })));
  return values;
}

function directLeague(m) {
  const id = Number(m?.leagueId ?? m?._league?.leagueId ?? m?._league?.id ?? m?.league?.id ?? m?.tournament?.id ?? m?.competition?.id);
  if (Number.isFinite(id)) {
    const found = TOP_LEAGUES.find(l => l.id === id);
    if (found) return found;
  }
  const n = norm(m?._league?.localizedName ?? m?._league?.leagueName ?? m?._league?.parentLeagueName ?? m?._league?.name ?? m?.league?.name ?? m?.tournament?.name ?? m?.leagueName ?? m?.parentLeagueName ?? m?.competition?.name);
  if (!n) return null;
  const aliases = [
    ["Premier League", ["premier league"]], ["Serie A", ["serie a"]], ["La Liga", ["la liga", "laliga"]],
    ["Bundesliga", ["bundesliga"]], ["Ligue 1", ["ligue 1"]], ["EFL Championship", ["championship", "efl championship"]],
    ["Belgian Pro League", ["belgian pro league", "jupiler pro league", "first division a"]],
    ["Primeira Liga", ["primeira liga", "liga portugal", "liga portugal betclic"]],
    ["Brasileirão Serie A", ["brasileirao serie a", "brasileirao"]], ["Eredivisie", ["eredivisie"]]
  ];
  for (const [name, list] of aliases) if (list.includes(n)) return TOP_LEAGUES.find(l => l.name === name) || null;
  return null;
}

function teamOf(m, side) {
  const t = m?.[side] || m?.teams?.[side] || {};
  return { id: t?.id ?? t?.teamId ?? t?.team_id ?? null, name: t?.name ?? t?.longName ?? t?.shortName ?? "", raw: t };
}

function matchesLeagueTeam(team, teams) {
  if (team.id != null && teams.ids.has(String(team.id))) return true;
  const n = norm(team.name);
  return !!n && teams.names.has(n);
}

async function classify(m, memberships) {
  const direct = directLeague(m);
  if (direct) return direct;
  const home = teamOf(m, "home"), away = teamOf(m, "away");
  for (const entry of memberships) {
    if (matchesLeagueTeam(home, entry.teams) && matchesLeagueTeam(away, entry.teams)) return entry.league;
  }
  return null;
}

function statusOf(s = {}) {
  if (s.cancelled) return { short: "CANC", long: "Cancelled", elapsed: null };
  if (s.finished) return { short: "FT", long: "Finished", elapsed: null };
  if (s.ongoing || s.started) {
    const mt = String(s?.liveTime?.short || s?.liveTime?.long || "").match(/\d+/);
    return { short: "LIVE", long: "Live", elapsed: mt ? Number(mt[0]) : null };
  }
  return { short: "NS", long: "Not Started", elapsed: null };
}

function logoForTeam(t) {
  return t?.logo || t?.image || t?.imageUrl || t?.imagePath || t?.img || (t?.id ? `https://images.fotmob.com/image_resources/logo/teamlogo/${encodeURIComponent(t.id)}.png` : null);
}

async function normalizeMatches(matches, host, init) {
  const memberships = await teamMembership(host, init);
  const out = [];
  for (const m of matches) {
    const league = await classify(m, memberships);
    if (!league) continue;
    const home = teamOf(m, "home"), away = teamOf(m, "away"), status = statusOf(m?.status || {});
    const kickoff = m?.status?.utcTime || m?.utcTime || m?.startTime || m?.date || null;
    out.push({
      fixture: { id: m?.id || m?.eventId || m?.matchId || null, date: kickoff, status },
      league: { id: league.id, name: league.name, logo: `https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${league.id}.png` },
      teams: {
        home: { id: home.id, name: home.name || "Home", logo: logoForTeam(home.raw) },
        away: { id: away.id, name: away.name || "Away", logo: logoForTeam(away.raw) }
      },
      goals: { home: m?.home?.score ?? m?.goals?.home ?? null, away: m?.away?.score ?? m?.goals?.away ?? null }
    });
  }
  return out;
}

async function fetchByDate(host, date, init) {
  const key = `date:${date}:team-membership-v1`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let data = await providerJson(host, `/football-get-matches-by-date?date=${encodeURIComponent(fmtDate(date))}`, init);
  let matches = flattenMatches(data);
  // Some provider versions accept dashed dates. Retry only if the compact-date response is empty.
  if (!matches.length) {
    data = await providerJson(host, `/football-get-matches-by-date?date=${encodeURIComponent(date)}`, init);
    matches = flattenMatches(data);
  }
  cache.set(key, { value: matches, expiresAt: Date.now() + 5 * 60 * 1000 });
  return matches;
}

async function handleMatches(url, init) {
  const host = process.env.FOOTBALL_API_HOST;
  const p = url.searchParams;
  if (!host) return previousFetch(url, init);
  if (p.get("live") === "all") {
    const data = await providerJson(host, "/football-current-live", init);
    const live = Array.isArray(data?.response?.live) ? data.response.live : Array.isArray(data?.response) ? data.response : [];
    return jsonResponse({ response: await normalizeMatches(live, host, init) });
  }
  if (p.get("date")) return jsonResponse({ response: await normalizeMatches(await fetchByDate(host, p.get("date"), init), host, init) });
  const from = p.get("dateFrom"), to = p.get("dateTo");
  if (from && to) {
    const groups = await Promise.all(datesInclusive(from, to, 8).map(d => fetchByDate(host, d, init)));
    const now = Date.now();
    const raw = groups.flat().filter(m => {
      const s = m?.status || {}, k = new Date(s?.utcTime || m?.utcTime || m?.startTime || m?.date || "").getTime();
      if (p.get("status") === "FT") return s.finished === true;
      return s.finished !== true && s.cancelled !== true && (Number.isNaN(k) || k >= now);
    });
    return jsonResponse({ response: await normalizeMatches(raw, host, init) });
  }
  return previousFetch(url, init);
}

global.fetch = async function topLeagueAwareFetch(input, init = {}) {
  let url;
  try { url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url); }
  catch { return previousFetch(input, init); }
  const host = process.env.FOOTBALL_API_HOST;
  if (!host || url.hostname !== host || url.pathname !== "/matches") return previousFetch(input, init);
  try { return await handleMatches(url, init); }
  catch (error) {
    console.error("[Football Top10]", error.message);
    return jsonResponse({ error: "Football data temporarily unavailable" }, 502);
  }
};
