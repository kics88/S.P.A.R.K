import { store, toolBlocked } from './store.js';
import { $, esc, fmtTime, renderOverlayBar } from './utils.js';

const { invoke } = window.__TAURI__.core;
const dialog = window.__TAURI__.dialog;

// Each timer: {id, name, duration, mode:'down'|'up', font, color,
//   startSound, endSound, endMessage, rewardId, anyRedeem, autoResume,
//   _remaining, _running, _interval, wasRunning}

let timers = [];
let savedTimers = [];

let saveTimer_t = null;
function persist(){
  clearTimeout(saveTimer_t);
  saveTimer_t = setTimeout(()=>{
    const active = timers.map(t=>({
      id:t.id, name:t.name, duration:t.duration, mode:t.mode,
      font:t.font, color:t.color,
      startSound:t.startSound, endSound:t.endSound,
      endMessage:t.endMessage, rewardId:t.rewardId, anyRedeem:t.anyRedeem,
      autoResume:t.autoResume||false,
      remaining:t._remaining, wasRunning:t._running,
    }));
    invoke('save_timers',{ data:{ saved:savedTimers, active }});
  },300);
  pushOverlay();
}
function pushOverlay(){
  // `at` lets the overlay tick locally between pushes — SPARK only sends
  // state changes (start/pause/reset/finish), not one push per second.
  const now = Date.now();
  const active = timers.map(t=>({
    id:t.id, name:t.name, remaining:t._remaining, duration:t.duration,
    mode:t.mode, font:t.font, color:t.color, running:t._running,
    endMessage:t.endMessage, at: now,
  }));
  invoke('timers_overlay_update',{ timers: active });
}

function uid(){ return Math.random().toString(36).slice(2,10); }

function startTimer(t){
  if(t._running) return;
  if(t.startSound){
    try{
      const a=new Audio(window.__TAURI__.core.convertFileSrc(t.startSound));
      a.onerror=()=>{}; a.play().catch(()=>{});
    }catch(e){}
  }
  t._running=true;
  t._interval=setInterval(()=>{
    if(t.mode==='down'){
      t._remaining=Math.max(0,t._remaining-1);
      if(t._remaining===0){ finishTimer(t); return; }
    } else {
      t._remaining++;
    }
    // App UI only — the overlay ticks locally and gets pushes on state changes
    renderTimerCard(t);
  },1000);
  renderTimerCard(t);
  persist();
}

function pauseTimer(t){
  if(!t._running) return;
  t._running=false; clearInterval(t._interval); renderTimerCard(t);
  persist();
}

function resetTimer(t){
  pauseTimer(t);
  t._remaining = t.mode==='down' ? t.duration : 0;
  renderTimerCard(t); pushOverlay();
  persist();
}

function finishTimer(t){
  t._running=false; clearInterval(t._interval);
  if(t.endSound){
    try{
      const a=new Audio(window.__TAURI__.core.convertFileSrc(t.endSound));
      a.onerror=()=>{}; a.play().catch(()=>{});
    }catch(e){}
  }
  pushOverlay();
  renderTimerCard(t);
  persist();
}

