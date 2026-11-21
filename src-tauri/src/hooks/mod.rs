//! Agent hook listener. CLIs (Claude Code, Codex, Gemini) run `cockpit --hook <provider>` as a hook
//! command; it POSTs the hook JSON to 127.0.0.1:<port> with the pane's token, and the event is
//! forwarded to the UI as `agent:hook`. Trust boundary rules (PLAN: Hook dinleyicisi): POST only,
//! no Origin header, exact Host, <=64 KB body, known token. Bodies (prompts) are never logged.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const ENV_PORT: &str = "COCKPIT_HOOK_PORT";
pub const ENV_TOKEN: &str = "COCKPIT_HOOK_TOKEN";
const MAX_BODY: usize = 64 * 1024;
const MAX_HEAD: usize = 8 * 1024;

struct Hooks {
    port: u16,
    dir: PathBuf,
    sessions: Mutex<HashMap<String, String>>, // token -> pane id
}

#[derive(Debug, Default)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>, // names lowercased
    pub body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

/// Parses one HTTP/1.1 request; Err carries the status code to answer with.
pub fn read_request(stream: impl Read) -> Result<Request, u16> {
    let mut r = BufReader::new(stream.take((MAX_HEAD + MAX_BODY + 1) as u64));
    let mut line = String::new();
    let mut head = 0usize;
    let mut next = |r: &mut BufReader<_>, line: &mut String| -> Result<(), u16> {
        line.clear();
        let n = r.read_line(line).map_err(|_| 400u16)?;
        head += n;
        if n == 0 || head > MAX_HEAD { Err(400) } else { Ok(()) }
    };
    next(&mut r, &mut line)?;
    let mut parts = line.split_whitespace();
    let mut req = Request {
        method: parts.next().ok_or(400u16)?.to_string(),
        path: parts.next().ok_or(400u16)?.to_string(),
        ..Default::default()
    };
    loop {
        next(&mut r, &mut line)?;
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        let (k, v) = l.split_once(':').ok_or(400u16)?;
        req.headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
    }
    let len: usize = req.header("content-length").unwrap_or("0").parse().map_err(|_| 400u16)?;
    if len > MAX_BODY {
        return Err(413);
    }
    req.body = vec![0; len];
    r.read_exact(&mut req.body).map_err(|_| 400u16)?;
    Ok(req)
}

/// Request rules independent of session state; returns the token.
pub fn check(req: &Request, port: u16) -> Result<&str, u16> {
    if req.method != "POST" {
        return Err(405);
    }
    if req.path != "/hook" {
        return Err(404);
    }
    // Browsers always send Origin on cross-origin POSTs; hook commands never do.
    if req.header("origin").is_some() {
        return Err(403);
    }
    if req.header("host") != Some(format!("127.0.0.1:{port}").as_str()) {
        return Err(403);
    }
    req.header("x-cockpit-token").filter(|t| !t.is_empty()).ok_or(403)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookEvent {
    pane_id: String,
    provider: String,
    event: Option<String>,
    notification_type: Option<String>,
    session_id: Option<String>,
}

fn str_field(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str)).map(|s| s.chars().take(128).collect())
}

fn handle<R: Runtime>(app: &AppHandle<R>, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let hooks = app.state::<Hooks>();
    let status = (|| {
        let req = read_request(&stream)?;
        let token = check(&req, hooks.port)?;
        let pane_id = hooks.sessions.lock().unwrap().get(token).cloned().ok_or(403u16)?;
        let body: Value = serde_json::from_slice(&req.body).map_err(|_| 400u16)?;
        let provider: String = req
            .header("x-cockpit-provider")
            .unwrap_or("unknown")
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(16)
            .collect();
        // Antigravity payloads carry no event name: the forwarder passes it as X-Cockpit-Event.
        let header_event = req.header("x-cockpit-event").map(|e| e.chars().filter(char::is_ascii_alphanumeric).take(32).collect::<String>());
        let _ = app.emit(
            "agent:hook",
            HookEvent {
                pane_id,
                provider,
                event: header_event.or_else(|| str_field(&body, &["hook_event_name", "type"])),
                notification_type: str_field(&body, &["notification_type"]),
                session_id: str_field(&body, &["session_id", "thread-id", "thread_id", "conversationId"]),
            },
        );
        Ok::<u16, u16>(204)
    })()
    .unwrap_or_else(|e| e);
    let reason = match status { 204 => "No Content", 403 => "Forbidden", 404 => "Not Found", 405 => "Method Not Allowed", 413 => "Payload Too Large", _ => "Bad Request" };
    let _ = write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
}

