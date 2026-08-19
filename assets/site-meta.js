(()=>{
  "use strict";

  const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
  const norm=v=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const fmtDate=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString();};

  async function adminApi(url,options={}){
    const token=localStorage.getItem("wtv_admin_token")||"";
    options.headers=Object.assign({},options.headers||{}, {"x-admin-token":token});
    const r=await fetch(url,options);
    const d=await r.json().catch(()=>({}));
    if(r.status===401){localStorage.removeItem("wtv_admin_token");location.reload();throw new Error("Admin session expired");}
    if(!r.ok)throw new Error(d.error||"Request failed");
    return d;
  }

  function setupAdmin(){
    const dashboard=document.getElementById("dashboard");
    const tabs=dashboard?.querySelector(".tabs");
    if(!dashboard||!tabs||document.getElementById("tvChannelsTab"))return;

    const tabBtn=document.createElement("button");
    tabBtn.className="btn tab";
    tabBtn.textContent="TV Match Channels";
    tabBtn.onclick=()=>window.showTab?.("tvChannelsTab",tabBtn);
    tabs.appendChild(tabBtn);

    const section=document.createElement("section");
    section.id="tvChannelsTab";
    section.className="hide";
    section.innerHTML=`
      <div class="card">
        <h2>📺 TV Match Channel Manager</h2>
        <p class="muted">Add TV channels, then assign one or more channels to live and upcoming football matches. The assigned channel will appear on the public match card.</p>
        <input type="hidden" id="tvChannelEditId">
        <div class="formgrid">
          <div>
            <label>Channel name</label><input id="tvChannelName" placeholder="Example: SuperSport Premier League">
            <label>Country / region</label><input id="tvChannelCountry" placeholder="Example: Ghana / Africa">
          </div>
          <div>
            <label>Channel logo URL</label><input id="tvChannelLogo" placeholder="https://...logo.png">
            <label><input id="tvChannelActive" type="checkbox" checked style="width:auto"> Active</label>
          </div>
        </div>
        <button class="btn primary" id="tvChannelSaveBtn" onclick="tvSaveChannel()">Add Channel</button>
        <button class="btn secondary hide" id="tvChannelCancelBtn" onclick="tvCancelEdit()">Cancel Edit</button>
        <span id="tvChannelMsg" class="muted"></span>
      </div>

      <div class="card">
        <h2>Manage TV Channels</h2>
        <div style="overflow:auto"><table><thead><tr><th>Logo</th><th>Channel</th><th>Region</th><th>Status</th><th>Actions</th></tr></thead><tbody id="tvChannelRows"></tbody></table></div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div><h2 style="margin-bottom:4px">Assign Channels to Matches</h2><p class="muted" style="margin-top:0">Matches come from your current Live Football Scores and Upcoming Matches feed.</p></div>
          <button class="btn secondary" onclick="tvRefreshMatches()">Refresh Matches</button>
        </div>
        <div id="tvMatchMsg" class="muted"></div>
        <div style="overflow:auto"><table><thead><tr><th>Status</th><th>League</th><th>Match</th><th>Kickoff</th><th>TV Channels</th><th>Assign</th></tr></thead><tbody id="tvMatchRows"></tbody></table></div>
      </div>

      <div class="card">
        <h2>Current Match Assignments</h2>
        <div style="overflow:auto"><table><thead><tr><th>Match</th><th>League</th><th>Kickoff</th><th>Channel</th><th>Action</th></tr></thead><tbody id="tvAssignmentRows"></tbody></table></div>
      </div>`;
    dashboard.appendChild(section);

    const originalShowTab=window.showTab;
    if(typeof originalShowTab==="function"&&!originalShowTab.__tvWrapped){
      const wrapped=function(id,btn){
        const tv=document.getElementById("tvChannelsTab");
        if(tv)tv.classList.add("hide");
        const result=originalShowTab.call(this,id,btn);
        if(id==="tvChannelsTab")window.tvLoadManager?.();
        return result;
      };
      wrapped.__tvWrapped=true;
      window.showTab=wrapped;
    }

    let channels=[];
    let assignments=[];
    let matches=[];

    function matchKey(m){
      const fixture=m.id??m.fixture_id??m.fixture?.id??"";
      if(fixture!==""&&fixture!=null)return`fixture:${fixture}`;
      return`match:${norm(m.league)}|${norm(m.home_team)}|${norm(m.away_team)}|${String(m.kickoff||"").slice(0,16)}`;
    }
    function assignedTo(m){
      const key=matchKey(m);
      return assignments.filter(a=>a.match_key===key || (norm(a.home_team)===norm(m.home_team)&&norm(a.away_team)===norm(m.away_team)&&norm(a.league)===norm(m.league)));
    }
    function channelLogo(c){
      return c.logo_url?`<img src="${esc(c.logo_url)}" alt="" style="width:42px;height:32px;object-fit:contain;border-radius:6px;background:#f5f5f5">`:'<span style="font-size:24px">📺</span>';
    }
    function renderChannels(){
      const body=document.getElementById("tvChannelRows");if(!body)return;
      body.innerHTML=channels.length?channels.map(c=>`<tr>
        <td>${channelLogo(c)}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.country||"—")}</td><td>${c.active?'<span class="pill">Active</span>':'Disabled'}</td>
        <td><button class="btn secondary" onclick="tvEditChannel(${c.id})">Edit</button> <button class="btn danger" onclick="tvDeleteChannel(${c.id})">Delete</button></td>
      </tr>`).join(""):'<tr><td colspan="5" class="muted">No TV channels added yet.</td></tr>';
    }
    function renderAssignments(){
      const body=document.getElementById("tvAssignmentRows");if(!body)return;
      body.innerHTML=assignments.length?assignments.map(a=>`<tr>
        <td><b>${esc(a.home_team)}</b> vs <b>${esc(a.away_team)}</b></td><td>${esc(a.league||"Football")}</td><td>${esc(fmtDate(a.kickoff))}</td>
        <td>${a.channel_logo?`<img src="${esc(a.channel_logo)}" alt="" style="width:28px;height:22px;object-fit:contain;vertical-align:middle;margin-right:6px">`:"📺 "}${esc(a.channel_name)}</td>
        <td><button class="btn danger" onclick="tvRemoveAssignment(${a.id})">Remove</button></td>
      </tr>`).join(""):'<tr><td colspan="5" class="muted">No match-channel assignments yet.</td></tr>';
    }
    function renderMatches(){
      const body=document.getElementById("tvMatchRows");if(!body)return;
      const active=channels.filter(c=>c.active);
      if(!matches.length){body.innerHTML='<tr><td colspan="6" class="muted">No live or upcoming matches are available right now.</td></tr>';return;}
      body.innerHTML=matches.slice(0,80).map((m,i)=>{
        const current=assignedTo(m);
        const currentHtml=current.length?current.map(a=>`<span class="pill" style="margin:2px">📺 ${esc(a.channel_name)}</span>`).join(""):'<span class="muted">Not assigned</span>';
        const opts=active.length?active.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(""):'<option value="">Add an active channel first</option>';
        return`<tr><td>${m._status==='LIVE'?'<span class="live-badge">● LIVE</span>':'<span class="upcoming-badge">UPCOMING</span>'}</td><td>${esc(m.league||"Football")}</td><td><b>${esc(m.home_team)}</b><br>vs<br><b>${esc(m.away_team)}</b></td><td>${esc(fmtDate(m.kickoff))}</td><td>${currentHtml}</td><td><select id="tvMatchChannel_${i}" style="min-width:180px">${opts}</select><button class="btn primary" style="margin-left:5px" onclick="tvAssignMatch(${i})" ${active.length?"":"disabled"}>Assign</button></td></tr>`;
      }).join("");
    }
    async function loadChannels(){channels=await adminApi("/api/admin/tv-channels");renderChannels();}
    async function loadAssignments(){assignments=await adminApi("/api/admin/match-tv-channels");renderAssignments();renderMatches();}

    window.tvLoadManager=async()=>{
      try{await Promise.all([loadChannels(),loadAssignments()]);await window.tvRefreshMatches();}
      catch(e){const el=document.getElementById("tvChannelMsg");if(el)el.textContent=e.message;}
    };
    window.tvSaveChannel=async()=>{
      const id=document.getElementById("tvChannelEditId").value;
      const payload={name:document.getElementById("tvChannelName").value,country:document.getElementById("tvChannelCountry").value,logo_url:document.getElementById("tvChannelLogo").value,active:document.getElementById("tvChannelActive").checked?1:0};
      try{
        await adminApi(id?`/api/admin/tv-channels/${id}`:"/api/admin/tv-channels",{method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        document.getElementById("tvChannelMsg").textContent=id?"Channel updated.":"Channel added.";
        window.tvCancelEdit();await loadChannels();await loadAssignments();
      }catch(e){document.getElementById("tvChannelMsg").textContent=e.message;}
    };
    window.tvEditChannel=id=>{
      const c=channels.find(x=>x.id===id);if(!c)return;
      document.getElementById("tvChannelEditId").value=c.id;
      document.getElementById("tvChannelName").value=c.name||"";
      document.getElementById("tvChannelCountry").value=c.country||"";
      document.getElementById("tvChannelLogo").value=c.logo_url||"";
      document.getElementById("tvChannelActive").checked=!!c.active;
      document.getElementById("tvChannelSaveBtn").textContent="Update Channel";
      document.getElementById("tvChannelCancelBtn").classList.remove("hide");
      document.getElementById("tvChannelsTab").scrollIntoView({behavior:"smooth",block:"start"});
    };
    window.tvCancelEdit=()=>{
      const ids=["tvChannelEditId","tvChannelName","tvChannelCountry","tvChannelLogo"];ids.forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
      const a=document.getElementById("tvChannelActive");if(a)a.checked=true;
      const s=document.getElementById("tvChannelSaveBtn");if(s)s.textContent="Add Channel";
      document.getElementById("tvChannelCancelBtn")?.classList.add("hide");
    };
    window.tvDeleteChannel=async id=>{
      const c=channels.find(x=>x.id===id);if(!confirm(`Delete ${c?.name||"this TV channel"}? Its match assignments will also be removed.`))return;
      try{await adminApi(`/api/admin/tv-channels/${id}`,{method:"DELETE"});await Promise.all([loadChannels(),loadAssignments()]);}catch(e){alert(e.message);}
    };
    window.tvRefreshMatches=async()=>{
      const msg=document.getElementById("tvMatchMsg");if(msg)msg.textContent="Loading live and upcoming matches...";
      try{
        const [liveRes,upRes]=await Promise.all([fetch("/api/football/live"),fetch("/api/football/upcoming")]);
        const live=await liveRes.json().catch(()=>({})),up=await upRes.json().catch(()=>({}));
        const all=[...(live.matches||[]).map(m=>({...m,_status:"LIVE"})),...(up.matches||[]).map(m=>({...m,_status:"UPCOMING"}))];
        const seen=new Set();matches=all.filter(m=>{const k=matchKey(m);if(seen.has(k))return false;seen.add(k);return true;});
        if(msg)msg.textContent=`${matches.length} live/upcoming matches loaded.`;renderMatches();
      }catch(e){if(msg)msg.textContent="Could not load football matches: "+e.message;matches=[];renderMatches();}
    };
    window.tvAssignMatch=async i=>{
      const m=matches[i];if(!m)return;
      const channelId=Number(document.getElementById(`tvMatchChannel_${i}`)?.value);if(!channelId)return alert("Select a TV channel first.");
      const fixture=m.id??m.fixture_id??m.fixture?.id??null;
      const payload={match_key:matchKey(m),fixture_id:fixture,home_team:m.home_team,away_team:m.away_team,league:m.league||"Football",kickoff:m.kickoff||null,channel_id:channelId};
      try{await adminApi("/api/admin/match-tv-channels",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});await loadAssignments();}
      catch(e){alert(e.message);}
    };
    window.tvRemoveAssignment=async id=>{if(!confirm("Remove this TV channel from the match?"))return;try{await adminApi(`/api/admin/match-tv-channels/${id}`,{method:"DELETE"});await loadAssignments();}catch(e){alert(e.message);}};
  }

  function setupPublic(){
    const liveBox=document.getElementById("liveScoresBox"),upcomingBox=document.getElementById("upcomingBox");
    if(!liveBox&&!upcomingBox)return;

    const style=document.createElement("style");
    style.textContent=`.tv-channel-watch{margin-top:10px;padding-top:9px;border-top:1px dashed #eadfc8;font-size:12px;font-weight:700}.tv-channel-line{display:flex;align-items:center;justify-content:center;gap:6px;margin:5px 0;color:#493b18}.tv-channel-line img{width:30px;height:24px;object-fit:contain;border-radius:5px;background:#fff;border:1px solid #eee}`;
    document.head.appendChild(style);
    let assignments=[];

    function apply(box){
      if(!box)return;
      box.querySelectorAll(".match-card").forEach(card=>{
        card.querySelector(".tv-channel-watch")?.remove();
        const teams=[...card.querySelectorAll(".match-teams strong")].map(x=>x.textContent.trim());
        if(teams.length<2)return;
        const found=assignments.filter(a=>norm(a.home_team)===norm(teams[0])&&norm(a.away_team)===norm(teams[1]));
        if(!found.length)return;
        const wrap=document.createElement("div");wrap.className="tv-channel-watch";
        const title=document.createElement("div");title.textContent="📺 Watch on";wrap.appendChild(title);
        found.forEach(a=>{
          const line=document.createElement("div");line.className="tv-channel-line";
          if(a.channel_logo){const img=document.createElement("img");img.src=a.channel_logo;img.alt="";img.onerror=()=>img.remove();line.appendChild(img);}
          const name=document.createElement("span");name.textContent=a.channel_name;line.appendChild(name);
          wrap.appendChild(line);
        });
        card.appendChild(wrap);
      });
    }
    function applyAll(){apply(liveBox);apply(upcomingBox);}
    async function refresh(){
      try{const r=await fetch("/api/match-tv-channels",{cache:"no-store"});const d=await r.json();assignments=d.assignments||[];applyAll();}catch(e){console.warn("TV channel display unavailable",e);}
    }
    [liveBox,upcomingBox].filter(Boolean).forEach(box=>new MutationObserver(()=>apply(box)).observe(box,{childList:true,subtree:true}));
    refresh();setInterval(refresh,30000);
  }

  function init(){setupAdmin();setupPublic();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
