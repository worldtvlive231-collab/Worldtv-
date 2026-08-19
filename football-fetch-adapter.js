// RapidAPI adapter for free-api-live-football-data.p.rapidapi.com
const nativeFetch=global.fetch;
const providerCache=new Map();
const leagueMetaCache=new Map();
if(typeof nativeFetch!=="function") throw new Error("Global fetch is required");

// This provider mirrors FotMob league/team IDs. Prefer the stable league ID first,
// then fall back to league-name/country matching for resilience if the provider
// changes the surrounding response metadata.
const TOP_LEAGUES=[
 {canonical:"Premier League",ids:[47],countries:["ENG","GB","EN"],names:[/^premier league$/i]},
 {canonical:"Serie A",ids:[55],countries:["ITA","IT"],names:[/^serie a$/i]},
 {canonical:"La Liga",ids:[87],countries:["ESP","ES"],names:[/^la\s*liga$/i,/^laliga$/i]},
 {canonical:"Bundesliga",ids:[54],countries:["GER","DEU","DE"],names:[/^bundesliga$/i]},
 {canonical:"Ligue 1",ids:[53],countries:["FRA","FR"],names:[/^ligue 1$/i]},
 {canonical:"EFL Championship",ids:[48],countries:["ENG","GB","EN"],names:[/^championship$/i,/^efl championship$/i]},
 {canonical:"Belgian Pro League",ids:[40],countries:["BEL","BE"],names:[/^belgian pro league$/i,/^jupiler pro league$/i,/^pro league$/i,/^first division a$/i]},
 {canonical:"Primeira Liga",ids:[61],countries:["POR","PT"],names:[/^primeira liga$/i,/^liga portugal$/i,/^liga portugal betclic$/i]},
 {canonical:"Brasileirão Serie A",ids:[268],countries:["BRA","BR"],names:[/^brasileir[aã]o.*serie a$/i,/^brasileir[aã]o$/i,/^serie a$/i]},
 {canonical:"Eredivisie",ids:[57],countries:["NED","NLD","NL"],names:[/^eredivisie$/i]}
];

const clean=v=>String(v||"").trim();
const code=v=>clean(v).toUpperCase();
const fmtDate=v=>String(v||"").replace(/-/g,"");
const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

