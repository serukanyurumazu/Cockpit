// E2E smoke test for the running dev app (Windows).
// Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, then:
//   node e2e/smoke.mjs <screenshot-dir>
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import path from "node:path";

const outDir = process.argv[2] ?? ".";
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd, sta = false) =>
  execFileSync("powershell.exe", [...(sta ? ["-STA"] : []), "-NoProfile", "-Command", cmd], { encoding: "utf8" });
const shot = (name) => {
  const file = path.join(outDir, name + ".png");
  ps(`& '${path.resolve("e2e/shot.ps1")}' -Out '${file}'`);
  return file;
};
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400) });
  }
}

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
if (!page) throw new Error("main page not found");
await page.waitForFunction(() => window.__cockpit?.api);

// deterministic start: one terminal
await page.evaluate(() => window.__cockpit.api.clear());
await page.click("text=+ Terminal");
await page.waitForFunction(() => Object.keys(window.__cockpitTerms ?? {}).length === 1);
const termText = () =>
  page.evaluate(() => {
    const t = Object.values(window.__cockpitTerms)[0];
    const b = t.buffer.active;
    const out = [];
    for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
    return out.join("\n");
  });
const waitText = async (re, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await termText();
    if (re.test(t)) return t;
    await sleep(100);
  }
  throw new Error("timeout waiting for " + re + " last: " + (await termText()).slice(-300));
};
const focusTerm = () => page.click(".xterm");
const run = async (cmd) => {
  await focusTerm();
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
};
await waitText(/PS .*>/, 15000);

await check("shell echo", async () => {
  await run("echo cockpit-ok-123");
  await waitText(/\ncockpit-ok-123/);
});

await check("turkish chars (CDP text input)", async () => {
  await run("echo ğüşıöçİ@#");
  await waitText(/\nğüşıöçİ@#/);
});

await check("ctrl+c interrupts ping", async () => {
  await run("ping -t 127.0.0.1");
  await waitText(/Reply from 127\.0\.0\.1/);
  const t0 = Date.now();
  await page.keyboard.press("Control+c");
  await waitText(/Ping statistics/, 3000);
  return { stopMs: Date.now() - t0 };
});

await check("flood: UI responsive + ctrl+c", async () => {
  await run("1..300000 | % { $_ }");
  await sleep(500);
  const lag = await page.evaluate(
    () =>
      new Promise((res) => {
        let max = 0, last = performance.now(), n = 0;
        const tick = () => {
          const now = performance.now();
          max = Math.max(max, now - last);
          last = now;
          if (++n < 60) setTimeout(tick, 16); else res(Math.round(max));
        };
        setTimeout(tick, 16);
      }),
  );
  const t0 = Date.now();
  await page.keyboard.press("Control+c");
  await waitText(/PS [^\n]*>\s*$/, 5000);
  const stopMs = Date.now() - t0;
  const a = await termText();
  await sleep(800);
  const b = await termText();
  if (a !== b) throw new Error("output still flowing after ctrl+c");
  if (lag > 250) throw new Error("UI main thread lag " + lag + "ms");
  return { maxFrameGapMs: lag, stopMs };
});

await check("ctrl+v text paste", async () => {
  ps("Set-Clipboard -Value 'pasted-text-42'");
  await focusTerm();
  await page.keyboard.type("echo ");
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Enter");
  await waitText(/\npasted-text-42/);
});

await check("ctrl+v image -> sends Alt+V (ESC v)", async () => {
  ps("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; [Windows.Forms.Clipboard]::SetImage((New-Object Drawing.Bitmap 8,8))", true);
  await run(`node -e "process.stdin.setRawMode(true);process.stdin.once('data',d=>{console.log('GOT'+[...d].join(','));process.exit()})"`);
  await sleep(1500);
  await page.keyboard.press("Control+v");
  const t = await waitText(/GOT[0-9,]+/);
  const got = t.match(/GOT([0-9,]+)/)[1];
  if (got !== "27,118") throw new Error("got bytes " + got);
  return { gotBytes: got };
});

await check("ctrl+c with selection copies, no interrupt", async () => {
  await page.evaluate(() => Object.values(window.__cockpitTerms)[0].selectAll());
  ps("Set-Clipboard -Value 'x'");
  await page.keyboard.press("Control+c");
  await sleep(300);
  const clip = ps("Get-Clipboard").trim();
  if (clip === "x" || clip.length < 10) throw new Error("selection not copied: " + clip.slice(0, 80));
  const t = await termText();
  if (/\^C/.test(t.slice(-200))) throw new Error("ctrl+c interrupted instead of copying");
});

let shots = {};
await check("browser pane opens", async () => {
  await page.click("text=+ Tarayıcı");
  await page.waitForFunction(() => window.__cockpit.api.panels.some((p) => p.id.startsWith("browser")));
  await sleep(5000);
  shots.browser = shot("1-browser");
});

await check("browser follows move to new group", async () => {
  await page.evaluate(() => {
    const api = window.__cockpit.api;
    const b = api.panels.find((p) => p.id.startsWith("browser"));
    b.api.moveTo({ group: api.panels.find((p) => p.id.startsWith("terminal")).group, position: "bottom" });
  });
  await sleep(1500);
  shots.moved = shot("2-browser-moved-bottom");
});

await check("browser hidden behind other tab", async () => {
  await page.evaluate(() => {
    const api = window.__cockpit.api;
    const b = api.panels.find((p) => p.id.startsWith("browser"));
    api.addPanel({ id: "terminal-tabtest", component: "terminal", title: "Terminal", position: { referencePanel: b.id } });
  });
  await sleep(1500);
  shots.hidden = shot("3-browser-tab-hidden");
});

await check("layout panels", async () => {
  await sleep(800);
  return page.evaluate(() => window.__cockpit.api.panels.map((p) => p.id));
});

console.log(JSON.stringify({ results, shots }, null, 2));
await browser.close().catch(() => {});
