# AI Dev Cockpit

Lightweight Windows/macOS desktop cockpit for local AI CLIs (Claude Code, Codex, Gemini), embedded browser, agent status, Unity dashboard and a simple second brain.

Plan: [docs/PLAN.md](docs/PLAN.md)

## Dev
```
pnpm install
pnpm tauri dev
```

## Status
- **M0 (Windows): passed (2026-11-21).** PTY + claude/codex, Ctrl+C, Ctrl+V (text + image), Turkish keyboard, flood output, child browser webview, no orphan processes on force-kill.
- M0 (macOS): not tested yet.
