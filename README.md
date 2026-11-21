# AI Dev Cockpit

Lightweight Windows/macOS desktop cockpit for local AI CLIs (Claude Code, Codex, Gemini), embedded browser, agent status, Unity dashboard and a simple second brain.

Plan: [docs/PLAN.md](docs/PLAN.md)

## Dev
```
pnpm install
pnpm tauri dev
```

## E2E (Windows)
Start the app with CDP enabled, then drive it:
```
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
pnpm e2e <screenshot-dir>
```
Covers shell I/O, Ctrl+C, flood responsiveness, Ctrl+V text/image, selection copy, browser pane placement/hide. `e2e/panels.mjs` prints the restored layout after a restart. Note: overwrites the clipboard.

## Status
- **M0 (Windows): passed (2026-11-21).** PTY + claude/codex, Ctrl+C, Ctrl+V (text + image), Turkish keyboard, flood output, child browser webview, no orphan processes on force-kill.
- M0 (macOS): not tested yet.
- **M1 (Windows): e2e passed (2026-11-21).** Dock layout, browser follows moves and hides behind tabs, layout + browser URL restored after force-kill, no orphan processes. Open: 12-panel RAM measurement (release build), close-confirm (needs M2 agent status).
- **M2 (Windows), 2026-11-21:**
  - Hook listener security e2e passed (204 / 403 wrong token, Origin, Host / 413 / page fetch blocked / token dead after unregister).
  - Claude 2.1.330: idle → working → idle, needs_input on permission, resume after restart (same session id). Passed.
  - Codex 0.171.0: hooks fire (SessionStart arrives with first prompt), working → idle, session id captured. First launch asks folder trust + one-time hook review (hook command is constant, so review is once). needs_input not observed: default sandbox auto-approves workspace writes.
  - Gemini CLI dropped (no longer serves individual accounts). Replaced by Antigravity CLI `agy` 1.5.13: hooks via global `~/.gemini/config/hooks.json` entry `cockpit-status`; working → idle and conversation id verified. No permission event in agy, so no needs_input.
  - Dev-mode note: don't point Codex at this repo while `tauri dev` runs; its Windows sandbox touches file ACLs and the watcher restarts the app.
- **M3 (Windows), 2026-11-21:** e2e passed.
  - Project panel: git branch/changes with polling (`.git/index`/HEAD stamp + 15 s), new files detected.
  - Unity log: real default `%LOCALAPPDATA%\Unity\Editor\Editor.log` read (Unity 6000.3/6000.6 installed); error/warning classification from real samples; truncation shows a "log yeniden başladı" separator.
  - TASKS.md (`<project>/.cockpit/brain/`): add, toggle, external edits reload, stale write refused without losing the agent's lines.
  - Browser isolation: page has no `__TAURI__`; `pty`/`hooks`/`project` commands rejected by ACL for the browser webview; `file:` navigation blocked.
  - Not yet verified on macOS (`~/Library/Logs/Unity/Editor.log`).
- **M4 (Windows), 2026-11-21:** e2e passed (12 checks). Agent-written note searchable in ~0.3 s; Turkish prefix search; create/edit/Ctrl+S; backlinks; conflict keeps both versions; open note picks up agent edits; rename drops old entry; deleting the index db rebuilds the same results; two vaults with the same note name stay separate; preview runs no scripts and loads no remote images; agent pointer added to AGENTS.md once.
- Fixed: a page reload (HMR/F5) left native browser webviews painted over the UI; startup now closes stale ones (e2e/reload-orphans.mjs).
- **M5 release (Windows), 2026-11-21:** NSIS installer 2.60 MiB (WebView2 download bootstrapper, per-user install), exe 7.6 MB. Idle after 60 s with 7 terminal tabs (1 visible): app + WebView2 108–111 MB private working set (2 clean runs); shells reported separately, ~34 MB per Windows PowerShell. One outlier run measured 464 MB with 29 processes; cause not confirmed (likely an extra webview from a restored layout). Hook forwarder works from the GUI-subsystem exe (~35 ms). `e2e/release.mjs`.
- Fixed: since the Antigravity change, an empty X-Cockpit-Event header hid Claude/Codex event names (status never updated). Unit-tested now.
- **M5 Unity build (Windows), 2026-11-21:** e2e against a real Unity 6000.3.26f1 project: Build opens a terminal below the Proje panel, streams `-logFile -` output, prints the exit code (0 for success, 3 for a forced failure); build refused while `Temp/UnityLockfile` is held by an editor; invalid `-executeMethod` rejected. Unity MCP status shows the CoplayDev package and which agent CLIs have a unity MCP server configured (detect only).
