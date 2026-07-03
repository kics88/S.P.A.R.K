import { initWheel }      from './wheel-tab.js';
import { initGiveaway }   from './giveaway-tab.js';
import { initTimers }     from './timers-tab.js';
import { initTasks }      from './tasks-tab.js';
import { initGoals }      from './goals-tab.js';
import { initCheckins }   from './checkins-tab.js';
import { initSongRequest } from './songrequest-tab.js';
import { initChat }       from './chat-tab.js';
import { initCounters }   from './counters-tab.js';
import { initSettings }   from './settings-tab.js';
import { store }          from './store.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('pane-'+tab.dataset.tab).classList.add('active');
  });
});

// ── Global Twitch status header ───────────────────────────────────────────────
export function setHeaderStatus(state, msg){
  const dot  = document.getElementById('twDotHeader');
  const text = document.getElementById('twStatusHeader');
  dot.className  = 'dot' + (state ? ' '+state : '');
  text.textContent = msg;
}

// ── Help System ───────────────────────────────────────────────────────────────
const HELP_CONTENT = {
  wheel: {
    title: 'Wheel',
    html: '<h3>Overview</h3>'
      + '<p>Spin a wheel to randomly pick from a list of items. Great for viewer giveaways, game picks, or any randomized decision.</p>'
      + '<h3>Setting Up</h3>'
      + '<ul>'
      + '<li>Type an item name and click <strong>Add</strong> to add entries to the wheel.</li>'
      + '<li>Drag the handle to reorder items.</li>'
      + '<li>Click the colour swatch on any item to change its colour.</li>'
      + '<li>Use <strong>Presets</strong> to save and reload different wheel lists.</li>'
      + '</ul>'
      + '<h3>Spinning</h3>'
      + '<ul>'
      + '<li>Click <strong>Spin</strong> in the preview column to spin the wheel.</li>'
      + '<li>Enable <strong>Remove Winner</strong> to automatically remove the winner after each spin.</li>'
      + '</ul>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> at the bottom and add it as a Browser Source in OBS.</p>'
  },
  giveaway: {
    title: 'Giveaway',
    html: '<h3>Overview</h3>'
      + '<p>Run keyword-based giveaways where viewers enter by typing a word in chat.</p>'
      + '<h3>Setting Up</h3>'
      + '<ul>'
      + '<li>Set the <strong>Entry Word</strong> — viewers type this in chat to enter (e.g. <code>!enter</code>).</li>'
      + '<li>Configure eligibility: sub-only, follower-only, or open to all.</li>'
      + '</ul>'
      + '<h3>Running a Giveaway</h3>'
      + '<ul>'
      + '<li>Click <strong>Open Giveaway</strong> to start accepting entries.</li>'
      + '<li>Click <strong>Close Giveaway</strong> to stop new entries.</li>'
      + '<li>Click <strong>Draw Winner</strong> to pick a random entrant.</li>'
      + '</ul>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS to display the winner announcement on stream.</p>'
  },
  timers: {
    title: 'Timers',
    html: '<h3>Overview</h3>'
      + '<p>Create named countdown or count-up timers that can be triggered automatically or started manually.</p>'
      + '<h3>Creating a Timer</h3>'
      + '<ul>'
      + '<li>Click <strong>New Timer</strong>, give it a name and set the duration.</li>'
      + '<li>Choose <strong>Count Down</strong> or <strong>Count Up</strong>.</li>'
      + '<li>Pick a Google Font and text colour to match your stream style.</li>'
      + '<li>Optionally pick a sound to play when the timer ends.</li>'
      + '</ul>'
      + '<h3>Triggering Timers</h3>'
      + '<ul>'
      + '<li>Timers can be started via a <strong>channel point redeem</strong> or a <strong>chat command</strong>.</li>'
      + '<li>You can also start, stop, or reset any timer manually from the preview column.</li>'
      + '</ul>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS to show timers on stream.</p>'
  },
  tasks: {
    title: 'Tasks (Co-work)',
    html: '<h3>Overview</h3>'
      + '<p>A shared to-do list for you and your viewers. Your tasks appear at the top in gold; viewer tasks are grouped below by username.</p>'
      + '<h3>Chat Commands</h3>'
      + '<ul>'
      + '<li><code>!task add &lt;text&gt;</code> — add a task</li>'
      + '<li><code>!task done &lt;number&gt;</code> — mark a task complete</li>'
      + '<li><code>!task remove &lt;number&gt;</code> — delete a task</li>'
      + '<li><code>!task clear</code> — clear all your tasks</li>'
      + '</ul>'
      + '<h3>Settings</h3>'
      + '<ul>'
      + '<li>Set per-tier task limits (e.g. subs can add more tasks than non-subs).</li>'
      + '<li>Use the buttons in the app to manage your own host tasks directly — press Enter or click Add.</li>'
      + '<li><strong>Visual Settings</strong> — customise colours, shape, font sizes, box width/padding, and position independently for the host box and viewer box. Choose to keep them combined in one box (with a separator) or split into two independently positioned boxes.</li>'
      + '</ul>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS to show the live task list on stream.</p>'
  },
  goals: {
    title: 'Goals',
    html: '<h3>Overview</h3>'
      + '<p>Display animated goal progress bars on stream. Supports followers, subs, bits, and custom chat commands.</p>'
      + '<h3>Creating a Goal</h3>'
      + '<ul>'
      + '<li>Click <strong>New Goal</strong>, give it a name and set a target number.</li>'
      + '<li>Choose a <strong>Source</strong>: Followers, Subscribers, Bits, or a custom <code>!command</code>.</li>'
      + '<li>Pick a colour theme, orientation (horizontal/vertical), and text placement.</li>'
      + '</ul>'
      + '<h3>Milestones</h3>'
      + '<p>Add multiple milestones to chain goals — when one target is hit, the bar advances to the next automatically.</p>'
      + '<h3>Celebration</h3>'
      + '<p>Enable <strong>Emoji Rain</strong> to trigger a celebration animation when a goal is reached.</p>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS to show goal bars on stream.</p>'
  },
  checkins: {
    title: 'Check-ins',
    html: '<h3>Overview</h3>'
      + '<p>Show a popup on stream when a viewer redeems a channel point reward to check in. Each viewer can check in once per stream.</p>'
      + '<h3>Setting Up</h3>'
      + '<ul>'
      + '<li>Click <strong>New Config</strong> and link it to a channel point reward from the dropdown.</li>'
      + '<li>Use <code>{name}</code> for the viewer display name and <code>{count}</code> for their lifetime check-in count.</li>'
      + '<li>Adjust shape, animation, entry direction, colours, font, duration, and sound.</li>'
      + '<li>Choose from 9 screen positions for where the popup appears.</li>'
      + '</ul>'
      + '<h3>First Claim</h3>'
      + '<p>Set a separate reward for <strong>First Claim</strong> — a persistent block showing the first viewer to check in each stream. Resets when SPARK restarts.</p>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS to show check-in popups on stream.</p>'
  },
  songrequest: {
    title: 'Song Request',
    html: '<h3>Requirements</h3>'
      + '<p><strong>Pear Desktop</strong> must be installed and running. Download it at <strong>github.com/pear-devs/pear-desktop/releases</strong>.</p>'
      + '<p>In Pear Desktop, go to <strong>Settings &rarr; Plugins &rarr; API Server</strong>, enable it, and set Authorization to <strong>None</strong>.</p>'
      + '<h3>Connecting</h3>'
      + '<p>Click <strong>Connect Pear Desktop</strong>. The status dot turns green when connected.</p>'
      + '<h3>How Viewers Request Songs</h3>'
      + '<ul>'
      + '<li><strong>Channel Point Reward (recommended)</strong> — create a reward in Twitch with "Require viewer to enter text" enabled, then pick it from the dropdown. Viewers paste a YouTube link or song title as their message.</li>'
      + '<li><strong>Any Redeem</strong> — enable "Any redeem = song request" to treat any channel point redemption as a song request.</li>'
      + '<li><strong>!sr Command</strong> — enable "Allow !sr command" and choose <strong>Who can use !sr</strong>: Everyone, Followers, Subscribers, Mods only, or Broadcaster only. Mods and the broadcaster always pass regardless of the setting.</li>'
      + '</ul>'
      + '<h3>Queue Settings</h3>'
      + '<ul>'
      + '<li><strong>!sr cooldown</strong> — minutes a viewer must wait before requesting again via command. Channel point redeems are always exempt.</li>'
      + '<li><strong>Max queue size</strong> — maximum songs in the queue at once.</li>'
      + '<li><strong>Per-user limit</strong> — how many songs one viewer can have queued. Set to 0 for unlimited.</li>'
      + '<li><strong>Max song duration</strong> — songs longer than this (in minutes) are auto-skipped. Set to 0 to disable.</li>'
      + '</ul>'
      + '<h3>Chat Responses</h3>'
      + '<p>Enable <strong>Send chat messages</strong> to post automatic responses. Customise each message using tokens like <code>&lt;&lt;username&gt;&gt;</code>, <code>&lt;&lt;song&gt;&gt;</code>, <code>&lt;&lt;time&gt;&gt;</code>, and more.</p>'
      + '<h3>OBS Overlays</h3>'
      + '<ul>'
      + '<li><strong>Now Playing</strong> — Browser Source at <code>http://localhost:4747/nowplaying</code>. Choose Card, Minimal, or Banner style.</li>'
      + '<li><strong>Song Queue</strong> — enable "Show queue overlay" and add a Browser Source at <code>http://localhost:4747/srqueue</code>. Auto-hides when empty.</li>'
      + '</ul>'
      + '<h3>Host Controls</h3>'
      + '<p>Use <strong>Manual Request</strong> to add songs yourself. Use the playback buttons in the Now Playing panel to control Pear Desktop directly from SPARK.</p>'
  },
  chat: {
    title: 'Chat',
    html: '<h3>Overview</h3>'
      + '<p>Shows live Twitch chat in-app and drives a fully customisable chat overlay — colours, shapes, glow, fonts, and animation, all set independently for Everyone, Subs, VIPs, Mods, and the Broadcaster. Follow and sub alerts appear inline in the chat feed with their own distinct styling.</p>'
      + '<h3>Style Presets</h3>'
      + '<p>Pick a built-in look — from <strong>Serious</strong> and <strong>Bland</strong> through <strong>Neon Cyberpunk</strong>, <strong>Retro Arcade</strong>, <strong>Elegant Gold</strong>, <strong>Spooky</strong>, all the way to full <strong>Cutesy</strong> — then tweak any field. Changing any setting automatically switches to <strong>Custom</strong>.</p>'
      + '<h3>Ignore List</h3>'
      + '<p>List bot usernames (one per line) to filter them out of the overlay entirely. You can also click <strong>Ignore</strong> next to any message in the Live Chat log to add that user instantly.</p>'
      + '<h3>Role Styles</h3>'
      + '<ul>'
      + '<li>Switch between Everyone / Follower / Subscriber / VIP / Moderator / Broadcaster to style each independently.</li>'
      + '<li>Follower status is looked up automatically (and cached) the first time each viewer chats — no setup needed.</li>'
      + '<li>Set bubble shape (rounded, pill, square, speech bubble, hexagon, or text-only), background, border, glow, font, weight, and a badge icon.</li>'
      + '<li>Enable "Use viewer\'s Twitch name colour" to colour each username the way it appears in real Twitch chat instead of a fixed colour.</li>'
      + '</ul>'
      + '<h3>Follow &amp; Sub Alerts</h3>'
      + '<p>Separate styling and message template (use <code>{name}</code>) for new followers and new subscribers, including their own sound effect.</p>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS. The live preview on the right shows a looping demo of every role and alert so you can see your styling without waiting for real chat activity.</p>'
  },
  counters: {
    title: 'Counters',
    html: '<h3>Overview</h3>'
      + '<p>Create any number of chat-driven counters — death counters, hug counters, "how many times has this happened" counters, anything with a number that goes up or down.</p>'
      + '<h3>Setting Up</h3>'
      + '<ul>'
      + '<li>Click <strong>Add</strong> to create a counter, then <strong>Edit</strong> to set its increment/decrement/reset chat commands.</li>'
      + '<li><strong>Reset</strong> always requires a mod or the broadcaster, regardless of the permission setting.</li>'
      + '<li>Enable <strong>Allow a custom amount</strong> so viewers can type e.g. <code>!death 3</code> to add 3 instead of the fixed step.</li>'
      + '<li>Set an optional <strong>Min</strong>/<strong>Max</strong> to clamp the value.</li>'
      + '</ul>'
      + '<h3>Manual Control</h3>'
      + '<p>Use the +/− buttons, the Set field, or Reset to 0 directly in the app — handy for correcting a miscount.</p>'
      + '<h3>Styling</h3>'
      + '<p>Pick a colour theme or go fully <strong>Custom</strong>: shape, glow, fonts, separate colours/sizes for the label and the number, a change animation (pop/bounce/shake/flash), and a text template using <code>{name}</code> and <code>{value}</code>.</p>'
      + '<h3>OBS Overlay</h3>'
      + '<p>Copy the <strong>Overlay URL</strong> and add it as a Browser Source in OBS. All visible counters render together, stacked or in a row.</p>'
  }
};