fn random_token() -> String {
    let mut b = [0u8; 24];
    getrandom::fill(&mut b).expect("os rng");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[derive(Serialize)]
struct Registration {
    port: u16,
    token: String,
    /// Absolute path of this executable, forward slashes (works in bash, PowerShell and cmd).
    exe: String,
}

#[tauri::command]
async fn register(state: State<'_, Hooks>, pane_id: String) -> Result<Registration, String> {
    let token = random_token();
    state.sessions.lock().unwrap().insert(token.clone(), pane_id);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(Registration { port: state.port, token, exe: exe.to_string_lossy().replace('\\', "/") })
}

/// Writes a per-session CLI config file under app data (never into the project repo).
#[tauri::command]
async fn write_config(state: State<'_, Hooks>, token: String, name: String, contents: String) -> Result<String, String> {
    if !state.sessions.lock().unwrap().contains_key(&token) {
        return Err("unknown session".into());
    }
    let ok = |s: &str| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) && !s.starts_with('.');
    if !ok(&name) || !ok(&token) {
        return Err("invalid name".into());
    }
    let dir = state.dir.join(&token);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Antigravity CLI only reads hooks from files, so a single "cockpit-status" entry is merged into the
/// user's global ~/.gemini/config/hooks.json (other entries untouched, original backed up once).
/// Outside Cockpit the forwarder sees no token and exits 0, so the entry is inert there.
#[tauri::command]
async fn ensure_antigravity_hooks<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let path = app.path().home_dir().map_err(|e| e.to_string())?.join(".gemini").join("config").join("hooks.json");
    let original = std::fs::read_to_string(&path).ok();
    let mut root: serde_json::Map<String, Value> = match &original {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).map_err(|e| format!("{}: {e} (not modified)", path.display()))?,
        _ => Default::default(),
    };
    let handler = |event: &str| serde_json::json!([{ "type": "command", "command": format!("cockpit --hook antigravity {event}"), "timeout": 10 }]);
    let entry = serde_json::json!({
        "enabled": true,
        "SessionStart": handler("SessionStart"),
        "PreInvocation": handler("PreInvocation"),
        "Stop": handler("Stop"),
    });
    if root.get("cockpit-status") == Some(&entry) {
        return Ok(());
    }
    if let Some(s) = &original {
        let backup = path.with_extension("json.cockpit-backup");
        if !backup.exists() {
            std::fs::write(&backup, s).map_err(|e| e.to_string())?;
        }
    }
    root.insert("cockpit-status".into(), entry);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string_pretty(&root).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn unregister(state: State<'_, Hooks>, token: String) -> Result<(), String> {
    if state.sessions.lock().unwrap().remove(&token).is_some() && token.chars().all(|c| c.is_ascii_hexdigit()) {
        let _ = std::fs::remove_dir_all(state.dir.join(&token));
    }
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hooks")
        .invoke_handler(tauri::generate_handler![register, write_config, unregister, ensure_antigravity_hooks])
        .setup(|app, _| {
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            let dir = app.path().app_data_dir()?.join("hook-sessions");
            let _ = std::fs::remove_dir_all(&dir); // stale configs from a crashed run
            std::fs::create_dir_all(&dir)?;
            app.manage(Hooks { port, dir, sessions: Mutex::default() });
            let app = app.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let app = app.clone();
                    std::thread::spawn(move || handle(&app, stream));
                }
            });
            Ok(())
        })
        .build()
}

/// `cockpit --hook <provider> [event|json]`: forward hook JSON (stdin, or Codex's legacy notify argv)
/// to the running app. Always exits 0 and prints nothing: hook stdout can become agent context.
pub fn forward(args: &[String]) -> i32 {
    let (Ok(port), Ok(token)) = (std::env::var(ENV_PORT), std::env::var(ENV_TOKEN)) else { return 0 };
    let provider = args.first().map(String::as_str).unwrap_or("unknown");
    let event = args.get(1).filter(|a| !a.starts_with('{')).cloned().unwrap_or_default();
    let body = match args.get(1).filter(|a| a.starts_with('{')) {
        Some(json) => json.as_bytes().to_vec(),
        None => {
            let mut b = Vec::new();
            let _ = std::io::stdin().take(MAX_BODY as u64).read_to_end(&mut b);
            b
        }
    };
    let Ok(port) = port.parse::<u16>() else { return 0 };
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) {
        let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
        let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
        let head = format!(
            "POST /hook HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Cockpit-Token: {token}\r\nX-Cockpit-Provider: {provider}\r\nX-Cockpit-Event: {event}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = s.write_all(head.as_bytes()).and_then(|_| s.write_all(&body));
        let _ = s.read(&mut [0u8; 64]);
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(raw: &str) -> Result<Request, u16> {
        read_request(raw.as_bytes())
    }
    const OK: &str = "POST /hook HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nX-Cockpit-Token: abc\r\nContent-Length: 2\r\n\r\n{}";

    #[test]
    fn accepts_valid_request() {
        let r = req(OK).unwrap();
        assert_eq!(check(&r, 4000), Ok("abc"));
        assert_eq!(r.body, b"{}");
    }

    #[test]
    fn rejects_browser_origin_wrong_host_method_and_missing_token() {
        let with = |extra: &str| req(&OK.replacen("\r\n\r\n", &format!("\r\n{extra}\r\n\r\n"), 1)).unwrap();
        assert_eq!(check(&with("Origin: https://evil.example"), 4000), Err(403));
        assert_eq!(check(&req(OK).unwrap(), 4001), Err(403)); // host/port mismatch (DNS rebinding)
        assert_eq!(check(&req(&OK.replace("POST", "GET")).unwrap(), 4000), Err(405));
        assert_eq!(check(&req(&OK.replace("X-Cockpit-Token: abc\r\n", "")).unwrap(), 4000), Err(403));
        assert_eq!(check(&req(&OK.replace("/hook", "/x")).unwrap(), 4000), Err(404));
    }

    #[test]
    fn rejects_oversized_body() {
        let big = format!("POST /hook HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nContent-Length: {}\r\n\r\n", MAX_BODY + 1);
        assert_eq!(req(&big).err(), Some(413));
    }
}
