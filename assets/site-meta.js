(()=>{
  "use strict";
  const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
  const norm=v=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const fmtDate=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString();};

  async function adminApi(url,options={}){
    const token=localStorage.getItem("wtv_admin_token")||"";
    options.headers=Object.assign({},options.headers||{}, {"x-admin-token":token});
    const r=await fetch(url,options),d=await r.json().catch(()=>({}));
    if(r.status===401){localStorage.removeItem("wtv_admin_token");location.reload();throw new Error("Admin session expired");}
    if(!r.ok)throw new Error(d.error||"Request failed");
    return d;
  }

  function setupAdmin(){
    const dashboard=document.getElementById("dashboard"),tabs=dashboard?.querySelector(".tabs");
    if(!dashboard||!tabs||document.getElementById("tvChannelsTab"))return;
    const tabBtn=document.createElement("button");tabBtn.className="btn tab";tabBtn.textContent="TV Match Channels";tabBtn.onclick=()=>window.showTab?.("tvChannelsTab",tabBtn);tabs.appendChild(tabBtn);
    const section=document.createElement("section");section.id="tvChannelsTab";section.className="hide";
    section.innerHTML=`
      <div class="card">
        <h2>📺 TV Match Channel Manager</h2>
        <p class="muted">Add TV channels, upload their logos, then assign one or more channels to live and upcoming football matches.</p>
        <input type="hidden" id="tvChannelEditId"><input type="hidden" id="tvChannelLogo">
        <div class="formgrid">
          <div><label>Channel name</label><input id="tvChannelName" placeholder="Example: SuperSport Premier League"><label>Country / region</label><input id="tvChannelCountry" placeholder="Example: Ghana / Africa"></div>
          <div>
            <label>Upload channel logo</label><input id="tvChannelLogoFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
            <div id="tvChannelLogoPreview" class="muted" style="min-height:48px;margin:0 0 10px">PNG, JPG, WEBP or GIF • max 4 MB</div>
            <label><input id="tvChannelActive" type="checkbox" checked style="width:auto"> Active</label>
          </div>
        </div>
        <button class="btn primary" id="tvChannelSaveBtn" onclick="tvSaveChannel()">Add Channel</button>
        <button class="btn secondary hide" id="tvChannelCancelBtn" onclick="tvCancelEdit()">Cancel Edit</button>
        <span id="tvChannelMsg" class="muted"></span>
      </div>
      <div class="card"><h2>Manage TV Channels</h2><div style="overflow:auto"><table><thead><tr><th>Logo</th><th>Channel</th><th>Region</th><th>Status</th><th>Actions</th></tr></thead><tbody id="tvChannelRows"></tbody></table></div></div>
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h2 style="margin-bottom:4px">Assign Channels to Matches</h2><p class="muted" style="margin-top:0">Matches come from your Live Football Scores and Upcoming Matches feed.</p></div><button class="btn secondary" onclick="tvRefreshMatches()">Refresh Matches</button></div><div id="tvMatchMsg" class="muted"></div><div style="overflow:auto"><table><thead><tr><th>Status</th><th>League</th><th>Match</th><th>Kickoff</th><th>TV Channels</th><th>Assign</th></tr></thead><tbody id="tvMatchRows"></tbody></table></div></div>
      <div class="card"><h2>Current Match Assignments</h2><div style="overflow:auto"><table><thead><tr><th>Match</th><th>League</th><th>Kickoff</th><th>Channel</th><th>Action</th></tr></thead><tbody id="tvAssignmentRows"></tbody></table></div></div>`;
    dashboard.appendChild(section);

    const originalShowTab=window.showTab;
    if(typeof originalShowTab==="function"&&!originalShowTab.__tvWrapped){
      const wrapped=function(id,btn){document.getElementById("tvChannelsTab")?.classList.add("hide");const r=originalShowTab.call(this,id,btn);if(id==="tvChannelsTab")window.tvLoadManager?.();return r;};
      wrapped.__tvWrapped=true;window.showTab=wrapped;
    }

    let channels=[],assignments=[],matches=[];
    const logoPreview=url=>{const p=document.getElementById("tvChannelLogoPreview");if(!p)return;p.innerHTML=url?`<img src="${esc(url)}" alt="Channel logo" style="width:90px;height:60px;object-fit:contain;border:1px solid #eee;border-radius:8px;background:#fff">`:'PNG, JPG, WEBP or GIF • max 4 MB';};
    document.getElementById("tvChannelLogoFile")?.addEventListener("change",e=>{const f=e.target.files?.[0];if(!f)return logoPreview(document.getElementById("tvChannelLogo").value);const u=URL.createObjectURL(f);logoPreview(u);setTimeout(()=>URL.revokeObjectURL(u),60000);});

    function matchKey(m){const fixture=m.id??m.fixture_id??m.fixture?.id??"";if(fixture!==""&&fixture!=null)return`fixture:${fixture}`;return`match:${norm(m.league)}|${norm(m.home_team)}|${norm(m.away_team)}|${String(m.kickoff||"").slice(0,16)}`;}
    function assignedTo(m){const key=matchKey(m);return assignments.filter(a=>a.match_key===key||(norm(a.home_team)===norm(m.home_team)&&norm(a.away_team)===norm(m.away_team)&&norm(a.league)===norm(m.league)));}
    function channelLogo(c){return c.logo_url?`<img src="${esc(c.logo_url)}" alt="" style="width:48px;height:38px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid #eee">`:'<span style="font-size:24px">📺</span>';}
    function renderChannels(){const b=document.getElementById("tvChannelRows");if(!b)return;b.innerHTML=channels.length?channels.map(c=>`<tr><td>${channelLogo(c)}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.country||"—")}</td><td>${c.active?'<span class="pill">Active</span>':'Disabled'}</td><td><button class="btn secondary" onclick="tvEditChannel(${c.id})">Edit</button> <button class="btn danger" onclick="tvDeleteChannel(${c.id})">Delete</button></td></tr>`).join(""):'<tr><td colspan="5" class="muted">No TV channels added yet.</td></tr>';}
    function renderAssignments(){const b=document.getElementById("tvAssignmentRows");if(!b)return;b.innerHTML=assignments.length?assignments.map(a=>`<tr><td><b>${esc(a.home_team)}</b> vs <b>${esc(a.away_team)}</b></td><td>${esc(a.league||"Football")}</td><td>${esc(fmtDate(a.kickoff))}</td><td>${a.channel_logo?`<img src="${esc(a.channel_logo)}" alt="" style="width:30px;height:24px;object-fit:contain;vertical-align:middle;margin-right:6px">`:"📺 "}${esc(a.channel_name)}</td><td><button class="btn danger" onclick="tvRemoveAssignment(${a.id})">Remove</button></td></tr>`).join(""):'<tr><td colspan="5" class="muted">No match-channel assignments yet.</td></tr>';}
    function renderMatches(){const b=document.getElementById("tvMatchRows");if(!b)return;const active=channels.filter(c=>c.active);if(!matches.length){b.innerHTML='<tr><td colspan="6" class="muted">No live or upcoming matches are available right now.</td></tr>';return;}b.innerHTML=matches.slice(0,80).map((m,i)=>{const current=assignedTo(m),currentHtml=current.length?current.map(a=>`<span class="pill" style="margin:2px">📺 ${esc(a.channel_name)}</span>`).join(""):'<span class="muted">Not assigned</span>',opts=active.length?active.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(""):'<option value="">Add an active channel first</option>';return`<tr><td>${m._status==='LIVE'?'<span class="live-badge">● LIVE</span>':'<span class="upcoming-badge">UPCOMING</span>'}</td><td>${esc(m.league||"Football")}</td><td><b>${esc(m.home_team)}</b><br>vs<br><b>${esc(m.away_team)}</b></td><td>${esc(fmtDate(m.kickoff))}</td><td>${currentHtml}</td><td><select id="tvMatchChannel_${i}" style="min-width:180px">${opts}</select><button class="btn primary" style="margin-left:5px" onclick="tvAssignMatch(${i})" ${active.length?"":"disabled"}>Assign</button></td></tr>`;}).join("");}
    async function loadChannels(){channels=await adminApi("/api/admin/tv-channels");renderChannels();}
    async function loadAssignments(){assignments=await adminApi("/api/admin/match-tv-channels");renderAssignments();renderMatches();}
    async function uploadSelectedLogo(){const input=document.getElementById("tvChannelLogoFile"),file=input?.files?.[0];if(!file)return document.getElementById("tvChannelLogo").value||"";const form=new FormData();form.append("logo",file);const d=await adminApi("/api/admin/tv-channels/logo-upload",{method:"POST",body:form});document.getElementById("tvChannelLogo").value=d.logo_url||"";return d.logo_url||"";}

    window.tvLoadManager=async()=>{try{await Promise.all([loadChannels(),loadAssignments()]);await window.tvRefreshMatches();}catch(e){const el=document.getElementById("tvChannelMsg");if(el)el.textContent=e.message;}};
    window.tvSaveChannel=async()=>{
      const id=document.getElementById("tvChannelEditId").value,msg=document.getElementById("tvChannelMsg");
      try{
        msg.textContent="Saving...";const logoUrl=await uploadSelectedLogo();
        const payload={name:document.getElementById("tvChannelName").value,country:document.getElementById("tvChannelCountry").value,logo_url:logoUrl,active:document.getElementById("tvChannelActive").checked?1:0};
        await adminApi(id?`/api/admin/tv-channels/${id}`:"/api/admin/tv-channels",{method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        msg.textContent=id?"Channel updated.":"Channel added.";window.tvCancelEdit();await Promise.all([loadChannels(),loadAssignments()]);
      }catch(e){msg.textContent=e.message;}
    };
    window.tvEditChannel=id=>{const c=channels.find(x=>x.id===id);if(!c)return;document.getElementById("tvChannelEditId").value=c.id;document.getElementById("tvChannelName").value=c.name||"";document.getElementById("tvChannelCountry").value=c.country||"";document.getElementById("tvChannelLogo").value=c.logo_url||"";document.getElementById("tvChannelLogoFile").value="";logoPreview(c.logo_url||"");document.getElementById("tvChannelActive").checked=!!c.active;document.getElementById("tvChannelSaveBtn").textContent="Update Channel";document.getElementById("tvChannelCancelBtn").classList.remove("hide");document.getElementById("tvChannelsTab").scrollIntoView({behavior:"smooth",block:"start"});};
    window.tvCancelEdit=()=>{["tvChannelEditId","tvChannelName","tvChannelCountry","tvChannelLogo"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});const f=document.getElementById("tvChannelLogoFile");if(f)f.value="";logoPreview("");const a=document.getElementById("tvChannelActive");if(a)a.checked=true;const s=document.getElementById("tvChannelSaveBtn");if(s)s.textContent="Add Channel";document.getElementById("tvChannelCancelBtn")?.classList.add("hide");};
    window.tvDeleteChannel=async id=>{const c=channels.find(x=>x.id===id);if(!confirm(`Delete ${c?.name||"this TV channel"}? Its match assignments will also be removed.`))return;try{await adminApi(`/api/admin/tv-channels/${id}`,{method:"DELETE"});await Promise.all([loadChannels(),loadAssignments()]);}catch(e){alert(e.message);}};
    window.tvRefreshMatches=async()=>{const msg=document.getElementById("tvMatchMsg");if(msg)msg.textContent="Loading live and upcoming matches...";try{const [liveRes,upRes]=await Promise.all([fetch("/api/football/live"),fetch("/api/football/upcoming")]),live=await liveRes.json().catch(()=>({})),up=await upRes.json().catch(()=>({}));const all=[...(live.matches||[]).map(m=>({...m,_status:"LIVE"})),...(up.matches||[]).map(m=>({...m,_status:"UPCOMING"}))],seen=new Set();matches=all.filter(m=>{const k=matchKey(m);if(seen.has(k))return false;seen.add(k);return true;});if(msg)msg.textContent=`${matches.length} live/upcoming matches loaded.`;renderMatches();}catch(e){if(msg)msg.textContent="Could not load football matches: "+e.message;matches=[];renderMatches();}};
    window.tvAssignMatch=async i=>{const m=matches[i];if(!m)return;const channelId=Number(document.getElementById(`tvMatchChannel_${i}`)?.value);if(!channelId)return alert("Select a TV channel first.");const fixture=m.id??m.fixture_id??m.fixture?.id??null,payload={match_key:matchKey(m),fixture_id:fixture,home_team:m.home_team,away_team:m.away_team,league:m.league||"Football",kickoff:m.kickoff||null,channel_id:channelId};try{await adminApi("/api/admin/match-tv-channels",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});await loadAssignments();}catch(e){alert(e.message);}};
    window.tvRemoveAssignment=async id=>{if(!confirm("Remove this TV channel from the match?"))return;try{await adminApi(`/api/admin/match-tv-channels/${id}`,{method:"DELETE"});await loadAssignments();}catch(e){alert(e.message);}};
  }

  function setupPublic(){
    const liveBox=document.getElementById("liveScoresBox"),upcomingBox=document.getElementById("upcomingBox");if(!liveBox&&!upcomingBox)return;
    const style=document.createElement("style");style.textContent=`.tv-channel-watch{margin-top:10px;padding-top:9px;border-top:1px dashed #eadfc8;font-size:12px;font-weight:700}.tv-channel-line{display:flex;align-items:center;justify-content:center;gap:6px;margin:5px 0;color:#493b18}.tv-channel-line img{width:30px;height:24px;object-fit:contain;border-radius:5px;background:#fff;border:1px solid #eee}`;document.head.appendChild(style);
    let assignments=[];
    function apply(box){
      if(!box)return;
      box.querySelectorAll(".match-card").forEach(card=>{
        const teams=[...card.querySelectorAll(".match-teams strong")].map(x=>x.textContent.trim());
        if(teams.length<2)return;
        const found=assignments.filter(a=>norm(a.home_team)===norm(teams[0])&&norm(a.away_team)===norm(teams[1]));
        const existing=card.querySelector(".tv-channel-watch");
        const signature=found.map(a=>`${a.id||""}|${a.channel_name||""}|${a.channel_logo||""}`).sort().join("||");
        if(!found.length){if(existing)existing.remove();return;}
        if(existing?.dataset.signature===signature)return;
        if(existing)existing.remove();
        const wrap=document.createElement("div");wrap.className="tv-channel-watch";wrap.dataset.signature=signature;
        const title=document.createElement("div");title.textContent="📺 Watch on";wrap.appendChild(title);
        found.forEach(a=>{const line=document.createElement("div");line.className="tv-channel-line";if(a.channel_logo){const img=document.createElement("img");img.src=a.channel_logo;img.alt="";img.onerror=()=>img.remove();line.appendChild(img);}const name=document.createElement("span");name.textContent=a.channel_name;line.appendChild(name);wrap.appendChild(line);});
        card.appendChild(wrap);
      });
    }
    function applyAll(){apply(liveBox);apply(upcomingBox);}
    async function refresh(){try{const r=await fetch("/api/match-tv-channels",{cache:"no-store"}),d=await r.json();assignments=d.assignments||[];applyAll();}catch(e){console.warn("TV channel display unavailable",e);}}
    [liveBox,upcomingBox].filter(Boolean).forEach(box=>{
      let queued=false;
      const observer=new MutationObserver(()=>{
        if(queued)return;
        queued=true;
        requestAnimationFrame(()=>{queued=false;apply(box);});
      });
      observer.observe(box,{childList:true,subtree:true});
    });
    refresh();setInterval(refresh,60000);
  }
  function init(){setupAdmin();setupPublic();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();