//! PTY sessions: one portable-pty session per terminal pane, output streamed as raw bytes
//! over a per-session IPC Channel with ack-based flow control (PLAN: Akış kontrolü).

#[cfg(windows)]
mod job;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, State};

/// Env vars that would make a CLI bill an API key instead of the user's subscription login.
pub const STRIPPED_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
];

/// Session markers of a parent Claude Code process. If Cockpit itself was started from a Claude
/// terminal, children must not inherit them (they disable transcript saving / resume, and
/// MESSAGING_TOKEN is that session's secret). User config vars (e.g. CLAUDE_CODE_GIT_BASH_PATH) stay.
pub const PARENT_SESSION_ENV: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_CHILD_NOTES_DIR",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
];

/// Unacked bytes above this pause the PTY reader until the frontend drains below LOW_WATER.
const HIGH_WATER: usize = 1 << 20;
const LOW_WATER: usize = 256 << 10;
/// Output is coalesced for at most this long (or BATCH_MAX bytes) before one IPC send.
const BATCH_WINDOW: Duration = Duration::from_millis(8);
const BATCH_MAX: usize = 256 << 10;

#[derive(Default)]
struct Flow {
    pending: Mutex<usize>,
    cv: Condvar,
    closed: AtomicBool,
}

impl Flow {
    fn add(&self, n: usize) {
        let mut p = self.pending.lock().unwrap();
        *p += n;
        if *p > HIGH_WATER {
            while *p > LOW_WATER && !self.closed.load(Ordering::Relaxed) {
                p = self.cv.wait(p).unwrap();
            }
        }
    }
    fn ack(&self, n: usize) {
        let mut p = self.pending.lock().unwrap();
        *p = p.saturating_sub(n);
        if *p <= LOW_WATER {
            self.cv.notify_all();
        }
    }
    fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
        self.cv.notify_all();
    }
}

struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    flow: Arc<Flow>,
}

#[derive(Default)]
struct Sessions(Mutex<HashMap<String, Arc<Session>>>);

impl Sessions {
    fn get(&self, id: &str) -> Result<Arc<Session>, String> {
        self.0.lock().unwrap().get(id).cloned().ok_or_else(|| format!("no pty session {id}"))
    }
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<u32>,
}

fn on_path(exe: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(exe).is_file()))
        .unwrap_or(false)
}

#[cfg(windows)]
fn default_shell() -> CommandBuilder {
    let exe = if on_path("pwsh.exe") { "pwsh.exe" } else { "powershell.exe" };
    let mut c = CommandBuilder::new(exe);
    c.arg("-NoLogo");
    c
}

#[cfg(not(windows))]
fn default_shell() -> CommandBuilder {
    let _ = on_path; // used on Windows only
    // Login shell so PATH from the user's profile is present even when launched from Finder.
    let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut c = CommandBuilder::new(sh);
    c.arg("-l");
    c
}

#[cfg(windows)]
fn in_shell(line: &str) -> CommandBuilder {
    let mut c = default_shell();
    c.args(["-NoExit", "-Command", line]);
    c
}

