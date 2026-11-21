//! GitHub through the user's own `gh` CLI login. Cockpit never stores or reads a token itself.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

fn gh(args: &[&str]) -> Result<Value, String> {
    let mut c = Command::new("gh");
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = c.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "gh bulunamadı: GitHub CLI kur (winget install GitHub.cli) ve gh auth login çalıştır".to_string()
        } else {
            format!("gh: {e}")
        }
    })?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("gh json: {e}"))
}

/// owner or owner/name; must not start with "-" so it can never be read as a gh flag.
fn valid_slug(s: &str) -> bool {
    let parts: Vec<&str> = s.split('/').collect();
    parts.len() <= 2
        && parts.iter().all(|p| {
            p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
                && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
}

fn check(s: &str) -> Result<(), String> {
    if valid_slug(s) { Ok(()) } else { Err(format!("geçersiz GitHub adı: {s}")) }
}

/// The signed-in user first, then their organisations.
#[tauri::command]
async fn owners() -> Result<Vec<String>, String> {
    let user = gh(&["api", "user"])?;
    let orgs = gh(&["api", "user/orgs"])?;
    let mut list = vec![user["login"].as_str().unwrap_or_default().to_string()];
    list.extend(orgs.as_array().into_iter().flatten().filter_map(|o| o["login"].as_str().map(String::from)));
    Ok(list)
}

#[tauri::command]
async fn repo_list(owner: String) -> Result<Value, String> {
    check(&owner)?;
    gh(&["repo", "list", &owner, "--limit", "300", "--json", "name,nameWithOwner,isPrivate,isArchived,isFork,description,updatedAt,url,repositoryTopics"])
}

/// Repo summary, open PRs and issues, last commits; fetched in parallel.
#[tauri::command]
async fn repo_view(repo: String) -> Result<Value, String> {
    check(&repo)?;
    let commits = format!("repos/{repo}/commits?per_page=10");
    let r = repo.as_str();
    let (info, prs, issues, log) = std::thread::scope(|s| {
        let a = s.spawn(|| gh(&["repo", "view", r, "--json", "description,url,defaultBranchRef,pushedAt,isPrivate"]));
        let b = s.spawn(|| gh(&["pr", "list", "-R", r, "--limit", "20", "--json", "number,title,author,updatedAt,url,isDraft"]));
        let c = s.spawn(|| gh(&["issue", "list", "-R", r, "--limit", "20", "--json", "number,title,updatedAt,url"]));
        let d = s.spawn(|| gh(&["api", &commits]));
        (a.join().unwrap(), b.join().unwrap(), c.join().unwrap(), d.join().unwrap())
    });
    // an empty repo has no commits (409) and issues may be disabled: only the summary is required
    Ok(json!({ "info": info?, "prs": prs.unwrap_or(json!([])), "issues": issues.unwrap_or(json!([])), "commits": log.unwrap_or(json!([])) }))
}

/// Open PRs the user is involved in (author, assignee, reviewer, mentioned).
#[tauri::command]
async fn my_prs() -> Result<Value, String> {
    gh(&["search", "prs", "--state", "open", "--involves", "@me", "--limit", "30", "--json", "repository,title,number,url,updatedAt,isDraft"])
}

/// "owner/name" (lowercase) from a GitHub remote URL (https or ssh).
fn github_slug(url: &str) -> Option<String> {
    let rest = url.trim().split("github.com").nth(1)?.trim_start_matches([':', '/']);
    let slug = rest.trim_end_matches('/').trim_end_matches(".git");
    valid_slug(slug).then(|| slug.to_lowercase()).filter(|s| s.contains('/'))
}

/// Direct child folders of `root` that are GitHub clones: "owner/name" -> folder.
#[tauri::command]
async fn local_clones(root: String) -> Result<HashMap<String, String>, String> {
    let mut map = HashMap::new();
    let entries = std::fs::read_dir(Path::new(&root)).map_err(|e| format!("{root}: {e}"))?;
    for dir in entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(config) = std::fs::read_to_string(dir.join(".git").join("config")) else { continue };
        let url = config.lines().map(str::trim).find_map(|l| l.strip_prefix("url = ").filter(|u| u.contains("github.com")));
        if let Some(slug) = url.and_then(github_slug) {
            map.insert(slug, dir.to_string_lossy().into_owned());
        }
    }
    Ok(map)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("github")
        .invoke_handler(tauri::generate_handler![owners, repo_list, repo_view, my_prs, local_clones])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_from_remotes_and_flag_safety() {
        assert_eq!(github_slug("https://github.com/Greencodia/Game.git").as_deref(), Some("greencodia/game"));
        assert_eq!(github_slug("git@github.com:serukanyurumazu/Cockpit.git").as_deref(), Some("serukanyurumazu/cockpit"));
        assert_eq!(github_slug("https://gitlab.com/a/b.git"), None);
        assert!(valid_slug("Greencodia") && valid_slug("a-b/c.d_e"));
        assert!(!valid_slug("--repo") && !valid_slug("a/b/c") && !valid_slug("") && !valid_slug("a b"));
    }
}
