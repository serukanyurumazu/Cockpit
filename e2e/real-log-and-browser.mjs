// 1) project panel on a Unity-shaped folder without logPath reads the real default Editor.log
// 2) browser pane: is the child webview reachable over CDP, and does it lack Tauri IPC?
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./lib.mjs";
const scratch = process.argv[2];
const proj = path.join(scratch, "unity-shape");
fs.mkdirSync(path.join(proj, "Assets"), { recursive: true });
fs.mkdirSync(path.join(proj, "ProjectSettings"), { recursive: true });
const { browser, page, waitFor } = await connect();
await page.evaluate((proj) => {
  const api = window.__cockpit.api;
  api.clear();
  api.addPanel({ id: "project-real", component: "project", title: "Proje", params: { path: proj } });
  api.addPanel({ id: "browser-sec", component: "browser", title: "Tarayıcı", params: { url: "https://example.com/" }, position: { direction: "right" } });
}, proj);
const out = {};
out.logSource = await page.locator(".src input").inputValue();
out.realLogLines = await waitFor(async () => { const n = await page.locator(".lines div").count(); return n > 0 ? n : null; }, 8000, "real log lines");
await sleep(4000);
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
out.targets = targets.map((t) => t.url);
const child = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("example.com"));
if (child) {
  out.childIpc = await child.evaluate(() => ({
    tauri: typeof window.__TAURI__,
    internals: typeof window.__TAURI_INTERNALS__,
  }));
  out.childInvoke = await child.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke("plugin:pty|spawn", {}); return "reached"; } catch (e) { return "rejected: " + String(e).slice(0, 120); }
  }).catch((e) => "eval failed: " + e.message.slice(0, 80));
  out.childFileNav = await child.evaluate(() => { location.href = "file:///C:/Windows/win.ini"; return "attempted"; }).catch(() => "threw");
  await sleep(1500);
  out.childUrlAfterFileNav = child.url();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