function initHelpSystem() {
  var modal = document.getElementById('helpModal');
  var body  = document.getElementById('helpBoxBody');
  var title = document.getElementById('helpBoxTabName');
  document.getElementById('helpBoxClose').addEventListener('click', function() {
    modal.classList.remove('open');
  });
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.classList.remove('open');
  });
  window.showHelp = function(tabId) {
    var cfg = HELP_CONTENT[tabId];
    if (!cfg) return;
    title.textContent = cfg.title;
    body.innerHTML = cfg.html;
    modal.classList.add('open');
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot(){
  const data = await invoke('load_all_data');
  store.wheel       = data.wheel       || {};
  store.giveaway    = data.giveaway    || {};
  store.timers      = data.timers      || { list:[] };
  store.tasks       = data.tasks       || { list:[], settings:{} };
  store.goals       = data.goals       || { bars:[] };
  store.checkins    = data.checkins    || { configs:[], firstClaim:{} };
  store.songrequest = data.songrequest || { cfg:{}, queue:[] };
  store.chat        = data.chat        || {};
  store.counters    = data.counters    || {};
  store.settings    = data.settings    || {};
  store.twitch_tokens = data.twitch_tokens || {};

  const urls = await invoke('overlay_url');
  store.overlayUrls = urls;

  // init help system before tabs so modal is ready
  initHelpSystem();

  // init each tab
  await initSettings();
  await initWheel();
  await initGiveaway();
  await initTimers();
  await initTasks();
  await initGoals();
  await initCheckins();
  initSongRequest();
  await initChat();
  await initCounters();

  // global Twitch event forwarding
  await listen('twitch-status', ev=>{
    const d = ev.payload;
    if(d.connected) setHeaderStatus('on','Connected');
    else setHeaderStatus('err', d.error||'Disconnected');
    window.dispatchEvent(new CustomEvent('spark-twitch-status', {detail: d}));
  });
  await listen('twitch-redeem', ev=>{
    window.dispatchEvent(new CustomEvent('spark-redeem', {detail: ev.payload}));
  });
  await listen('twitch-chat', ev=>{
    window.dispatchEvent(new CustomEvent('spark-chat', {detail: ev.payload}));
  });
  await listen('twitch-goal', ev=>{
    window.dispatchEvent(new CustomEvent('spark-goal', {detail: ev.payload}));
  });
}

boot().catch(err => {
  console.error('SPARK boot failed:', err);
  document.body.innerHTML = '<div style="padding:40px;color:#ff5d73;font-family:monospace;background:#1b1530;min-height:100vh">'
    + '<h2 style="color:#ffc83d;margin-bottom:16px">SPARK failed to start</h2>'
    + '<pre style="white-space:pre-wrap;font-size:.85rem">' + (err && err.stack ? err.stack : String(err)) + '</pre>'
    + '<p style="margin-top:20px;color:#a79fc7">Please share this error message.</p>'
    + '</div>';
});
