use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::Manager;
use tiny_http::{Server, Response, Header};
use crate::Shared;

// Overlay pages compiled in at build time
const MASTER_HTML:   &str = include_str!("../../dist/overlays/master.html");
const WHEEL_HTML:    &str = include_str!("../../dist/overlays/wheel.html");
const GIVEAWAY_HTML: &str = include_str!("../../dist/overlays/giveaway.html");
const TIMERS_HTML:   &str = include_str!("../../dist/overlays/timers.html");
const TASKS_HTML:    &str = include_str!("../../dist/overlays/tasks.html");
const POMODORO_HTML: &str = include_str!("../../dist/overlays/pomodoro.html");
const GOALS_HTML:    &str = include_str!("../../dist/overlays/goals.html");
const CHECKINS_HTML:   &str = include_str!("../../dist/overlays/checkins.html");
const NOWPLAYING_HTML: &str = include_str!("../../dist/overlays/nowplaying.html");
const SRQUEUE_HTML:    &str = include_str!("../../dist/overlays/srqueue.html");
const CHAT_HTML:       &str = include_str!("../../dist/overlays/chat.html");
const COUNTERS_HTML:   &str = include_str!("../../dist/overlays/counters.html");
const CREDITS_HTML:    &str = include_str!("../../dist/overlays/credits.html");
const WHEEL_JS:      &str = include_str!("../../dist/js/wheel.js");
const OVERLAY_JS:    &str = include_str!("../../dist/js/overlay-common.js");
const BAR_RENDERER:  &str = include_str!("../../dist/js/bar-renderer.js");
const CHAT_DEFAULTS: &str = include_str!("../../dist/js/chat-defaults.js");
const CREDITS_DEFAULTS: &str = include_str!("../../dist/js/credits-defaults.js");

pub fn start_server(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut server: Option<Server> = None;
        let mut chosen = 0u16;
        for port in 4747..4797u16 {
            match Server::http(("127.0.0.1", port)) {
                Ok(s) => { server = Some(s); chosen = port; break; }
                Err(_) => continue,
            }
        }
        let server = match server { Some(s) => s, None => return };
        app.state::<Shared>().server_port.store(chosen as u64, Ordering::SeqCst);
        let server = std::sync::Arc::new(server);
        let mut workers = Vec::new();
        for _ in 0..8 {
            let server = server.clone();
            let app = app.clone();
            workers.push(std::thread::spawn(move || {
                loop {
                    match server.recv() {
                        Ok(r) => handle(&app, r),
                        Err(_) => break,
                    }
                }
            }));
        }
        for w in workers { let _ = w.join(); }
    });
}

fn html(req: tiny_http::Request, body: &str) {
    let mut r = Response::from_string(body);
    r.add_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
    r.add_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
    let _ = req.respond(r);
}
fn js(req: tiny_http::Request, body: &str) {
    let h = Header::from_bytes(&b"Content-Type"[..], &b"text/javascript; charset=utf-8"[..]).unwrap();
    let _ = req.respond(Response::from_string(body).with_header(h));
}
fn json_resp(req: tiny_http::Request, body: String) {
    let mut r = Response::from_string(body);
    r.add_header(Header::from_bytes(&b"Content-Type"[..],    &b"application/json"[..]).unwrap());
    r.add_header(Header::from_bytes(&b"Cache-Control"[..],   &b"no-store"[..]).unwrap());
    r.add_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
    let _ = req.respond(r);
}

