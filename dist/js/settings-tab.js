import { store } from './store.js';
import { $, esc } from './utils.js';
import { setHeaderStatus } from './app.js';

const { invoke } = window.__TAURI__.core;

function setTwStatus(state, msg){
  const dot=$('settTwDot'), txt=$('settTwText'); if(!dot||!txt) return;
  dot.className='dot'+(state?' '+state:''); txt.textContent=msg;
  setHeaderStatus(state, msg);
}

async function afterConnected(){
  try{
    const who=await invoke('twitch_load_saved');
    store.twitch.connected=true; store.twitch.userId=who.user_id;
    store.twitch.login=who.login; store.twitch.clientId=who.client_id;
    $('settTwAuthBox').style.display='none';
    $('settTwConnectedBox').style.display='block';
    $('settTwWho').textContent=`Connected as ${who.login}`;
    setTwStatus('on','Connected');
    // start chat listener
    await invoke('twitch_connect_chat',{ channel: who.login });
    // auto-start EventSub so redeems work across all tools immediately
    await invoke('twitch_connect_eventsub');
    setTwStatus('on',`Connected as ${who.login}, listening for redeems`);
    // notify all tabs
    window.dispatchEvent(new CustomEvent('spark-twitch-status',{detail:{connected:true}}));
  }catch(e){ setTwStatus('err',String(e)); }
}

export async function initSettings(){
  const el=$('settContent'); if(!el) return;
  el.innerHTML=`
  <h1 style="font-size:1rem;letter-spacing:.25em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:18px">⚙ Settings</h1>
  <div class="card" style="max-width:520px">
    <h2>About</h2>
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-weight:700" id="settVersion">SPARK v…</span>
      <span class="tag" style="background:#5c2a2a;color:#ffadad;border-color:#5c2a2a">BETA</span>
    </div>
    <div class="hint mt">This build is still in active development, not a 1.0 release. Expect rough edges, and please report anything odd.</div>
  </div>
  <div class="card" style="max-width:520px">
    <h2>Twitch Connection</h2>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span class="dot" id="settTwDot"></span><span id="settTwText">Not connected</span>
    </div>
    <div id="settTwAuthBox">
      <label for="settTwClientId">Your Twitch App Client ID</label>
      <input type="text" id="settTwClientId" placeholder="abcd1234…">
      <button class="btn-twitch full mt" id="settTwAuthBtn">Connect Twitch</button>
      <div id="settTwDeviceBox" style="display:none" class="mt">
        <div class="ok">1. Go to <span class="link" id="settTwLink"></span></div>
        <div class="ok">2. Enter code: <code id="settTwCode"></code></div>
        <div class="hint">Waiting for browser authorization…</div>
      </div>
      <details class="mt">
        <summary>How do I get a Client ID? (~2 min)</summary>
        <div class="hint">
          1. Go to <span class="link" data-url="https://dev.twitch.tv/console/apps/create">dev.twitch.tv/console/apps/create</span><br>
          2. Name: anything. OAuth Redirect URL: <code>http://localhost</code><br>
          3. Category: Broadcasting Suite. Client Type: <b>Public</b>.<br>
          4. Create, copy the <b>Client ID</b> and paste above.
        </div>
      </details>
    </div>
    <div id="settTwConnectedBox" style="display:none">
      <div class="ok" id="settTwWho"></div>
      <div class="row mt">
        <button class="btn-sm btn-twitch" id="settReconnectChat">Reconnect Chat</button>
        <button class="btn-sm btn-ghost" id="settTwLogout">Log out</button>
      </div>
      <div class="hint mt">Chat is read automatically for <code>!</code> commands. EventSub for redeems is started per-tool.</div>
    </div>
  </div>
  <div class="card" style="max-width:520px;margin-top:0">
    <h2>Overlay</h2>
    <div class="hint">
      <b>Master overlay</b>: shows all tools in one browser source.<br>
      Each tool tab also has a toggle to use its own unique overlay URL instead.<br><br>
      Add the URL as a <b>Browser Source</b> in OBS / Meld / Streamlabs.<br>
      The app must be running for the overlay to work.
    </div>
  </div>
  <div class="card" style="max-width:520px;margin-top:0">
    <h2>Backup &amp; Restore</h2>
    <div class="hint" style="margin-bottom:12px">Export a backup of all your lists, goals, check-in counts, and settings. Twitch tokens are excluded. You'll reconnect on a new PC in about 30 seconds.</div>
    <div class="row">
      <button class="btn-sm btn-gold" id="settExportBtn">Export Backup</button>
      <button class="btn-sm" id="settImportBtn">Import Backup</button>
    </div>
    <div class="warn" id="settBackupMsg" style="display:none"></div>
    <div class="ok" id="settBackupOk" style="display:none"></div>
  </div>
  <div class="hint" style="margin-top:8px;text-align:center">Data saved to %APPDATA%\\com.spark.app\\spark-data.json</div>`;

  wireSettingsEvents();

  invoke('get_app_version').then(v=>{
    const el2=$('settVersion'); if(el2) el2.textContent=`SPARK v${v}`;
  }).catch(()=>{});

  // restore saved client id
  const cid = store.twitch_tokens?.client_id||'';
  if(cid && $('settTwClientId')) $('settTwClientId').value=cid;

  // Silent reconnect — fire-and-forget so a slow/unreachable Twitch never
  // blocks boot (all other tabs init immediately; they pick up connection
  // state via the spark-twitch-status event when it lands).
  afterConnected().catch(()=>{ /* not logged in yet, fine */ });

  window.addEventListener('spark-twitch-status',e=>{
    const d=e.detail;
    if(d.connected) setTwStatus('on','Connected');
    else setTwStatus('err',d.error||'Disconnected');
  });
}

