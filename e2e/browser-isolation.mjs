// The browser pane loads a local probe page that tries Tauri IPC and reports back over HTTP.
// Expectation: no __TAURI__ global, invoke of privileged commands rejected, file: navigation blocked.
import http from "node:http";
import { connect, sleep } from "./lib.mjs";

const reports = [];
const probe = `<!doctype html><script>
const report = (k, v) => fetch("/report?" + new URLSearchParams({ k, v: String(v) }));
report("tauri", typeof window.__TAURI__);
report("internals", typeof window.__TAURI_INTERNALS__);
(async () => {
  for (const cmd of ["plugin:pty|spawn", "plugin:hooks|register", "plugin:project|read_tasks"]) {
    try {
      if (!window.__TAURI_INTERNALS__) { report(cmd, "no-ipc"); continue; }
      await window.__TAURI_INTERNALS__.invoke(cmd, {});
      report(cmd, "REACHED");
    } catch (e) { report(cmd, "rejected: " + String(e).slice(0, 100)); }
  }
  report("done", 1);
  setTimeout(() => { location.href = "file:///C:/Windows/win.ini"; }, 300);
})();
</script><p>probe</p>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/report") { reports.push([u.searchParams.get("k"), u.searchParams.get("v")]); res.end("ok"); return; }
  res.setHeader("content-type", "text/html"); res.end(probe);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { browser, page, waitFor } = await connect();
await page.evaluate((url) => {
  const api = window.__cockpit.api;
  api.clear();
  api.addPanel({ id: "browser-probe", component: "browser", title: "probe", params: { url } });
}, url);
await waitFor(async () => reports.some(([k]) => k === "done"), 20000, "probe report");
await sleep(2000);
const address = await page.locator(".nav input").inputValue();
console.log(JSON.stringify({ reports, addressAfterFileNav: address }, null, 1));
await browser.close();
server.close();
