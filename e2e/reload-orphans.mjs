// A page reload must not leave native browser webviews painted over the UI.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { connect, sleep } from "./lib.mjs";
const shots = process.argv[2] ?? ".";
let { browser, page } = await connect();
await page.evaluate(() => {
  const api = window.__cockpit.api;
  api.clear();
  api.addPanel({ id: "browser-orphan", component: "browser", title: "b", params: { url: "https://example.com/" } });
});
await sleep(4000);
await page.evaluate(() => {
  const api = window.__cockpit.api;
  api.clear(); // persisted layout: no browser panel after reload
});
await page.evaluate(() => window.__cockpit.api.addPanel({ id: "terminal-x", component: "terminal", title: "t", params: {} }));
// simulate an orphan: reload before the browser could be closed by cleanup
await page.evaluate(() => window.__cockpit.api.addPanel({ id: "browser-orphan2", component: "browser", title: "b", params: { url: "https://example.com/" } }));
await sleep(3000);
await page.reload();
await browser.close();
await sleep(5000);
({ browser, page } = await connect());
await sleep(3000);
const webviews = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:browser|labels"));
const browserPanels = await page.evaluate(() => window.__cockpit.api.panels.filter((p) => p.id.startsWith("browser")).length);
if (webviews.length !== browserPanels) console.error("ORPHANS: " + webviews.length + " webviews for " + browserPanels + " browser panels");
const leftAfterStartup = { webviews: webviews.length, browserPanels };
execFileSync("powershell.exe", ["-NoProfile", "-File", path.resolve("e2e/shot.ps1"), "-Out", path.join(shots, "after-reload.png")]);
console.log(JSON.stringify({ leftAfterStartup, panels: await page.evaluate(() => window.__cockpit.api.panels.map((p) => p.id)) }));
await browser.close();