function wireSettingsEvents(){
  $('settTwAuthBtn').addEventListener('click',startAuth);
  $('settTwLogout').addEventListener('click',()=>{
    invoke('twitch_disconnect');
    store.twitch.connected=false;
    $('settTwConnectedBox').style.display='none';
    $('settTwAuthBox').style.display='block';
    setTwStatus('','Not connected');
  });
  $('settReconnectChat').addEventListener('click',async()=>{
    try{ await invoke('twitch_connect_chat',{channel:store.twitch.login}); setTwStatus('on','Chat reconnected'); }
    catch(e){ setTwStatus('err',String(e)); }
  });

  // Backup
  $('settExportBtn').addEventListener('click',async()=>{
    try{
      const data = await invoke('backup_data');
      const json = JSON.stringify(data,null,2);
      const date = new Date().toISOString().slice(0,10);
      const path = await window.__TAURI__.dialog.save({
        defaultPath: `SPARK-backup-${date}.json`,
        filters:[{name:'JSON',extensions:['json']}],
      });
      if(!path) return;
      // Write via a temp file approach using the filesystem API
      await window.__TAURI__.fs.writeTextFile(path, json);
      showBackupOk('Backup saved!');
    }catch(e){ showBackupMsg(String(e)); }
  });

  $('settImportBtn').addEventListener('click',async()=>{
    try{
      const path = await window.__TAURI__.dialog.open({multiple:false,filters:[{name:'JSON',extensions:['json']}]});
      if(!path) return;
      const txt = await window.__TAURI__.fs.readTextFile(path);
      const data = JSON.parse(txt);
      if(!confirm('This will overwrite all current data including check-in counts, wheel lists, goals, and settings. Twitch connection is preserved.\n\nContinue?')) return;
      await invoke('restore_data',{ data });
      showBackupOk('Backup restored! Please restart the app to reload all data.');
    }catch(e){ showBackupMsg('Failed: '+String(e)); }
  });

  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-url]'); if(!el) return;
    const url=el.dataset.url; if(!url) return;
    try{ if(window.__TAURI__.opener) window.__TAURI__.opener.openUrl(url); else window.open(url,'_blank'); }
    catch(_){ window.open(url,'_blank'); }
  });
}

function showBackupMsg(msg){ const e=$('settBackupMsg'); if(e){ e.textContent=msg; e.style.display='block'; } const o=$('settBackupOk'); if(o) o.style.display='none'; }
function showBackupOk(msg){ const e=$('settBackupOk'); if(e){ e.textContent=msg; e.style.display='block'; } const w=$('settBackupMsg'); if(w) w.style.display='none'; }

async function startAuth(){
  const clientId=$('settTwClientId').value.trim();
  if(!clientId){ alert('Paste your Client ID first.'); return; }
  setTwStatus('wait','Requesting device code…');
  try{
    const dev=await invoke('twitch_start_device_auth',{clientId});
    $('settTwDeviceBox').style.display='block';
    $('settTwCode').textContent=dev.user_code;
    const uri=dev.verification_uri||'https://www.twitch.tv/activate';
    const link=$('settTwLink'); link.textContent=uri; link.dataset.url=uri;
    setTwStatus('wait','Waiting for browser authorization…');
    pollDevice(clientId,dev.device_code,dev.interval||5);
  }catch(e){ setTwStatus('err',String(e)); }
}

async function pollDevice(clientId,deviceCode,interval){
  const tick=async()=>{
    try{
      const r=await invoke('twitch_poll_device_auth',{clientId,deviceCode});
      if(r.status==='authorized'){
        $('settTwDeviceBox').style.display='none';
        await afterConnected(); return;
      }
    }catch(e){}
    setTimeout(tick,Math.max(interval,3)*1000);
  };
  setTimeout(tick,Math.max(interval,3)*1000);
}