fn handle(app: &tauri::AppHandle, request: tiny_http::Request) {
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/");

    // CORS preflight
    if request.method() == &tiny_http::Method::Options {
        let mut r = Response::from_string("").with_status_code(204);
        r.add_header(Header::from_bytes("Access-Control-Allow-Origin","*").unwrap());
        r.add_header(Header::from_bytes("Access-Control-Allow-Methods","GET,POST,OPTIONS").unwrap());
        r.add_header(Header::from_bytes("Access-Control-Allow-Headers","Content-Type,Authorization").unwrap());
        let _ = request.respond(r);
        return;
    }
    let shared = app.state::<Shared>();

    match path {
        "/"         | "/master"   => { html(request, MASTER_HTML);   return; }
        "/wheel"                  => { html(request, WHEEL_HTML);     return; }
        "/giveaway"               => { html(request, GIVEAWAY_HTML);  return; }
        "/timers"                 => { html(request, TIMERS_HTML);    return; }
        "/tasks"                  => { html(request, TASKS_HTML);     return; }
        "/pomodoro"               => { html(request, POMODORO_HTML);  return; }
        "/goals"                  => { html(request, GOALS_HTML);     return; }
        "/checkins"               => { html(request, CHECKINS_HTML);  return; }
        "/nowplaying"             => { html(request, NOWPLAYING_HTML); return; }
        "/srqueue"                => { html(request, SRQUEUE_HTML);    return; }
        "/chat"                   => { html(request, CHAT_HTML);      return; }
        "/counters"               => { html(request, COUNTERS_HTML);  return; }
        "/credits"                => { html(request, CREDITS_HTML);  return; }
        "/js/wheel.js"            => { js(request, WHEEL_JS);         return; }
        "/js/overlay-common.js"   => { js(request, OVERLAY_JS);       return; }
        "/js/bar-renderer.js"     => { js(request, BAR_RENDERER);     return; }
        "/js/chat-defaults.js"    => { js(request, CHAT_DEFAULTS);    return; }
        "/js/credits-defaults.js" => { js(request, CREDITS_DEFAULTS); return; }
        _ => {}
    }

    if path == "/events" {
        // ?since=N&tool=wheel (tool filter optional)
        let qs = url.split('?').nth(1).unwrap_or("");
        let since: u64 = qs.split('&').find(|s| s.starts_with("since="))
            .and_then(|s| s[6..].parse().ok()).unwrap_or(0);
        let tool_filter: Option<String> = qs.split('&').find(|s| s.starts_with("tool="))
            .map(|s| s[5..].to_string());

        let deadline = Instant::now() + Duration::from_secs(25);
        let body;
        loop {
            let (events, snapshot, latest) = {
                let q = shared.overlay_events.lock().unwrap();
                let latest = shared.overlay_seq.load(Ordering::SeqCst);
                let evs: Vec<serde_json::Value> = q.iter()
                    .filter(|(id, _)| *id > since)
                    .filter(|(_, payload)| {
                        if let Some(ref tf) = tool_filter {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                                return v.get("_tool").and_then(|x| x.as_str()).unwrap_or("") == tf;
                            }
                        }
                        true
                    })
                    .map(|(_, payload)| serde_json::from_str(payload).unwrap_or(serde_json::json!({})))
                    .collect();

                // build snapshot for first connect
                let snap = if since == 0 {
                    let tool = tool_filter.as_deref().unwrap_or("master");
                    match tool {
                        "wheel"    => shared.overlay_wheel.lock().unwrap().clone(),
                        "giveaway" => shared.overlay_giveaway.lock().unwrap().clone(),
                        "timers"   => shared.overlay_timers.lock().unwrap().clone(),
                        "tasks"    => shared.overlay_tasks.lock().unwrap().clone(),
                        "pomodoro" => shared.overlay_pomodoro.lock().unwrap().clone(),
                        "goals"    => shared.overlay_goals.lock().unwrap().clone(),
                        "checkins" => shared.overlay_checkins.lock().unwrap().clone(),
                        "srqueue"  => shared.overlay_srqueue.lock().unwrap().clone(),
                        "chat"     => shared.overlay_chat.lock().unwrap().clone(),
                        "counters" => shared.overlay_counters.lock().unwrap().clone(),
                        "credits"  => shared.overlay_credits.lock().unwrap().clone(),
                        _ => {
                            let vis = shared.tool_visibility.lock().unwrap().clone();
                            serde_json::json!({ "visibility": vis }).to_string()
                        }
                    }
                } else { String::new() };
                (evs, snap, latest)
            };

            let now = Instant::now();
            if !events.is_empty() || since == 0 || now >= deadline {
                let snap_val: serde_json::Value = if !snapshot.is_empty() {
                    serde_json::from_str(&snapshot).unwrap_or(serde_json::Value::Null)
                } else { serde_json::Value::Null };
                body = serde_json::json!({
                    "latest": latest,
                    "events": events,
                    "snapshot": snap_val,
                }).to_string();
                break;
            }
            // Block until a new event is pushed (condvar notify) or the deadline
            // passes — no more 250ms polling loop. Spurious wakeups just re-check.
            let wait = (deadline - now).min(Duration::from_secs(5));
            let guard = shared.overlay_wake_lock.lock().unwrap();
            let _ = shared.overlay_wake.wait_timeout(guard, wait).unwrap();
        }
        json_resp(request, body);
        return;
    }

    let _ = request.respond(Response::from_string("not found").with_status_code(404));
}