// ── Build left column ──────────────────────────────────────────────────────────
function buildLeft(){
  const el=$('timersLeft'); if(!el) return;
  el.innerHTML=`
  <div class="card">
    <h2>New Timer</h2>
    <label>Name</label>
    <input type="text" id="tmName" placeholder="e.g. Break Timer">
    <label class="mt">Duration</label>
    <input type="text" id="tmDuration" placeholder="e.g. 5:00 or 1:30:00 or 1:12:00:00">
    <div class="hint">Format: mm:ss &nbsp;|&nbsp; h:mm:ss &nbsp;|&nbsp; d:h:mm:ss</div>
    <label class="mt">Mode</label>
    <select id="tmMode"><option value="down">Count down</option><option value="up">Count up (stopwatch)</option></select>
    <label class="mt">Google Font</label>
    <input type="text" id="tmFont" placeholder="Roboto Mono" value="Roboto Mono">
    <label class="mt">Text colour</label>
    <input type="color" id="tmColor" value="#ffc83d" style="width:60px;height:32px;border:none;background:none;cursor:pointer">
    <label class="mt">Start sound (optional)</label>
    <div class="row"><input type="text" id="tmStartSoundPath" placeholder="No file" readonly style="flex:1"><button class="btn-sm" id="tmPickStart">…</button><button class="btn-sm btn-ghost" id="tmClearStart">✕</button></div>
    <label class="mt">End sound (optional)</label>
    <div class="row"><input type="text" id="tmEndSoundPath" placeholder="No file" readonly style="flex:1"><button class="btn-sm" id="tmPickEnd">…</button><button class="btn-sm btn-ghost" id="tmClearEnd">✕</button></div>
    <label class="mt">End message (optional overlay text)</label>
    <input type="text" id="tmEndMsg" placeholder="Time's up!">
    <label class="mt">Trigger via channel point reward (optional)</label>
    <div class="row"><select id="tmRewardSelect" style="flex:1"></select><button class="btn-sm" id="tmRefreshRewards">⟳</button></div>
    <label class="checkrow"><input type="checkbox" id="tmAnyRedeem"> Any redeem starts this timer</label>
    <label class="checkrow mt"><input type="checkbox" id="tmAutoResume"> Auto-resume when SPARK opens</label>
    <div class="hint">Saves timer position between sessions and restarts automatically on open.</div>
    <label class="hint">Or use chat command: <code>!timer &lt;name&gt;</code></label>
    <div class="row mt">
      <button class="btn-sm btn-gold full" id="tmAddBtn">＋ Add Timer</button>
      <button class="btn-sm full" id="tmSavePreset">Save as Preset</button>
    </div>
  </div>
  <div class="card">
    <h2>Saved Presets</h2>
    <div id="tmPresetList"></div>
  </div>
  <div class="card" style="margin-bottom:60px">
    <h2>Active Timers</h2>
    <div id="tmActiveList"></div>
  </div>`;
  wireTimerEvents();
  renderPresets();
  loadFontForInput();
}

let tmStartSoundFile=null, tmEndSoundFile=null;

function wireTimerEvents(){
  $('tmPickStart').addEventListener('click',async()=>{
    const f=await dialog.open({multiple:false,filters:[{name:'Audio',extensions:['mp3','wav','ogg','m4a']}]});
    if(f){ tmStartSoundFile=f; $('tmStartSoundPath').value=f; }
  });
  $('tmClearStart').addEventListener('click',()=>{ tmStartSoundFile=null; $('tmStartSoundPath').value=''; });
  $('tmPickEnd').addEventListener('click',async()=>{
    const f=await dialog.open({multiple:false,filters:[{name:'Audio',extensions:['mp3','wav','ogg','m4a']}]});
    if(f){ tmEndSoundFile=f; $('tmEndSoundPath').value=f; }
  });
  $('tmClearEnd').addEventListener('click',()=>{ tmEndSoundFile=null; $('tmEndSoundPath').value=''; });
  $('tmRefreshRewards').addEventListener('click',loadTimerRewards);
  $('tmAddBtn').addEventListener('click',addTimer);
  $('tmSavePreset').addEventListener('click',savePreset);
  renderOverlayBar('tmOverlayMode','tmOverlayUrl','tmCopyUrl','timers',store.overlayUrls);
  // chat command: !timer <name>
  window.addEventListener('spark-chat',e=>{
    const d=e.detail;
    const msg=(d.message||'').trim();
    if(msg.toLowerCase().startsWith('!timer ')){
      if(toolBlocked('timers', d.display||d.username)) return;
      const name=msg.slice(7).trim().toLowerCase();
      const t=timers.find(x=>x.name.toLowerCase()===name);
      if(t){ resetTimer(t); startTimer(t); }
    }
  });
  // redeems
  window.addEventListener('spark-redeem',e=>{
    const d=e.detail;
    const anyMatch=timers.some(t=>t.anyRedeem||(t.rewardId&&t.rewardId===d.reward_id));
    if(!anyMatch) return;
    if(toolBlocked('timers', d.user_name)) return;
    timers.forEach(t=>{
      if(t.anyRedeem||(t.rewardId&&t.rewardId===d.reward_id)){
        resetTimer(t); startTimer(t);
      }
    });
  });
}

