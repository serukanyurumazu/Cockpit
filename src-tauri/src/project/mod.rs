//! Project dashboard backend: git status, Unity Editor.log tail, TASKS.md.
//! Watching is polling-based on purpose: a recursive watcher on a Unity project drowns in
//! Library/ and Temp/ events (PLAN: dosya izleyici fırtınası).

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::ipc::Channel;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime, State};

const TAIL_BACKLOG: u64 = 64 * 1024;
const TAIL_READ_MAX: usize = 1 << 20;

#[derive(Default)]
struct Tails(Mutex<HashMap<String, Arc<AtomicBool>>>);

fn project_dir(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if p.is_dir() { Ok(p) } else { Err(format!("not a folder: {path}")) }
}

fn git(dir: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash from a GUI app
    }
    c
}

/// Raw `git status --porcelain=v2 --branch` (parsed in the frontend).
#[tauri::command]
async fn git_status(path: String, untracked: bool) -> Result<String, String> {
    let dir = project_dir(&path)?;
    let out = git(&dir)
        .args(["status", "--porcelain=v2", "--branch", if untracked { "--untracked-files=normal" } else { "--untracked-files=no" }])
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn mtime(p: &Path) -> u128 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0)
}

/// Cheap change stamp: mtimes of .git/index and .git/HEAD (and the worktree folder itself).
#[tauri::command]
async fn git_stamp(path: String) -> Result<String, String> {
    let dir = project_dir(&path)?;
    let g = dir.join(".git");
    Ok(format!("{}-{}-{}", mtime(&g.join("index")), mtime(&g.join("HEAD")), mtime(&dir)))
}

#[tauri::command]
fn unity_default_log<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    #[cfg(windows)]
    let p = app.path().local_data_dir().map_err(|e| e.to_string())?.join("Unity").join("Editor").join("Editor.log");
    #[cfg(not(windows))]
    let p = app.path().home_dir().map_err(|e| e.to_string())?.join("Library/Logs/Unity/Editor.log");
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn is_unity_project(path: String) -> bool {
    let p = Path::new(&path);
    p.join("Assets").is_dir() && p.join("ProjectSettings").is_dir()
}

/// Follows a log file. Messages: {text} with complete lines, or {reset: true} when the file was
/// truncated or replaced (Unity rewrites Editor.log on every editor start).
#[tauri::command]
async fn tail_start(state: State<'_, Tails>, id: String, path: String, on_data: Channel<Value>) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(old) = state.0.lock().unwrap().insert(id, stop.clone()) {
        old.store(true, Ordering::Relaxed);
    }
    std::thread::spawn(move || tail_loop(PathBuf::from(path), stop, on_data));
    Ok(())
}

// shortcut: NTFS "file tunneling" keeps the creation time when a file is deleted and recreated within
// ~15 s, so a fast replace is only caught via the size drop (Unity's new log starts small); add a
// file-index check if a replaced log is ever read from a stale offset.
fn identity(m: &std::fs::Metadata) -> Option<SystemTime> {
    m.created().ok()
}