#[cfg(not(windows))]
fn in_shell(line: &str) -> CommandBuilder {
    let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut c = CommandBuilder::new(&sh);
    c.args(["-l", "-i", "-c", &format!("{line}; exec \"$SHELL\" -l")]);
    c
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
async fn spawn<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Sessions>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    program: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    shell_line: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("invalid session id".into());
    }
    if state.0.lock().unwrap().contains_key(&id) {
        return Err(format!("pty session {id} already exists"));
    }
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;

    let mut cmd = match (program, shell_line) {
        (Some(argv), _) if !argv.is_empty() => {
            let mut c = CommandBuilder::new(&argv[0]);
            c.args(&argv[1..]);
            c
        }
        // Agents run inside the user's shell (PATH, .cmd shims) and leave the shell open after exit.
        (_, Some(line)) => in_shell(&line),
        _ => default_shell(),
    };
    match cwd.filter(|d| Path::new(d).is_dir()) {
        Some(dir) => cmd.cwd(dir),
        None => {
            if let Ok(home) = app.path().home_dir() {
                cmd.cwd(home)
            }
        }
    }
    for k in STRIPPED_ENV.iter().chain(PARENT_SESSION_ENV) {
        cmd.env_remove(k);
    }
    let env = env.unwrap_or_default();
    if env.contains_key(crate::hooks::ENV_TOKEN) {
        // Hook commands are the constant `cockpit --hook <provider>`; make `cockpit` resolvable.
        if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
            let mut paths = vec![dir];
            if let Some(p) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&p));
            }
            if let Ok(joined) = std::env::join_paths(paths) {
                cmd.env("PATH", joined);
            }
        }
    }
    for (k, v) in env {
        if !STRIPPED_ENV.iter().any(|s| s.eq_ignore_ascii_case(&k)) {
            cmd.env(k, v);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "ai-dev-cockpit");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        job::assign(pid);
    }

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let flow = Arc::new(Flow::default());
    let session = Arc::new(Session {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(child.clone_killer()),
        flow: flow.clone(),
    });
    // Session is registered before reading starts, so the frontend can answer ESC[6n at once.
    state.0.lock().unwrap().insert(id.clone(), session);

    // Waiter: on child exit drop the session, which closes the PTY and lets the reader hit EOF.
    let waiter = {
        let app = app.clone();
        let id = id.clone();
        let flow = flow.clone();
        thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            app.state::<Sessions>().0.lock().unwrap().remove(&id);
            flow.close();
            code
        })
    };

    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(64);
    {
        let flow = flow.clone();
        thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                        flow.add(n);
                    }
                }
            }
        });
    }

    thread::spawn(move || {
        while let Ok(mut out) = rx.recv() {
            let deadline = Instant::now() + BATCH_WINDOW;
            while out.len() < BATCH_MAX {
                let left = deadline.saturating_duration_since(Instant::now());
                match rx.recv_timeout(left) {
                    Ok(chunk) => out.extend_from_slice(&chunk),
                    Err(_) => break,
                }
            }
            if on_data.send(InvokeResponseBody::Raw(out)).is_err() {
                break;
            }
        }
        drop(rx);
        let code = waiter.join().ok().flatten();
        let _ = app.emit("pty:exit", ExitPayload { id, code });
    });
    Ok(())
}

#[tauri::command]
async fn write(state: State<'_, Sessions>, id: String, data: String) -> Result<(), String> {
    let s = state.get(&id)?;
    let mut w = s.writer.lock().unwrap();
    w.write_all(data.as_bytes()).and_then(|_| w.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn resize(state: State<'_, Sessions>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let s = state.get(&id)?;
    let r = s.master.lock().unwrap().resize(size(cols, rows));
    r.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ack(state: State<'_, Sessions>, id: String, bytes: usize) -> Result<(), String> {
    state.get(&id)?.flow.ack(bytes);
    Ok(())
}

#[tauri::command]
async fn kill(state: State<'_, Sessions>, id: String) -> Result<(), String> {
    let s = state.get(&id)?;
    let r = s.killer.lock().unwrap().kill();
    r.map_err(|e| e.to_string())
}

fn kill_all<R: Runtime>(app: &AppHandle<R>) {
    let sessions: Vec<_> = app.state::<Sessions>().0.lock().unwrap().values().cloned().collect();
    for s in sessions {
        let _ = s.killer.lock().unwrap().kill();
        s.flow.close();
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pty")
        .invoke_handler(tauri::generate_handler![spawn, write, resize, ack, kill])
        .setup(|app, _| {
            // A parent that ignores Ctrl+C (some launchers/shells do) passes that flag on to every
            // child, so \x03 from the terminal would never interrupt. Clear it before any spawn.
            #[cfg(windows)]
            unsafe {
                windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
            }
            app.manage(Sessions::default());
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                kill_all(app);
            }
        })
        .build()
}
