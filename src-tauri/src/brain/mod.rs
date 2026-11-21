//! Second brain: plain Markdown files in a vault folder are the source of truth. A per-vault
//! SQLite FTS5 index lives in app data and is disposable (rebuilt from the files at any time).
//! Change detection is an mtime scan on each call: vaults are small, and agents write files directly.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

const POINTER_MARK: &str = "<!-- cockpit-vault -->";

#[derive(Debug, PartialEq)]
pub struct Parsed {
    pub title: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
}

fn stem(rel: &str) -> String {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.strip_suffix(".md").unwrap_or(name).to_string()
}

/// Title (first "# " heading or file name), front-matter `tags:`, and [[wiki links]] (lowercased names).
pub fn parse(rel: &str, text: &str) -> Parsed {
    let mut body = text;
    let mut tags = Vec::new();
    if let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) {
        if let Some(end) = rest.find("\n---") {
            for line in rest[..end].lines() {
                if let Some(v) = line.trim().strip_prefix("tags:") {
                    tags = v.trim().trim_matches(|c| c == '[' || c == ']')
                        .split(',').map(|t| t.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                        .filter(|t| !t.is_empty()).collect();
                }
            }
            body = rest[end + 4..].trim_start_matches(['-', '\r', '\n']);
        }
    }
    let title = body.lines().find_map(|l| l.strip_prefix("# ")).map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty()).unwrap_or_else(|| stem(rel));
    let mut links = Vec::new();
    let mut s = body;
    while let Some(i) = s.find("[[") {
        let after = &s[i + 2..];
        let Some(j) = after.find("]]") else { break };
        let target = after[..j].split(['|', '#']).next().unwrap_or("").trim().to_lowercase();
        if !target.is_empty() && !links.contains(&target) {
            links.push(target);
        }
        s = &after[j + 2..];
    }
    Parsed { title, tags, links }
}

/// Resolves a vault-relative note path; rejects absolute paths, "..", non-.md files and
/// anything (incl. via symlinks) that lands outside the vault.
pub fn safe_path(vault: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || !rel.ends_with(".md") || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("invalid note path: {rel}"));
    }
    let root = vault.canonicalize().map_err(|e| e.to_string())?;
    let full = root.join(rel_path);
    // Check the deepest existing ancestor so symlinked folders/files can't escape.
    let mut probe = full.as_path();
    while !probe.exists() {
        probe = probe.parent().ok_or("invalid path")?;
    }
    if !probe.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) {
        return Err(format!("outside vault: {rel}"));
    }
    Ok(full)
}

fn open(db: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(db)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes(path TEXT PRIMARY KEY, title TEXT, tags TEXT, mtime INTEGER);
         CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path UNINDEXED, title, body, tags, tokenize='unicode61 remove_diacritics 2');
         CREATE TABLE IF NOT EXISTS links(src TEXT, dst TEXT);
         CREATE INDEX IF NOT EXISTS links_dst ON links(dst);",
    )?;
    Ok(c)
}

fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            walk(root, &p, out);
        } else if ft.is_file() && name.ends_with(".md") {
            if let Ok(rel) = p.strip_prefix(root) {
                out.push((rel.to_string_lossy().replace('\\', "/"), p));
            }
        }
    }
}

/// Brings the index in line with the files (new, changed, deleted, renamed). Returns changes.
pub fn sync(c: &mut Connection, vault: &Path) -> rusqlite::Result<usize> {
    let mut files = Vec::new();
    walk(vault, vault, &mut files);
    let known: HashMap<String, i64> = c.prepare("SELECT path, mtime FROM notes")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    let tx = c.transaction()?;
    let mut changed = 0;
    let remove = |tx: &rusqlite::Transaction, path: &str| -> rusqlite::Result<()> {
        tx.execute("DELETE FROM notes WHERE path = ?1", [path])?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?1", [path])?;
        tx.execute("DELETE FROM links WHERE src = ?1", [path])?;
        Ok(())
    };
    for (rel, full) in &files {
        let m = mtime_ms(full);
        if known.get(rel) == Some(&m) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(full) else { continue };
        let p = parse(rel, &text);
        remove(&tx, rel)?;
        let tags = p.tags.join(" ");
        tx.execute("INSERT INTO notes(path, title, tags, mtime) VALUES (?1, ?2, ?3, ?4)", params![rel, p.title, tags, m])?;
        tx.execute("INSERT INTO notes_fts(path, title, body, tags) VALUES (?1, ?2, ?3, ?4)", params![rel, p.title, text, tags])?;
        for l in &p.links {
            tx.execute("INSERT INTO links(src, dst) VALUES (?1, ?2)", params![rel, l])?;
        }
        changed += 1;
    }
    for path in known.keys() {
        if !files.iter().any(|(r, _)| r == path) {
            remove(&tx, path)?;
            changed += 1;
        }
    }
    tx.commit()?;
    Ok(changed)
}

