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
