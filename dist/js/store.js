// Shared mutable store — all tab modules read/write here.
export const store = {
  wheel: {},
  giveaway: {},
  timers: { list:[] },
  tasks: { list:[], settings:{} },
  goals: { bars:[] },
  checkins: { configs:[], firstClaim:{} },
  songrequest: { cfg:{}, queue:[] },
  chat: {},
  counters: {},
  credits: {},
  settings: {},
  twitch_tokens: {},
  overlayUrls: {},
  twitch: { connected:false, userId:'', login:'', clientId:'' },
};

// ── Global bot/user ignore list (Settings tab owns the UI) ──────────────────
// Lives in store.settings.ignoreList; all tabs reference it instead of
// keeping their own bot lists. Names are stored lowercase.

export function ignoreList(){
  if(!Array.isArray(store.settings.ignoreList)) store.settings.ignoreList = [];
  return store.settings.ignoreList;
}

export function isIgnored(name){
  const n = String(name||'').trim().toLowerCase();
  return !!n && ignoreList().includes(n);
}

export function addIgnore(name){
  const n = String(name||'').trim().toLowerCase();
  if(!n) return;
  const l = ignoreList();
  if(!l.includes(n)){ l.push(n); saveIgnoreList(); }
}

// Persists the whole settings object (it also carries ytm_token etc.) and
// tells every tab the list changed so they can re-filter.
export function saveIgnoreList(){
  window.__TAURI__.core.invoke('save_app_settings', { data: store.settings });
  window.dispatchEvent(new CustomEvent('spark-ignorelist'));
}

// ── Per-tool enable/disable ─────────────────────────────────────────────────
// Lets the streamer turn off a tool's chat commands / redeems when they aren't
// using that tab. State lives in store.settings.toolToggles keyed by tool id:
//   toolToggles[id] = { enabled: bool, msg: string }
// Absent id or enabled !== false means ENABLED (so existing setups are
// untouched until a tool is explicitly turned off).

// The tools that listen for viewer commands/redeems, in Settings display order.
export const TOOL_DEFS = [
  { id:'songrequest', label:'Song Request' },
  { id:'wheel',       label:'Wheel' },
  { id:'giveaway',    label:'Giveaway' },
  { id:'timers',      label:'Timers' },
  { id:'tasks',       label:'Tasks (Co-work)' },
  { id:'goals',       label:'Goals' },
  { id:'checkins',    label:'Check-ins' },
  { id:'counters',    label:'Counters' },
];

const TOOL_DEFAULT_MSG = {
  songrequest: 'Song requests are turned off right now.',
  wheel:       'The wheel is turned off right now.',
  giveaway:    'Giveaways are turned off right now.',
  timers:      'Timers are turned off right now.',
  tasks:       'The task list is turned off right now.',
  goals:       'Goal commands are turned off right now.',
  checkins:    'Check-ins are turned off right now.',
  counters:    'Counters are turned off right now.',
};

export function toolDefaultMsg(id){
  return TOOL_DEFAULT_MSG[id] || 'That feature is turned off right now.';
}

export function toolToggles(){
  if(!store.settings.toolToggles || typeof store.settings.toolToggles !== 'object') store.settings.toolToggles = {};
  return store.settings.toolToggles;
}

export function toolEnabled(id){
  const t = toolToggles()[id];
  return !t || t.enabled !== false; // default: enabled
}

export function toolDisabledMsg(id){
  const t = toolToggles()[id];
  const m = t && typeof t.msg === 'string' ? t.msg : '';
  return m || toolDefaultMsg(id);
}

export function saveToolToggles(){
  window.__TAURI__.core.invoke('save_app_settings', { data: store.settings });
}

// Rate-limit the "turned off" reply per tool so a spammed command can't flood
// chat (viewers do hammer redeems — see the request logs).
const _toolMsgLast = {};

// Call from a tab's command/redeem handler once it knows the message/redeem
// targets that tool. Returns true if the tool is OFF (caller should stop);
// when off it also posts the customisable "turned off" reply to chat.
export function toolBlocked(id, username){
  if(toolEnabled(id)) return false;
  const now = Date.now();
  if(now - (_toolMsgLast[id] || 0) > 8000){
    _toolMsgLast[id] = now;
    const raw = toolDisabledMsg(id);
    if(raw && raw.trim()){
      const msg = raw.replace(/\{name\}/g, username || '').replace(/<<username>>/g, username || '').trim();
      if(msg) window.__TAURI__.core.invoke('twitch_send_chat_message', { message: msg }).catch(()=>{});
    }
  }
  return true;
}