/// User text -> FTS5 query: every word must match as a prefix; quotes neutralize FTS syntax.
pub fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q.split_whitespace().map(|t| format!("\"{}\"*", t.replace('"', "\"\""))).collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

#[derive(Serialize)]
pub struct NoteInfo {
    path: String,
    title: String,
    tags: String,
    snippet: Option<String>,
}

pub fn search(c: &Connection, q: &str) -> rusqlite::Result<Vec<NoteInfo>> {
    let Some(fq) = fts_query(q) else { return Ok(vec![]) };
    // \u{1}/\u{2} mark hits; the UI escapes the text and turns them into <mark>.
    c.prepare("SELECT f.path, f.title, n.tags, snippet(notes_fts, 2, char(1), char(2), '…', 12) FROM notes_fts f JOIN notes n ON n.path = f.path WHERE notes_fts MATCH ?1 ORDER BY rank LIMIT 50")?
        .query_map([fq], |r| Ok(NoteInfo { path: r.get(0)?, title: r.get(1)?, tags: r.get(2)?, snippet: r.get(3)? }))?
        .collect()
}

pub fn backlinks(c: &Connection, rel: &str) -> rusqlite::Result<Vec<NoteInfo>> {
    c.prepare("SELECT DISTINCT n.path, n.title, n.tags FROM links l JOIN notes n ON n.path = l.src WHERE l.dst = ?1 AND n.path != ?2 ORDER BY n.title")?
        .query_map(params![stem(rel).to_lowercase(), rel], |r| Ok(NoteInfo { path: r.get(0)?, title: r.get(1)?, tags: r.get(2)?, snippet: None }))?
        .collect()
}

fn db_for<R: Runtime>(app: &AppHandle<R>, vault: &Path) -> Result<PathBuf, String> {
    // FNV-1a of the canonical vault path: one index per vault.
    let key = vault.to_string_lossy().to_lowercase();
    let h = key.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("brain");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{h:016x}.db")))
}

fn with_index<R: Runtime, T>(app: &AppHandle<R>, vault: &str, f: impl FnOnce(&mut Connection, &Path) -> rusqlite::Result<T>) -> Result<T, String> {
    let vault = Path::new(vault).canonicalize().map_err(|e| format!("vault: {e}"))?;
    let mut c = open(&db_for(app, &vault)?).map_err(|e| e.to_string())?;
    sync(&mut c, &vault).map_err(|e| e.to_string())?;
    f(&mut c, &vault).map_err(|e| e.to_string())
}

#[tauri::command]
async fn vault_for_project(project: String) -> Result<String, String> {
    let p = Path::new(&project);
    if !p.is_dir() {
        return Err(format!("not a folder: {project}"));
    }
    let v = p.join(".cockpit").join("brain");
    std::fs::create_dir_all(&v).map_err(|e| e.to_string())?;
    Ok(v.to_string_lossy().into_owned())
}

#[tauri::command]
async fn list<R: Runtime>(app: AppHandle<R>, vault: String) -> Result<Vec<NoteInfo>, String> {
    with_index(&app, &vault, |c, _| {
        c.prepare("SELECT path, title, tags FROM notes ORDER BY mtime DESC")?
            .query_map([], |r| Ok(NoteInfo { path: r.get(0)?, title: r.get(1)?, tags: r.get(2)?, snippet: None }))?
            .collect()
    })
}

#[tauri::command(rename = "search")]
async fn search_cmd<R: Runtime>(app: AppHandle<R>, vault: String, q: String) -> Result<Vec<NoteInfo>, String> {
    with_index(&app, &vault, |c, _| search(c, &q))
}

#[tauri::command(rename = "backlinks")]
async fn backlinks_cmd<R: Runtime>(app: AppHandle<R>, vault: String, path: String) -> Result<Vec<NoteInfo>, String> {
    with_index(&app, &vault, |c, _| backlinks(c, &path))
}