function parseDuration(str){
  str=str.trim();
  if(str.includes(':')){
    const parts=str.split(':').map(x=>parseInt(x)||0);
    if(parts.length===4) return parts[0]*86400+parts[1]*3600+parts[2]*60+parts[3]; // d:h:mm:ss
    if(parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];                // h:mm:ss
    return parts[0]*60+(parts[1]||0);                                              // mm:ss
  }
  return parseInt(str)||0;
}

function addTimer(){
  const name=$('tmName').value.trim()||'Timer';
  const dur=parseDuration($('tmDuration').value||'300');
  const mode=$('tmMode').value;
  const font=$('tmFont').value.trim()||'Roboto Mono';
  const color=$('tmColor').value||'#ffc83d';
  const endMsg=$('tmEndMsg').value.trim();
  const rewardId=$('tmRewardSelect').value||'';
  const anyRedeem=$('tmAnyRedeem').checked;
  const autoResume=$('tmAutoResume').checked;
  const t={
    id:uid(), name, duration:dur, mode, font, color,
    startSound:tmStartSoundFile, endSound:tmEndSoundFile,
    endMessage:endMsg, rewardId, anyRedeem, autoResume,
    _remaining:mode==='down'?dur:0, _running:false, _interval:null,
  };
  timers.push(t);
  loadGoogleFont(font);
  renderActiveList();
  persist();
}

function savePreset(){
  const name=$('tmName').value.trim()||'Timer';
  const dur=parseDuration($('tmDuration').value||'300');
  const preset={
    id:uid(), name, duration:dur, mode:$('tmMode').value,
    font:$('tmFont').value.trim()||'Roboto Mono',
    color:$('tmColor').value||'#ffc83d',
    endMessage:$('tmEndMsg').value.trim(),
    startSound:tmStartSoundFile, endSound:tmEndSoundFile,
    rewardId:$('tmRewardSelect').value||'', anyRedeem:$('tmAnyRedeem').checked,
    autoResume:$('tmAutoResume').checked,
  };
  savedTimers.push(preset);
  persist();
  renderPresets();
}

