// Release build checks (Windows): hook forwarder from a GUI-subsystem exe, idle RAM with 6 shells.
//   node e2e/release.mjs <path-to-release-cockpit.exe>
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
const exe = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223" }, stdio: "ignore" });
let browser;
for (let i = 0; i < 40 && !browser; i++) { await sleep(500); browser = await chromium.connectOverCDP("http://127.0.0.1:9223").catch(() => null); }
const page = browser.contexts().flatMap((c) => c.pages())[0];
await page.waitForSelector("text=+ Terminal");
const out = { url: page.url() };
out.devHooksAbsent = await page.evaluate(() => typeof window.__cockpit === "undefined" && typeof window.__cockpitTerms === "undefined");

// hook forwarder: release exe is a GUI-subsystem binary; stdin must still be read
const reg = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:hooks|register", { paneId: "probe" }));
await page.evaluate(() => {
  window.__got = [];
  const cb = window.__TAURI_INTERNALS__.transformCallback((e) => window.__got.push(e.payload));
  return window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "agent:hook", target: { kind: "Any" }, handler: cb });
});
const t0 = Date.now();
execFileSync(exe, ["--hook", "claude"], { input: JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }), env: { ...process.env, COCKPIT_HOOK_PORT: String(reg.port), COCKPIT_HOOK_TOKEN: reg.token }, timeout: 10000 });
out.forwarderMs = Date.now() - t0;
await sleep(500);
out.hookReceived = await page.evaluate(() => window.__got);
if (out.hookReceived[0]?.event !== "Stop") console.error("FAIL: hook event lost: " + JSON.stringify(out.hookReceived));

// idle RAM: 6 shells as tabs (1 visible)
for (let i = 0; i < 6; i++) { await page.click("text=+ Terminal"); await sleep(700); }
await sleep(60000);
out.tabs = await page.locator(".dv-tab").allInnerTexts();
const ps = execFileSync("powershell.exe", ["-NoProfile", "-Command", `
  $all = Get-CimInstance Win32_Process
  $root = ${app.pid}
  $tree = @($root); $changed = $true
  while ($changed) { $changed = $false; foreach ($p in $all) { if ($tree -contains $p.ParentProcessId -and -not ($tree -contains $p.ProcessId)) { $tree += $p.ProcessId; $changed = $true } } }
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $tree -contains $_.IDProcess }
  $perf | ForEach-Object { $n = ($all | Where-Object ProcessId -eq $_.IDProcess).Name; "$n|$($_.WorkingSetPrivate)" }`], { encoding: "utf8" });
const rows = ps.trim().split(/\r?\n/).map((l) => l.split("|")).map(([n, b]) => [n, +b]);
const sum = (f) => Math.round(rows.filter(([n]) => f(n)).reduce((a, [, b]) => a + b, 0) / 1048576);
out.ramMB = {
  appAndWebView: sum((n) => /cockpit|msedgewebview2/i.test(n)),
  shells: sum((n) => /powershell|pwsh|conhost|OpenConsole/i.test(n)),
  processes: rows.length,
};
out.ramMB.byName = Object.entries(rows.reduce((m, [n, b]) => ((m[n] = (m[n] ?? 0) + b), m), {})).map(([n, b]) => n + ":" + Math.round(b / 1048576));
console.log(JSON.stringify(out, null, 1));
await browser.close();
app.kill();
