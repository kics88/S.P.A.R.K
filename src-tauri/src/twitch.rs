use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use crate::Shared;

const SCOPES: &str = "channel:read:redemptions channel:read:subscriptions moderator:read:followers chat:read user:write:chat";

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn save_tokens(shared: &Shared, tokens: Value) {
    let path = shared.data_path.lock().unwrap().clone();
    let mut d = shared.data.lock().unwrap();
    d.twitch_tokens = tokens;
    crate::save_to_disk(&path, &d);
}

// ── Device auth ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn twitch_start_device_auth(client_id: String) -> Result<Value, String> {
    let c = reqwest::blocking::Client::new();
    let r = c.post("https://id.twitch.tv/oauth2/device")
        .form(&[("client_id", client_id.as_str()), ("scopes", SCOPES)])
        .send().map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("Device request failed ({}). Check your Client ID.", r.status()));
    }
    Ok(r.json().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn twitch_poll_device_auth(shared: State<Shared>, client_id: String, device_code: String) -> Result<Value, String> {
    let c = reqwest::blocking::Client::new();
    let r = c.post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id",   client_id.as_str()),
            ("scopes",      SCOPES),
            ("device_code", device_code.as_str()),
            ("grant_type",  "urn:ietf:params:oauth:grant-type:device_code"),
        ]).send().map_err(|e| e.to_string())?;
    let v: Value = r.json().map_err(|e| e.to_string())?;
    if let Some(access) = v.get("access_token").and_then(|x| x.as_str()) {
        let expires_in = v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(14400);
        let refresh = v.get("refresh_token").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let tokens = json!({
            "access_token":  access,
            "refresh_token": refresh,
            "expires_at":    now_secs() + expires_in,
            "client_id":     client_id,
        });
        save_tokens(&shared, tokens.clone());
        return Ok(json!({"status":"authorized","tokens":tokens}));
    }
    let msg = v.get("message").and_then(|x| x.as_str()).unwrap_or("authorization_pending");
    Ok(json!({"status":"pending","message":msg}))
}

// ── Token management ──────────────────────────────────────────────────────────

pub fn ensure_token(shared: &Shared) -> Result<(String, String), String> {
    let (access, refresh, expires_at, client_id, uid, login) = {
        let d = shared.data.lock().unwrap();
        let t = &d.twitch_tokens;
        (
            t.get("access_token").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            t.get("refresh_token").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            t.get("expires_at").and_then(|x| x.as_u64()).unwrap_or(0),
            t.get("client_id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            t.get("user_id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            t.get("login").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        )
    };
    if access.is_empty() || client_id.is_empty() {
        return Err("Not connected to Twitch".into());
    }
    if now_secs() + 60 < expires_at { return Ok((access, client_id)); }
    let c = reqwest::blocking::Client::new();
    let r = c.post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id",     client_id.as_str()),
            ("grant_type",    "refresh_token"),
            ("refresh_token", refresh.as_str()),
        ]).send().map_err(|e| e.to_string())?;
    let v: Value = r.json().map_err(|e| e.to_string())?;
    let new_access = v.get("access_token").and_then(|x| x.as_str())
        .ok_or("Token refresh failed — please reconnect")?.to_string();
    let new_refresh = v.get("refresh_token").and_then(|x| x.as_str()).unwrap_or(&refresh).to_string();
    let expires_in = v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(14400);
    save_tokens(shared, json!({
        "access_token":  new_access.clone(),
        "refresh_token": new_refresh,
        "expires_at":    now_secs() + expires_in,
        "client_id":     client_id.clone(),
        // preserve cached identity across refreshes
        "user_id":       uid,
        "login":         login,
    }));
    Ok((new_access, client_id))
}