function renderPresets(){
  const el=$('tmPresetList'); if(!el) return;
  if(!savedTimers.length){ el.innerHTML='<div class="hint">No presets saved.</div>'; return; }
  el.innerHTML=savedTimers.map((p,i)=>`
    <div class="timer-card">
      <div class="timer-name-row">
        <span style="flex:1;font-weight:600">${esc(p.name)}</span>
        <span class="tag">${fmtTime(p.duration)}</span>
        <button class="btn-sm btn-green" data-pi="${i}">▶ Add</button>
        <button class="btn-sm btn-ghost" data-di="${i}">✕</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('button[data-pi]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const p={...savedTimers[+btn.dataset.pi]};
      const t={...p,id:uid(),_remaining:p.mode==='down'?p.duration:0,_running:false,_interval:null};
      timers.push(t); loadGoogleFont(t.font); renderActiveList(); persist();
    });
  });
  el.querySelectorAll('button[data-di]').forEach(btn=>{
    btn.addEventListener('click',()=>{ savedTimers.splice(+btn.dataset.di,1); persist(); renderPresets(); });
  });
}

function renderActiveList(){
  const el=$('tmActiveList'); if(!el) return;
  if(!timers.length){ el.innerHTML='<div class="hint">No active timers.</div>'; return; }
  timers.forEach(t=>{ const ce=$(`card-${t.id}`); if(!ce) appendTimerCard(t); else renderTimerCard(t); });
  el.querySelectorAll('[data-timer-id]').forEach(card=>{
    if(!timers.find(t=>t.id===card.dataset.timerId)) card.remove();
  });
}

function appendTimerCard(t){
  const el=$('tmActiveList'); if(!el) return;
  const div=document.createElement('div');
  div.className='timer-card'; div.dataset.timerId=t.id; div.id=`card-${t.id}`;
  el.appendChild(div);
  renderTimerCard(t);
}

function renderTimerCard(t){
  const card=$(`card-${t.id}`); if(!card) return;
  const state=t._running?'Running':(t._remaining===0&&t.mode==='down'?'Done':'Paused');
  card.innerHTML=`
    <div class="timer-name-row">
      <span style="flex:1;font-weight:600">${esc(t.name)}</span>
      <span class="timer-state">${state}</span>
    </div>
    <div class="timer-display" style="font-family:'${t.font}',monospace;color:${t.color}">${fmtTime(t._remaining)}</div>
    <div class="timer-controls">
      <button class="btn-sm btn-green" data-act="start">Play</button>
      <button class="btn-sm" data-act="pause">Pause</button>
      <button class="btn-sm btn-ghost" data-act="reset">Reset</button>
      <button class="btn-sm btn-ghost" data-act="remove">Remove</button>
    </div>
    <label class="checkrow" style="font-size:.78rem;margin-top:6px">
      <input type="checkbox" data-act="autoresume" ${t.autoResume?'checked':''}> Auto-resume when SPARK opens
    </label>`;
  card.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const act=btn.dataset.act;
      if(act==='start') startTimer(t);
      else if(act==='pause') pauseTimer(t);
      else if(act==='reset') resetTimer(t);
      else if(act==='remove'){
        if(t._running){ t._running=false; clearInterval(t._interval); }
        timers=timers.filter(x=>x.id!==t.id);
        renderActiveList(); renderRightPreview(); pushOverlay(); persist();
      }
    });
  });
  const arCb=card.querySelector('[data-act="autoresume"]');
  if(arCb) arCb.addEventListener('change',()=>{ t.autoResume=arCb.checked; persist(); });
  renderRightPreview();
}

function renderRightPreview(){
  const el=$('tmPreview'); if(!el) return;
  if(!timers.length){ el.innerHTML='<div class="hint" style="color:var(--muted)">No active timers.</div>'; return; }
  timers.forEach(t=>{
    let pc=el.querySelector(`[data-prev="${t.id}"]`);
    if(!pc){
      pc=document.createElement('div');
      pc.className='tm-preview-card'; pc.dataset.prev=t.id;
      el.appendChild(pc);
    }
    pc.innerHTML=`
      <div class="tm-preview-name">${esc(t.name)}</div>
      <div class="tm-preview-time" style="font-family:'${t.font||'monospace'}',monospace;color:${t.color||'#ffc83d'}">${fmtTime(t._remaining)}</div>
      <div class="tm-preview-state">${t._running?'Running':(t._remaining===0&&t.mode==='down'?'Done':'Paused')}</div>`;
  });
  el.querySelectorAll('[data-prev]').forEach(pc=>{
    if(!timers.find(t=>t.id===pc.dataset.prev)) pc.remove();
  });
}

function loadGoogleFont(font){
  if(!font) return;
  const id='gfont-'+font.replace(/\s/g,'-');
  if(document.getElementById(id)) return;
  const link=document.createElement('link');
  link.id=id; link.rel='stylesheet';
  link.href=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}&display=swap`;
  document.head.appendChild(link);
}
function loadFontForInput(){
  const inp=$('tmFont'); if(!inp) return;
  inp.addEventListener('change',()=>loadGoogleFont(inp.value.trim()));
}

async function loadTimerRewards(){
  try{
    const r=await invoke('twitch_get_rewards');
    const sel=$('tmRewardSelect'); if(!sel) return;
    sel.innerHTML='<option value="">(none)</option>'+(r.rewards||[]).map(rw=>`<option value="${rw.id}">${esc(rw.title)}</option>`).join('');
  }catch(e){}
}

export async function initTimers(){
  buildLeft();
  const d=store.timers;
  savedTimers=(d.saved||[]);
  // Restore active timers from saved state
  const active=d.active||[];
  active.forEach(state=>{
    const t={
      ...state,
      _remaining: state.remaining ?? (state.mode==='down' ? state.duration : 0),
      _running: false, _interval: null,
    };
    timers.push(t);
    loadGoogleFont(t.font);
  });
  renderPresets();
  renderActiveList();
  // Auto-resume timers that were running when SPARK closed
  timers.filter(t=>t.autoResume&&t.wasRunning).forEach(t=>startTimer(t));
  pushOverlay();
  if(store.twitch.connected) loadTimerRewards();
  window.addEventListener('spark-twitch-status', e=>{ if(e.detail?.connected) loadTimerRewards(); });
  // Periodic save every 30s while any timer is running
  setInterval(()=>{ if(timers.some(t=>t._running)) persist(); }, 30000);
}