fn tail_loop(path: PathBuf, stop: Arc<AtomicBool>, out: Channel<Value>) {
    let mut pos: Option<u64> = None;
    let mut ident = None;
    let mut partial = Vec::<u8>::new();
    while !stop.load(Ordering::Relaxed) {
        if let Ok(meta) = std::fs::metadata(&path) {
            let len = meta.len();
            let id = identity(&meta);
            let start = match pos {
                None => len.saturating_sub(TAIL_BACKLOG),
                Some(p) if len < p || (ident.is_some() && id != ident) => {
                    partial.clear();
                    if out.send(json!({ "reset": true })).is_err() { return; }
                    0
                }
                Some(p) => p,
            };
            ident = id;
            if len > start {
                if let Ok(mut f) = std::fs::File::open(&path) {
                    let mut buf = vec![0u8; ((len - start) as usize).min(TAIL_READ_MAX)];
                    if f.seek(SeekFrom::Start(start)).is_ok() {
                        if let Ok(n) = f.read(&mut buf) {
                            buf.truncate(n);
                            let first = pos.is_none();
                            pos = Some(start + n as u64);
                            partial.extend_from_slice(&buf);
                            if let Some(cut) = partial.iter().rposition(|&b| b == b'\n') {
                                let mut lines: Vec<u8> = partial.drain(..=cut).collect();
                                if first && start > 0 {
                                    // backlog starts mid-line: drop the fragment
                                    let skip = lines.iter().position(|&b| b == b'\n').map_or(0, |i| i + 1);
                                    lines.drain(..skip);
                                }
                                let text = String::from_utf8_lossy(&lines).into_owned();
                                if out.send(json!({ "text": text })).is_err() { return; }
                            }
                            continue; // more may be pending (read is capped)
                        }
                    }
                }
            } else {
                pos = Some(start);
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[tauri::command]
async fn tail_stop(state: State<'_, Tails>, id: String) -> Result<(), String> {
    if let Some(s) = state.0.lock().unwrap().remove(&id) {
        s.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn tasks_file(path: &str) -> Result<PathBuf, String> {
    Ok(project_dir(path)?.join(".cockpit").join("brain").join("TASKS.md"))
}

#[derive(Serialize)]
struct Tasks {
    path: String,
    content: String,
}

#[tauri::command]
async fn read_tasks(path: String) -> Result<Tasks, String> {
    let f = tasks_file(&path)?;
    let content = std::fs::read_to_string(&f).unwrap_or_default();
    Ok(Tasks { path: f.to_string_lossy().into_owned(), content })
}

/// Writes TASKS.md only if it still equals `expected` (an agent may have edited it meanwhile).
#[tauri::command]
async fn write_tasks(path: String, expected: String, content: String) -> Result<(), String> {
    let f = tasks_file(&path)?;
    let current = std::fs::read_to_string(&f).unwrap_or_default();
    if current != expected {
        return Err("conflict".into());
    }
    std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&f, content).map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("project")
        .invoke_handler(tauri::generate_handler![
            git_status, git_stamp, unity_default_log, is_unity_project, tail_start, tail_stop, read_tasks, write_tasks
        ])
        .setup(|app, _| {
            app.manage(Tails::default());
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn tail_follows_appends_truncation_and_replacement() {
        let dir = std::env::temp_dir().join(format!("cockpit-tail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("Editor.log");
        std::fs::write(&log, "old line\n").unwrap();
        let got = Arc::new(Mutex::new(Vec::<Value>::new()));
        let g2 = got.clone();
        let ch: Channel<Value> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(s) = body { g2.lock().unwrap().push(serde_json::from_str(&s).unwrap()); }
            Ok(())
        });
        let stop = Arc::new(AtomicBool::new(false));
        let (l2, s2) = (log.clone(), stop.clone());
        let h = std::thread::spawn(move || tail_loop(l2, s2, ch));
        let wait = || std::thread::sleep(Duration::from_millis(1300));
        wait();
        std::fs::OpenOptions::new().append(true).open(&log).unwrap().write_all(b"error CS0103: x\npart").unwrap();
        wait();
        std::fs::write(&log, "fresh start\n").unwrap(); // truncation (Unity restart)
        wait();
        stop.store(true, Ordering::Relaxed);
        h.join().unwrap();
        let msgs = got.lock().unwrap().clone();
        let texts: String = msgs.iter().filter_map(|m| m["text"].as_str()).collect();
        assert!(texts.contains("old line"), "{msgs:?}");
        assert!(texts.contains("error CS0103: x\n"), "{msgs:?}");
        assert!(!texts.contains("part"), "partial line must wait for newline: {msgs:?}");
        assert!(msgs.iter().any(|m| m["reset"] == true), "{msgs:?}");
        assert!(texts.ends_with("fresh start\n"), "{msgs:?}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