pub fn validate(access: &str) -> Result<(String, String), String> {
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://id.twitch.tv/oauth2/validate")
        .header("Authorization", format!("OAuth {}", access))
        .send().map_err(|e| e.to_string())?;
    if !r.status().is_success() { return Err("Token invalid or expired".into()); }
    let v: Value = r.json().map_err(|e| e.to_string())?;
    Ok((
        v.get("user_id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        v.get("login").and_then(|x| x.as_str()).unwrap_or("").to_string(),
    ))
}

// Persist the validated user_id/login next to the tokens so routine commands
// don't need a validate() round-trip to id.twitch.tv on every call.
fn store_identity(shared: &Shared, uid: &str, login: &str) {
    let path = shared.data_path.lock().unwrap().clone();
    let mut d = shared.data.lock().unwrap();
    d.twitch_tokens["user_id"] = json!(uid);
    d.twitch_tokens["login"]   = json!(login);
    crate::save_to_disk(&path, &d);
}

// Cached (user_id, login). Falls back to validate() once, then caches.
pub fn identity(shared: &Shared, access: &str) -> Result<(String, String), String> {
    {
        let d = shared.data.lock().unwrap();
        let t = &d.twitch_tokens;
        let uid   = t.get("user_id").and_then(|x| x.as_str()).unwrap_or("");
        let login = t.get("login").and_then(|x| x.as_str()).unwrap_or("");
        if !uid.is_empty() && !login.is_empty() { return Ok((uid.to_string(), login.to_string())); }
    }
    let (uid, login) = validate(access)?;
    store_identity(shared, &uid, &login);
    Ok((uid, login))
}

#[tauri::command]
pub fn twitch_load_saved(shared: State<Shared>) -> Result<Value, String> {
    let (access, client_id) = ensure_token(&shared)?;
    // Full validate at boot — this is the one place we always verify the token
    // is live; everything after uses the cached identity.
    let (uid, login) = validate(&access)?;
    store_identity(&shared, &uid, &login);
    Ok(json!({"connected":true,"user_id":uid,"login":login,"client_id":client_id}))
}

// ── Rewards listing ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn twitch_get_rewards(shared: State<Shared>) -> Result<Value, String> {
    let (access, client_id) = ensure_token(&shared)?;
    let (uid, _) = identity(&shared, &access)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/channel_points/custom_rewards")
        .query(&[("broadcaster_id", uid.as_str())])
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    let v: Value = r.json().map_err(|e| e.to_string())?;
    let rewards: Vec<Value> = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default()
        .into_iter().map(|r| json!({
            "id":    r.get("id").cloned().unwrap_or(Value::Null),
            "title": r.get("title").cloned().unwrap_or(Value::Null),
            "cost":  r.get("cost").cloned().unwrap_or(Value::Null),
        })).collect();
    Ok(json!({"rewards":rewards}))
}

// ── Follower / subscriber checks ──────────────────────────────────────────────

// Follower status barely changes mid-stream; cache it so busy chat doesn't
// hammer Helix with one API call per !command per user.
const FOLLOWER_CACHE_TTL_SECS: u64 = 600;

#[tauri::command]
pub fn twitch_check_follower(shared: State<Shared>, user_id: String, broadcaster_id: String) -> Result<bool, String> {
    let now = now_secs();
    {
        let cache = shared.follower_cache.lock().unwrap();
        if let Some((is_follower, at)) = cache.get(&user_id) {
            if now.saturating_sub(*at) < FOLLOWER_CACHE_TTL_SECS { return Ok(*is_follower); }
        }
    }
    let (access, client_id) = ensure_token(&shared)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/channels/followers")
        .query(&[("broadcaster_id", broadcaster_id.as_str()), ("user_id", user_id.as_str())])
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    let v: Value = r.json().map_err(|e| e.to_string())?;
    let is_follower = v.get("total").and_then(|x| x.as_u64()).unwrap_or(0) > 0;
    {
        let mut cache = shared.follower_cache.lock().unwrap();
        // Light pruning so a very long session can't grow unbounded
        if cache.len() > 5000 { cache.retain(|_, (_, at)| now.saturating_sub(*at) < FOLLOWER_CACHE_TTL_SECS); }
        cache.insert(user_id, (is_follower, now));
    }
    Ok(is_follower)
}

