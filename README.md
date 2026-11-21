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