function datesInclusive(from,to,maxDays=8){
 const start=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`),out=[];
 if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<start)return out;
 for(let d=start;d<=end&&out.length<maxDays;d=new Date(d.getTime()+86400000)) out.push(d.toISOString().slice(0,10));
 return out;
}
function leagueIdOf(m){return m?.leagueId||m?._league?.leagueId||m?._league?.id||m?.league?.leagueId||m?.league?.id||m?.tournament?.id||m?.competition?.id||null;}
function teamLogo(t){
 const explicit=t?.logo||t?.image||t?.imageUrl||t?.imagePath||t?.img;
 return explicit||(t?.id?`https://images.fotmob.com/image_resources/logo/teamlogo/${encodeURIComponent(t.id)}.png`:null);
}
function rawLeagueName(m){return clean(m?._resolvedLeague?.name||m?._league?.localizedName||m?._league?.leagueName||m?._league?.parentLeagueName||m?._league?.tournamentName||m?._league?.name||m?.league?.localizedName||m?.league?.leagueName||m?.league?.parentLeagueName||m?.league?.name||m?.tournament?.name||m?.tournament?.leagueName||m?.leagueName||m?.parentLeagueName||m?.competition?.name);}
function rawCountryCode(m){return code(m?._resolvedLeague?.ccode||m?._league?.ccode||m?._league?.countryCode||m?._league?.country?.code||m?._league?.country||m?.tournament?.ccode||m?.tournament?.countryCode||m?.league?.ccode||m?.league?.countryCode||m?.league?.country?.code||m?.countryCode||m?.country?.code);}
function topLeagueFor(m){
 const lid=Number(leagueIdOf(m));
 if(Number.isFinite(lid)){
  const byId=TOP_LEAGUES.find(l=>l.ids.includes(lid));
  if(byId)return byId;
 }
 const name=rawLeagueName(m),country=rawCountryCode(m);
 if(!name)return null;
 for(const l of TOP_LEAGUES){
  if(!l.names.some(re=>re.test(name)))continue;
  if(country&&l.countries.length&&!l.countries.includes(country))continue;
  if(!country&&/^(serie a|premier league|championship|pro league)$/i.test(name))continue;
  return l;
 }
 return null;
}
function leagueLogo(m){
 const explicit=m?._resolvedLeague?.logo||m?._league?.logo||m?._league?.image||m?.league?.logo||m?.tournament?.logo||m?.tournament?.image||m?.competition?.logo;
 const id=leagueIdOf(m);
 return explicit||(id?`https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${encodeURIComponent(id)}.png`:null);
}
function parseMinute(s){const x=String(s?.liveTime?.short||s?.liveTime?.long||"").match(/\d+/);return x?Number(x[0]):null;}
function normalizedStatus(s){
 if(s?.cancelled)return{short:"CANC",long:"Cancelled",elapsed:null};
 if(s?.finished)return{short:"FT",long:"Finished",elapsed:null};
 if(s?.ongoing||s?.started)return{short:"LIVE",long:"Live",elapsed:parseMinute(s)};
 return{short:"NS",long:"Not Started",elapsed:null};
}
function normalizeMatch(m){
 const preferred=topLeagueFor(m); if(!preferred)return null;
 const st=normalizedStatus(m?.status||{}),kickoff=m?.status?.utcTime||m?.utcTime||m?.startTime||m?.date||null;
 return{fixture:{id:m?.id||m?.eventId||m?.matchId||null,date:kickoff,status:st},league:{id:leagueIdOf(m),name:preferred.canonical,logo:leagueLogo(m)},teams:{home:{id:m?.home?.id||null,name:m?.home?.name||m?.home?.longName||"Home",logo:teamLogo(m?.home)},away:{id:m?.away?.id||null,name:m?.away?.name||m?.away?.longName||"Away",logo:teamLogo(m?.away)}},goals:{home:m?.home?.score??null,away:m?.away?.score??null}};
}
function flattenProviderMatches(data){
 const raw=Array.isArray(data?.response?.matches)?data.response.matches:[],out=[];
 for(const item of raw){
  if(!item||typeof item!=="object")continue;
  if(Array.isArray(item.matches)){
   const meta=item.league&&typeof item.league==="object"?{...item,...item.league}:item;
   for(const m of item.matches)if(m&&typeof m==="object")out.push({...m,_league:meta});
  }else if(item.league&&Array.isArray(item.league.matches)){
   const meta={...item,...item.league};
   for(const m of item.league.matches)if(m&&typeof m==="object")out.push({...m,_league:meta});
  }else out.push(item);
 }
 return out;
}
async function readJson(r){const t=await r.text();try{return JSON.parse(t)}catch{throw new Error(`Football provider returned invalid JSON (${r.status})`)}}
async function fetchProvider(url,init){const r=await nativeFetch(url,init);return{response:r,data:r.ok?await readJson(r):null};}
function detailLeagueMeta(data,leagueId){
 const root=data?.response||data,det=root?.detail||root?.general||root?.matchFacts||root;
 const league=det?.league||det?.tournament||root?.league||root?.tournament||{};
 const name=clean(det?.leagueName||det?.parentLeagueName||league?.localizedName||league?.leagueName||league?.name||det?.name),ccode=code(det?.countryCode||det?.ccode||league?.ccode||league?.countryCode||league?.country?.code||det?.country);
 if(!name||/^League\s+\d+$/i.test(name))return null;
 return{id:leagueId,name,ccode,logo:leagueId?`https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${encodeURIComponent(leagueId)}.png`:null};
}
async function resolveLeagueMeta(host,m,init){
 const lid=leagueIdOf(m),eventId=m?.id||m?.eventId||m?.matchId;
 if(!lid||!eventId)return null;
 const key=String(lid),cached=leagueMetaCache.get(key);
 if(cached&&cached.expiresAt>Date.now())return cached.value;
 try{
  const {response,data}=await fetchProvider(`https://${host}/football-get-match-detail?eventid=${encodeURIComponent(eventId)}`,init);
  if(!response.ok)throw new Error(String(response.status));
  const value=detailLeagueMeta(data,lid);
  leagueMetaCache.set(key,{value,expiresAt:Date.now()+(value?86400000:3600000)});
  return value;
 }catch{
  leagueMetaCache.set(key,{value:null,expiresAt:Date.now()+900000}); return null;
 }
}
async function enrichLeagueMetadata(matches,host,init,maxLookups=60){
 const groups=new Map();
 for(const m of matches){
  if(topLeagueFor(m))continue;
  const lid=leagueIdOf(m);if(!lid)continue;
  const k=String(lid),g=groups.get(k)||{matches:[]};g.matches.push(m);groups.set(k,g);
 }
 const candidates=[...groups.values()].sort((a,b)=>b.matches.length-a.matches.length).slice(0,maxLookups);
 for(let i=0;i<candidates.length;i+=6){
  await Promise.all(candidates.slice(i,i+6).map(async g=>{const meta=await resolveLeagueMeta(host,g.matches[0],init);if(meta)for(const m of g.matches)m._resolvedLeague=meta;}));
 }
 for(const m of matches){
  if(topLeagueFor(m))continue;
  const lid=leagueIdOf(m),cached=lid?leagueMetaCache.get(String(lid)):null;
  if(cached?.value)m._resolvedLeague=cached.value;
 }
 return matches;
}
async function normalizeMany(matches,host,init){await enrichLeagueMetadata(matches,host,init);return matches.map(normalizeMatch).filter(Boolean);}
async function fetchMatchesByDate(host,date,init){
 const today=new Date().toISOString().slice(0,10),ttl=date===today?600000:21600000,key=`date:${date}:top10-v5`,cached=providerCache.get(key);
 if(cached&&Date.now()-cached.time<ttl)return cached.matches;
 const {response,data}=await fetchProvider(`https://${host}/football-get-matches-by-date?date=${encodeURIComponent(fmtDate(date))}`,init);
 if(!response.ok)throw new Error(`Football provider API error ${response.status}`);
 const matches=flattenProviderMatches(data);providerCache.set(key,{time:Date.now(),matches});return matches;
}
async function translateMatchesRequest(u,init){
 const host=process.env.FOOTBALL_API_HOST,p=u.searchParams;
 if(p.get("live")==="all"){
  const {response,data}=await fetchProvider(`https://${host}/football-current-live`,init);if(!response.ok)return response;
  const live=Array.isArray(data?.response?.live)?data.response.live:[];
  return jsonResponse({response:await normalizeMany(live,host,init)});
 }
 if(p.get("date")){
  try{return jsonResponse({response:await normalizeMany(await fetchMatchesByDate(host,p.get("date"),init),host,init)})}catch(e){return jsonResponse({error:e.message},502)}
 }
 const from=p.get("dateFrom"),to=p.get("dateTo");
 if(from&&to){
  try{
   const groups=[];for(const d of datesInclusive(from,to,8))groups.push(await fetchMatchesByDate(host,d,init));
   let matches=groups.flat(),finished=p.get("status")==="FT",now=Date.now();
   matches=finished?matches.filter(m=>m?.status?.finished===true):matches.filter(m=>{const k=new Date(m?.status?.utcTime||m?.utcTime||"").getTime();return Number.isNaN(k)?m?.status?.started!==true&&m?.status?.finished!==true:k>=now&&m?.status?.finished!==true&&m?.status?.cancelled!==true;});
   return jsonResponse({response:await normalizeMany(matches,host,init)});
  }catch(e){return jsonResponse({error:e.message},502)}
 }
 return nativeFetch(u,init);
}
global.fetch=async function footballAwareFetch(input,init={}){
 let u;try{u=input instanceof URL?input:new URL(typeof input==="string"?input:input.url)}catch{return nativeFetch(input,init)}
 const host=process.env.FOOTBALL_API_HOST;
 if(!host||u.hostname!==host||u.pathname!=="/matches")return nativeFetch(input,init);
 try{return await translateMatchesRequest(u,init)}catch(e){console.error("[Football adapter]",e.message);return jsonResponse({error:"Football data temporarily unavailable"},502)}
};