#[tauri::command]
pub fn twitch_check_subscriber(shared: State<Shared>, user_id: String, broadcaster_id: String) -> Result<bool, String> {
    let (access, client_id) = ensure_token(&shared)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/subscriptions/user")
        .query(&[("broadcaster_id", broadcaster_id.as_str()), ("user_id", user_id.as_str())])
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    Ok(r.status().is_success())
}

// ── EventSub (redeems) ────────────────────────────────────────────────────────

#[tauri::command]
pub fn twitch_disconnect(shared: State<Shared>) {
    shared.twitch_stop.store(true, Ordering::SeqCst);
    shared.chat_stop.store(true, Ordering::SeqCst);
    shared.twitch_running.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn twitch_connect_eventsub(app: tauri::AppHandle, shared: State<Shared>) -> Result<(), String> {
    // Cheap up-front check so the UI gets an immediate error if not connected —
    // the thread fetches its own (fresh) token on every (re)connect.
    ensure_token(&shared)?;
    if shared.twitch_running.load(Ordering::SeqCst) {
        shared.twitch_stop.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(300));
    }
    shared.twitch_stop.store(false, Ordering::SeqCst);
    shared.twitch_running.store(true, Ordering::SeqCst);
    let stop = shared.twitch_stop.clone();
    std::thread::spawn(move || { run_eventsub(&app, stop); });
    Ok(())
}

fn subscribe(access: &str, client_id: &str, session_id: &str, sub_type: &str, version: &str, condition: Value) -> Result<(), String> {
    let c = reqwest::blocking::Client::new();
    let r = c.post("https://api.twitch.tv/helix/eventsub/subscriptions")
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", client_id)
        .json(&json!({
            "type": sub_type, "version": version,
            "condition": condition,
            "transport": {"method":"websocket","session_id":session_id}
        })).send().map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        let v: Value = r.json().unwrap_or(json!({}));
        return Err(format!("Subscribe {} failed: {}", sub_type, v.get("message").and_then(|x| x.as_str()).unwrap_or("")));
    }
    Ok(())
}

// Twitch sends a keepalive message every ~10s. If the socket goes silent for
// longer than this, it's half-open (PC sleep, network drop) — force a reconnect.
const EVENTSUB_SILENCE_TIMEOUT: Duration = Duration::from_secs(30);

