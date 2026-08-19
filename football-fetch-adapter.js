// Rate-limit-safe RapidAPI adapter for free-api-live-football-data.p.rapidapi.com
const nativeFetch = global.fetch;
if (typeof nativeFetch !== "function") throw new Error("Global fetch is required");

const providerCache = new Map();
let blockedUntil = 0;

const TOP_LEAGUES = [
  {canonical:"Premier League", ids:[47], names:[/^premier league$/i]},
  {canonical:"Serie A", ids:[55], names:[/^serie a$/i]},
  {canonical:"La Liga", ids:[87], names:[/^la\s*liga$/i,/^laliga$/i]},
  {canonical:"Bundesliga", ids:[54], names:[/^bundesliga$/i]},
  {canonical:"Ligue 1", ids:[53], names:[/^ligue 1$/i]},
  {canonical:"EFL Championship", ids:[48], names:[/^championship$/i,/^efl championship$/i]},
  {canonical:"Belgian Pro League", ids:[40], names:[/^belgian pro league$/i,/^jupiler pro league$/i,/^first division a$/i,/^pro league$/i]},
  {canonical:"Primeira Liga", ids:[61], names:[/^primeira liga$/i,/^liga portugal$/i,/^liga portugal betclic$/i]},
  {canonical:"Brasileirão Serie A", ids:[268], names:[/^brasileir[aã]o.*serie a$/i,/^brasileir[aã]o$/i]},
  {canonical:"Eredivisie", ids:[57], names:[/^eredivisie$/i]}
];

const clean = v => String(v || "").trim();
const norm = v => clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const jsonResponse = (body,status=200) => new Response(JSON.stringify(body), {status, headers:{"content-type":"application/json"}});
const sleep = ms => new Promise(r => setTimeout(r, ms));

function datesInclusive(from,to,maxDays=8){
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`), out=[];
  if(Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for(let d=start; d<=end && out.length<maxDays; d=new Date(d.getTime()+86400000)) out.push(d.toISOString().slice(0,10));
  return out;
}

function leagueIdOf(m){
  return m?.leagueId ?? m?._league?.leagueId ?? m?._league?.id ?? m?.league?.leagueId ?? m?.league?.id ?? m?.tournament?.id ?? m?.competition?.id ?? null;
}
function leagueNameOf(m){
  return clean(m?._league?.localizedName ?? m?._league?.leagueName ?? m?._league?.parentLeagueName ?? m?._league?.tournamentName ?? m?._league?.name ?? m?.league?.localizedName ?? m?.league?.leagueName ?? m?.league?.parentLeagueName ?? m?.league?.name ?? m?.tournament?.name ?? m?.tournament?.leagueName ?? m?.leagueName ?? m?.parentLeagueName ?? m?.competition?.name);
}
function topLeagueFor(m){
  const id = Number(leagueIdOf(m));
  if(Number.isFinite(id)){
    const byId = TOP_LEAGUES.find(l => l.ids.includes(id));
    if(byId) return byId;
  }
  const name = leagueNameOf(m);
  if(!name) return null;
  return TOP_LEAGUES.find(l => l.names.some(re => re.test(name))) || null;
}
function teamLogo(t){
  return t?.logo || t?.image || t?.imageUrl || t?.imagePath || t?.img || (t?.id ? `https://images.fotmob.com/image_resources/logo/teamlogo/${encodeURIComponent(t.id)}.png` : null);
}
function statusOf(s={}){
  if(s.cancelled) return {short:"CANC",long:"Cancelled",elapsed:null};
  if(s.finished) return {short:"FT",long:"Finished",elapsed:null};
  if(s.ongoing || s.started){
    const mt = String(s?.liveTime?.short || s?.liveTime?.long || "").match(/\d+/);
    return {short:"LIVE",long:"Live",elapsed:mt?Number(mt[0]):null};
  }
  return {short:"NS",long:"Not Started",elapsed:null};
}
function normalizeMatch(m){
  const league = topLeagueFor(m);
  if(!league) return null;
  const home = m?.home || m?.teams?.home || {}, away = m?.away || m?.teams?.away || {};
  const kickoff = m?.status?.utcTime || m?.utcTime || m?.startTime || m?.date || m?.fixture?.date || null;
  return {
    fixture:{id:m?.id || m?.eventId || m?.matchId || m?.fixture?.id || null,date:kickoff,status:statusOf(m?.status || m?.fixture?.status || {})},
    league:{id:league.id || leagueIdOf(m),name:league.canonical,logo:m?._league?.logo || m?.league?.logo || m?.tournament?.logo || (leagueIdOf(m)?`https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${encodeURIComponent(leagueIdOf(m))}.png`:null)},
    teams:{home:{id:home?.id||home?.teamId||null,name:home?.name||home?.longName||"Home",logo:teamLogo(home)},away:{id:away?.id||away?.teamId||null,name:away?.name||away?.longName||"Away",logo:teamLogo(away)}},
    goals:{home:m?.home?.score ?? m?.goals?.home ?? null,away:m?.away?.score ?? m?.goals?.away ?? null}
  };
}
function flattenProviderMatches(data){
  let raw=[];
  if(Array.isArray(data?.response?.matches)) raw=data.response.matches;
  else if(Array.isArray(data?.response?.live)) raw=data.response.live;
  else if(Array.isArray(data?.response)) raw=data.response;
  else if(Array.isArray(data?.matches)) raw=data.matches;
  const out=[];
  for(const item of raw){
    if(!item || typeof item!=="object") continue;
    if(Array.isArray(item.matches)){
      const meta=item.league&&typeof item.league==="object"?{...item,...item.league}:item;
      for(const m of item.matches) if(m&&typeof m==="object") out.push({...m,_league:meta});
    } else if(item.league && Array.isArray(item.league.matches)){
      const meta={...item,...item.league};
      for(const m of item.league.matches) if(m&&typeof m==="object") out.push({...m,_league:meta});
    } else out.push(item);
  }
  return out;
}