#[tauri::command]
async fn read(vault: String, path: String) -> Result<String, String> {
    std::fs::read_to_string(safe_path(Path::new(&vault), &path)?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct WriteResult {
    /// set when the file changed on disk since it was opened: the editor's text went here instead
    conflict: Option<String>,
}

/// expected = text the editor started from (None for a new note). If the file changed meanwhile
/// (e.g. an agent wrote it), the user's text is saved next to it so both versions survive.
#[tauri::command]
async fn write(vault: String, path: String, content: String, expected: Option<String>) -> Result<WriteResult, String> {
    let v = Path::new(&vault);
    let full = safe_path(v, &path)?;
    let current = std::fs::read_to_string(&full).ok();
    if current.is_some() && expected.is_none() {
        return Err(format!("note exists: {path}"));
    }
    if current.is_some() && current != expected {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let draft = format!("{} (çakışma {secs}).md", path.strip_suffix(".md").unwrap_or(&path));
        let dfull = safe_path(v, &draft)?;
        std::fs::write(&dfull, content).map_err(|e| e.to_string())?;
        return Ok(WriteResult { conflict: Some(draft) });
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    safe_path(v, &path)?; // re-check after creating folders
    std::fs::write(&full, content).map_err(|e| e.to_string())?;
    Ok(WriteResult { conflict: None })
}

/// Adds a one-time pointer to the vault in the project's CLAUDE.md / AGENTS.md (user-triggered).
#[tauri::command]
async fn add_agent_pointer(project: String) -> Result<Vec<String>, String> {
    let p = Path::new(&project);
    let text = format!("\n{POINTER_MARK}\n## Notes vault\nProject notes (second brain) are Markdown files in `.cockpit/brain/` ([[wiki-links]], `tags:` front-matter). Read relevant notes before starting; record durable findings and decisions there. Task list: `.cockpit/brain/TASKS.md`.\n");
    let mut targets: Vec<PathBuf> = ["CLAUDE.md", "AGENTS.md"].iter().map(|f| p.join(f)).filter(|f| f.is_file()).collect();
    if targets.is_empty() {
        targets.push(p.join("AGENTS.md"));
    }
    let mut touched = Vec::new();
    for t in targets {
        let cur = std::fs::read_to_string(&t).unwrap_or_default();
        if cur.contains(POINTER_MARK) {
            continue;
        }
        std::fs::write(&t, format!("{}{text}", cur.trim_end_matches('\n').to_string() + if cur.is_empty() { "" } else { "\n" })).map_err(|e| e.to_string())?;
        touched.push(t.file_name().unwrap().to_string_lossy().into_owned());
    }
    Ok(touched)
}

#[tauri::command]
async fn index_db<R: Runtime>(app: AppHandle<R>, vault: String) -> Result<String, String> {
    let v = Path::new(&vault).canonicalize().map_err(|e| e.to_string())?;
    Ok(db_for(&app, &v)?.to_string_lossy().into_owned())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("brain")
        .invoke_handler(tauri::generate_handler![vault_for_project, list, search_cmd, backlinks_cmd, read, write, add_agent_pointer, index_db])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cockpit-brain-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_title_tags_links() {
        let p = parse("notes/jump.md", "---\ntags: [physics, \"player\"]\n---\n# Zıplama fiziği\nSee [[Gravity|g]] and [[movement#air]] and [[gravity]].");
        assert_eq!(p.title, "Zıplama fiziği");
        assert_eq!(p.tags, vec!["physics", "player"]);
        assert_eq!(p.links, vec!["gravity", "movement"]);
        assert_eq!(parse("a/b.md", "no heading").title, "b");
    }

    #[test]
    fn safe_path_rejects_escapes() {
        let v = tmp("safe");
        assert!(safe_path(&v, "ok/new.md").is_ok());
        for bad in ["../x.md", "a/../../x.md", "x.txt", "", "C:/x.md", "/etc/x.md"] {
            assert!(safe_path(&v, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn index_search_backlinks_rename_rebuild() {
        let v = tmp("idx");
        std::fs::write(v.join("gravity.md"), "# Gravity\nfalling speed 9.8").unwrap();
        std::fs::write(v.join("jump.md"), "---\ntags: [physics]\n---\n# Zıplama\nuses [[gravity]] fiziği").unwrap();
        let db = v.with_extension("db");
        let mut c = open(&db).unwrap();
        assert_eq!(sync(&mut c, &v).unwrap(), 2);
        assert_eq!(sync(&mut c, &v).unwrap(), 0, "unchanged files are skipped");
        assert_eq!(search(&c, "fizi").unwrap()[0].path, "jump.md", "prefix + Turkish");
        assert_eq!(search(&c, "zıplama").unwrap().len(), 1);
        assert!(search(&c, "\"; DROP TABLE notes; --").unwrap().is_empty(), "FTS syntax is neutralized");
        assert_eq!(backlinks(&c, "gravity.md").unwrap()[0].path, "jump.md");
        std::fs::rename(v.join("jump.md"), v.join("jumping.md")).unwrap();
        sync(&mut c, &v).unwrap();
        let hits: Vec<_> = search(&c, "zıplama").unwrap().into_iter().map(|n| n.path).collect();
        assert_eq!(hits, vec!["jumping.md"], "rename drops the old entry");
        drop(c);
        std::fs::remove_file(&db).unwrap();
        let mut c2 = open(&db).unwrap();
        sync(&mut c2, &v).unwrap();
        assert_eq!(search(&c2, "falling").unwrap()[0].path, "gravity.md", "rebuilt from files");
        let _ = std::fs::remove_file(&db);
    }
}