fn run_eventsub(app: &tauri::AppHandle, stop: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    use tungstenite::Message;
    let mut url = "wss://eventsub.wss.twitch.tv/ws".to_string();
    loop {
        if stop.load(Ordering::SeqCst) { return; }

        // Fresh token on every (re)connect — the old one may have expired.
        let creds = {
            let shared = app.state::<Shared>();
            ensure_token(&shared).and_then(|(a, c)| validate(&a).map(|(u, _)| (a, c, u)))
        };
        let (access, client_id, uid) = match creds {
            Ok(x) => x,
            Err(e) => {
                let _ = app.emit("twitch-status", json!({"connected":false,"error":e}));
                for _ in 0..20 { if stop.load(Ordering::SeqCst) { return; } std::thread::sleep(Duration::from_millis(500)); }
                continue;
            }
        };
        let access = access.as_str(); let client_id = client_id.as_str(); let uid = uid.as_str();

        let (mut socket, _) = match tungstenite::connect(&url) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit("twitch-status", json!({"connected":false,"error":format!("WS connect failed: {}", e)}));
                url = "wss://eventsub.wss.twitch.tv/ws".to_string();
                for _ in 0..6 { if stop.load(Ordering::SeqCst) { return; } std::thread::sleep(Duration::from_millis(500)); }
                continue;
            }
        };
        match socket.get_ref() {
            tungstenite::stream::MaybeTlsStream::Plain(s) => { let _ = s.set_read_timeout(Some(Duration::from_millis(500))); }
            tungstenite::stream::MaybeTlsStream::Rustls(s) => { let _ = s.get_ref().set_read_timeout(Some(Duration::from_millis(500))); }
            _ => {}
        }
        let mut reconnect_url: Option<String> = None;
        let mut last_msg = Instant::now();
        loop {
            if stop.load(Ordering::SeqCst) { let _ = socket.close(None); return; }
            match socket.read() {
                Ok(Message::Text(txt)) => {
                    last_msg = Instant::now();
                    let v: Value = match serde_json::from_str(&txt) { Ok(x) => x, Err(_) => continue };
                    let mtype = v.get("metadata").and_then(|m| m.get("message_type")).and_then(|x| x.as_str()).unwrap_or("");
                    match mtype {
                        "session_welcome" => {
                            let sid = v["payload"]["session"]["id"].as_str().unwrap_or("").to_string();
                            // Redeems are the critical subscription — surface failure instead of silently showing "connected"
                            match subscribe(access, client_id, &sid, "channel.channel_points_custom_reward_redemption.add", "1", json!({"broadcaster_user_id":uid})) {
                                Ok(_)  => { let _ = app.emit("twitch-status", json!({"connected":true})); }
                                Err(e) => { let _ = app.emit("twitch-status", json!({"connected":false,"error":e})); }
                            }
                            // Goal tracking subscriptions (best-effort)
                            let _ = subscribe(access, client_id, &sid, "channel.follow", "2", json!({"broadcaster_user_id":uid,"moderator_user_id":uid}));
                            let _ = subscribe(access, client_id, &sid, "channel.subscribe", "1", json!({"broadcaster_user_id":uid}));
                            let _ = subscribe(access, client_id, &sid, "channel.subscription.gift", "1", json!({"broadcaster_user_id":uid}));
                            let _ = subscribe(access, client_id, &sid, "channel.subscription.message", "1", json!({"broadcaster_user_id":uid}));
                            let _ = subscribe(access, client_id, &sid, "channel.bits.use", "1", json!({"broadcaster_user_id":uid}));
                        }
                        "session_reconnect" => {
                            reconnect_url = v["payload"]["session"]["reconnect_url"].as_str().map(|s| s.to_string());
                            break;
                        }
                        "notification" => {
                            let sub_type = v["metadata"]["subscription_type"].as_str().unwrap_or("");
                            let ev = &v["payload"]["event"];
                            // Channel point redeems
                            if sub_type == "channel.channel_points_custom_reward_redemption.add" {
                                let _ = app.emit("twitch-redeem", json!({
                                    "reward_id":    ev["reward"]["id"],
                                    "reward_title": ev["reward"]["title"],
                                    "user_id":      ev["user_id"],
                                    "user_name":    ev["user_name"],
                                    "user_login":   ev["user_login"],
                                    "user_input":   ev["user_input"],
                                }));
                            }
                            // Goal: follow
                            if sub_type == "channel.follow" {
                                // Seed the follower cache immediately — the Helix followers
                                // endpoint can lag a real follow by several seconds, and a
                                // stale cached "false" would block follow-then-instantly-enter.
                                if let Some(fuid) = ev["user_id"].as_str() {
                                    let shared = app.state::<Shared>();
                                    shared.follower_cache.lock().unwrap()
                                        .insert(fuid.to_string(), (true, now_secs()));
                                }
                                let _ = app.emit("twitch-goal", json!({
                                    "kind": "follow",
                                    "user_name": ev["user_name"],
                                    "user_id": ev["user_id"],
                                    "amount": 1,
                                }));
                            }
                            // Goal: new sub (not gift)
                            if sub_type == "channel.subscribe" {
                                let is_gift = ev["is_gift"].as_bool().unwrap_or(false);
                                if !is_gift {
                                    let _ = app.emit("twitch-goal", json!({
                                        "kind": "sub",
                                        "user_name": ev["user_name"],
                                        "amount": 1,
                                    }));
                                }
                            }
                            // Goal: resub
                            if sub_type == "channel.subscription.message" {
                                let _ = app.emit("twitch-goal", json!({
                                    "kind": "sub",
                                    "user_name": ev["user_name"],
                                    "amount": 1,
                                }));
                            }
                            // Goal: gift subs (count each individually)
                            if sub_type == "channel.subscription.gift" {
                                let total = ev["total"].as_u64().unwrap_or(1);
                                let _ = app.emit("twitch-goal", json!({
                                    "kind": "sub",
                                    "user_name": ev["user_name"],
                                    "amount": total,
                                }));
                            }
                            // Goal: bits
                            if sub_type == "channel.bits.use" {
                                let bits = ev["bits"].as_u64().unwrap_or(0);
                                let _ = app.emit("twitch-goal", json!({
                                    "kind": "bits",
                                    "user_name": ev["user_name"],
                                    "amount": bits,
                                }));
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => { last_msg = Instant::now(); }
                Err(tungstenite::Error::Io(ref e)) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                    // Keepalive watchdog: Twitch sends a message at least every ~10s.
                    // Prolonged silence = half-open socket; tear down and reconnect.
                    if last_msg.elapsed() > EVENTSUB_SILENCE_TIMEOUT { break; }
                    continue;
                }
                Err(_) => break,
            }
        }
        match reconnect_url.take() {
            Some(u) => { url = u; continue; }
            None => {
                if stop.load(Ordering::SeqCst) { return; }
                for _ in 0..6 { if stop.load(Ordering::SeqCst) { return; } std::thread::sleep(Duration::from_millis(500)); }
                url = "wss://eventsub.wss.twitch.tv/ws".to_string();
            }
        }
    }
}

// ── Chat listener (IRC via TMI) ───────────────────────────────────────────────
// Uses Twitch IRC WebSocket for reading chat. This is the simplest way to read
// ! commands without requiring a bot account — we read as the broadcaster.

#[tauri::command]
pub fn twitch_connect_chat(app: tauri::AppHandle, shared: State<Shared>, channel: String) -> Result<(), String> {
    // Cheap up-front check for immediate UI feedback; the thread refreshes its own token.
    ensure_token(&shared)?;
    shared.chat_stop.store(false, Ordering::SeqCst);
    let stop = shared.chat_stop.clone();
    std::thread::spawn(move || { run_chat(&app, &channel, stop); });
    Ok(())
}

// Twitch IRC sends a server PING roughly every 5 minutes. We also send our own
// PING every 60s, so 3 minutes of total silence means the socket is dead.
const CHAT_PING_INTERVAL:    Duration = Duration::from_secs(60);
const CHAT_SILENCE_TIMEOUT:  Duration = Duration::from_secs(180);

fn run_chat(app: &tauri::AppHandle, channel: &str, stop: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    use tungstenite::Message;
    loop {
        if stop.load(Ordering::SeqCst) { return; }

        // Fresh token on every (re)connect — IRC PASS with an expired token
        // fails auth forever, so never reuse a captured one.
        let creds = {
            let shared = app.state::<Shared>();
            ensure_token(&shared).and_then(|(a, _)| validate(&a).map(|(_, login)| (a, login)))
        };
        let (access, login) = match creds {
            Ok(x) => x,
            Err(_) => {
                for _ in 0..20 { if stop.load(Ordering::SeqCst) { return; } std::thread::sleep(Duration::from_millis(500)); }
                continue;
            }
        };

        let (mut socket, _) = match tungstenite::connect("wss://irc-ws.chat.twitch.tv:443") {
            Ok(s) => s,
            Err(_) => {
                for _ in 0..6 { if stop.load(Ordering::SeqCst) { return; } std::thread::sleep(Duration::from_millis(500)); }
                continue;
            }
        };
        match socket.get_ref() {
            tungstenite::stream::MaybeTlsStream::Plain(s) => { let _ = s.set_read_timeout(Some(Duration::from_millis(500))); }
            tungstenite::stream::MaybeTlsStream::Rustls(s) => { let _ = s.get_ref().set_read_timeout(Some(Duration::from_millis(500))); }
            _ => {}
        }
        // authenticate
        let _ = socket.send(Message::Text(format!("PASS oauth:{}", access)));
        let _ = socket.send(Message::Text(format!("NICK {}", login)));
        let _ = socket.send(Message::Text("CAP REQ :twitch.tv/tags twitch.tv/commands".to_string()));
        let chan = if channel.starts_with('#') { channel.to_string() } else { format!("#{}", channel) };
        let _ = socket.send(Message::Text(format!("JOIN {}", chan)));

        let mut last_msg  = Instant::now();
        let mut last_ping = Instant::now();
        loop {
            if stop.load(Ordering::SeqCst) { let _ = socket.close(None); return; }
            match socket.read() {
                Ok(Message::Text(txt)) => {
                    last_msg = Instant::now();
                    // PING keepalive
                    if txt.starts_with("PING") {
                        let _ = socket.send(Message::Text(txt.replace("PING", "PONG")));
                        continue;
                    }
                    // Parse PRIVMSG
                    if let Some(msg) = parse_irc(&txt) {
                        let _ = app.emit("twitch-chat", msg);
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => { last_msg = Instant::now(); }
                Err(tungstenite::Error::Io(ref e)) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                    // Half-open detection: ping periodically; break on prolonged silence
                    if last_msg.elapsed() > CHAT_SILENCE_TIMEOUT { break; }
                    if last_ping.elapsed() > CHAT_PING_INTERVAL {
                        last_ping = Instant::now();
                        if socket.send(Message::Text("PING :spark".to_string())).is_err() { break; }
                    }
                    continue;
                }
                Err(_) => break,
            }
        }
        if stop.load(Ordering::SeqCst) { return; }
        for _ in 0..6 { if stop.load(Ordering::SeqCst) { return; } std::thread::sleep(Duration::from_millis(500)); }
    }
}

fn parse_irc(raw: &str) -> Option<Value> {
    // Parse Twitch IRC tags + PRIVMSG
    // Format: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
    let mut tags: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    let rest = if raw.starts_with('@') {
        let (tag_str, rest) = raw[1..].split_once(' ')?;
        for part in tag_str.split(';') {
            if let Some((k, v)) = part.split_once('=') { tags.insert(k, v); }
        }
        rest
    } else { raw };

    if !rest.contains("PRIVMSG") { return None; }

    let prefix_end = rest.find(' ')?;
    let prefix = &rest[1..prefix_end]; // user!user@...
    let username = prefix.split('!').next().unwrap_or("");
    let after_prefix = &rest[prefix_end+1..];
    // after_prefix: "PRIVMSG #channel :message"
    let msg_start = after_prefix.find(" :")?;
    let message = &after_prefix[msg_start+2..];
    let user_id = tags.get("user-id").copied().unwrap_or("");
    let display = tags.get("display-name").copied().unwrap_or(username);
    let is_mod = tags.get("mod").copied().unwrap_or("0") == "1";
    let is_sub = tags.get("subscriber").copied().unwrap_or("0") == "1";
    let badges = tags.get("badges").copied().unwrap_or("");
    let is_broadcaster = badges.contains("broadcaster");
    let is_vip = badges.contains("vip");
    let color = tags.get("color").copied().unwrap_or("");
    // Per-message emote ranges ("id:start-end,start-end/id:...") — covers
    // emotes from ANY channel, since Twitch identifies them per message.
    let emotes = tags.get("emotes").copied().unwrap_or("");

    Some(json!({
        "username":    username,
        "display":     display,
        "user_id":     user_id,
        "message":     message.trim_end(),
        "is_mod":      is_mod,
        "is_sub":      is_sub,
        "is_vip":      is_vip,
        "is_broadcaster": is_broadcaster,
        "color":       color,
        "emotes":      emotes,
    }))
}

// ── Send chat message ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn twitch_send_chat_message(shared: State<Shared>, message: String) -> Result<(), String> {
    let (access, client_id) = ensure_token(&shared)?;
    let (uid, _) = identity(&shared, &access)?;
    let c = reqwest::blocking::Client::new();
    let r = c.post("https://api.twitch.tv/helix/chat/messages")
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .json(&json!({
            "broadcaster_id": uid,
            "sender_id":      uid,
            "message":        message,
        }))
        .send().map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        let v: Value = r.json().unwrap_or(json!({}));
        return Err(v.get("message").and_then(|x| x.as_str()).unwrap_or("Failed to send").to_string());
    }
    Ok(())
}