async function readJson(r){
  const t=await r.text();
  try{return JSON.parse(t)}catch{throw new Error(`Football provider returned invalid JSON (${r.status})`)}
}
async function fetchProvider(path,init,cacheKey,ttlMs){
  const host=process.env.FOOTBALL_API_HOST;
  const cached=providerCache.get(cacheKey);
  if(cached && Date.now()-cached.time<ttlMs) return cached.data;
  if(Date.now()<blockedUntil){
    if(cached?.data) return cached.data;
    const err=new Error("Football provider rate limited; retry later"); err.status=429; throw err;
  }
  const r=await nativeFetch(`https://${host}${path}`,init);
  if(r.status===429){
    const retry=Number(r.headers.get("retry-after")||0);
    blockedUntil=Date.now()+(retry>0?retry*1000:10*60*1000);
    console.warn(`[Football adapter] provider rate limited (429); pausing requests until ${new Date(blockedUntil).toISOString()}`);
    if(cached?.data) return cached.data;
    const err=new Error("Football provider rate limited; retry later"); err.status=429; throw err;
  }
  if(!r.ok) throw new Error(`Football provider API error ${r.status}`);
  const data=await readJson(r);
  providerCache.set(cacheKey,{time:Date.now(),data});
  return data;
}

async function fetchMatchesByDate(date,init){
  const key=`date:${date}:v6`;
  const data=await fetchProvider(`/football-get-matches-by-date?date=${encodeURIComponent(date.replace(/-/g,""))}`,init,key,6*60*60*1000);
  return flattenProviderMatches(data);
}
function normalizeMany(matches){ return matches.map(normalizeMatch).filter(Boolean); }

async function handleMatches(u,init){
  const p=u.searchParams;
  if(p.get("live")==="all"){
    const data=await fetchProvider("/football-current-live",init,"live:v6",60*1000);
    return jsonResponse({response:normalizeMany(flattenProviderMatches(data))});
  }
  if(p.get("date")){
    const matches=await fetchMatchesByDate(p.get("date"),init);
    return jsonResponse({response:normalizeMany(matches)});
  }
  const from=p.get("dateFrom"),to=p.get("dateTo");
  if(from&&to){
    const raw=[];
    for(const d of datesInclusive(from,to,8)){
      try{
        const day=await fetchMatchesByDate(d,init);
        raw.push(...day);
      }catch(e){
        if(e.status===429) break;
        throw e;
      }
      if(Date.now()>=blockedUntil) await sleep(900);
    }
    const now=Date.now(),finished=p.get("status")==="FT";
    const filtered=raw.filter(m=>{
      const s=m?.status||{}, k=new Date(s?.utcTime||m?.utcTime||m?.startTime||m?.date||m?.fixture?.date||"").getTime();
      if(finished) return s.finished===true || m?.fixture?.status?.short==="FT";
      return s.finished!==true && s.cancelled!==true && (Number.isNaN(k)||k>=now);
    });
    return jsonResponse({response:normalizeMany(filtered)});
  }
  return nativeFetch(u,init);
}

global.fetch=async function footballAwareFetch(input,init={}){
  let u; try{u=input instanceof URL?input:new URL(typeof input==="string"?input:input.url)}catch{return nativeFetch(input,init)}
  const host=process.env.FOOTBALL_API_HOST;
  if(!host || u.hostname!==host || u.pathname!=="/matches") return nativeFetch(input,init);
  try{return await handleMatches(u,init)}catch(e){
    console.error("[Football adapter]",e.message);
    return jsonResponse({error:e.status===429?"Football provider rate limited. Please retry shortly.":"Football data temporarily unavailable"},e.status===429?429:502);
  }
};