// ── Goals: fetch follower count and channel emotes ────────────────────────────

#[tauri::command]
pub fn twitch_get_follower_count(shared: State<Shared>, broadcaster_id: String) -> Result<u64, String> {
    let (access, client_id) = ensure_token(&shared)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/channels/followers")
        .query(&[("broadcaster_id", broadcaster_id.as_str())])
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    let v: Value = r.json().map_err(|e| e.to_string())?;
    Ok(v.get("total").and_then(|x| x.as_u64()).unwrap_or(0))
}

#[tauri::command]
pub fn twitch_get_channel_emotes(shared: State<Shared>, broadcaster_id: String) -> Result<Value, String> {
    let (access, client_id) = ensure_token(&shared)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/chat/emotes")
        .query(&[("broadcaster_id", broadcaster_id.as_str())])
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Ok(json!({"emotes":[]}));
    }
    let v: Value = r.json().map_err(|e| e.to_string())?;
    let emotes: Vec<Value> = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default()
        .into_iter().map(|e| json!({
            "id":   e.get("id").cloned().unwrap_or(Value::Null),
            "name": e.get("name").cloned().unwrap_or(Value::Null),
            "url":  e.get("images").and_then(|i| i.get("url_1x")).cloned().unwrap_or(Value::Null),
        })).collect();
    Ok(json!({"emotes": emotes}))
}

#[tauri::command]
pub fn twitch_get_global_emotes(shared: State<Shared>) -> Result<Value, String> {
    let (access, client_id) = ensure_token(&shared)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/chat/emotes/global")
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Ok(json!({"emotes":[]}));
    }
    let v: Value = r.json().map_err(|e| e.to_string())?;
    let emotes: Vec<Value> = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default()
        .into_iter().map(|e| json!({
            "id":   e.get("id").cloned().unwrap_or(Value::Null),
            "name": e.get("name").cloned().unwrap_or(Value::Null),
            "url":  e.get("images").and_then(|i| i.get("url_1x")).cloned().unwrap_or(Value::Null),
        })).collect();
    Ok(json!({"emotes": emotes}))
}

// ── Get user profile picture ──────────────────────────────────────────────────

#[tauri::command]
pub fn twitch_get_user_info(shared: State<Shared>, user_id: String) -> Result<Value, String> {
    let (access, client_id) = ensure_token(&shared)?;
    let c = reqwest::blocking::Client::new();
    let r = c.get("https://api.twitch.tv/helix/users")
        .query(&[("id", user_id.as_str())])
        .header("Authorization", format!("Bearer {}", access))
        .header("Client-Id", &client_id)
        .send().map_err(|e| e.to_string())?;
    let v: Value = r.json().map_err(|e| e.to_string())?;
    let user = v.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()).cloned()
        .unwrap_or(json!({}));
    Ok(json!({
        "id":           user.get("id").cloned().unwrap_or(Value::Null),
        "login":        user.get("login").cloned().unwrap_or(Value::Null),
        "display_name": user.get("display_name").cloned().unwrap_or(Value::Null),
        "profile_image_url": user.get("profile_image_url").cloned().unwrap_or(Value::Null),
    }))
}
