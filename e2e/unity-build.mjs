// Unity batch build from the Proje panel against a real Unity project.
//   node e2e/unity-build.mjs <unity-project>
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { connect, sleep } from "./lib.mjs";

const proj = process.argv[2];
const { browser, page, text, waitFor } = await connect();
const results = [];
const check = async (name, fn) => {
  try { results.push({ name, ok: true, detail: await fn() }); } catch (e) { results.push({ name, ok: false, error: String(e.message ?? e).slice(0, 400) }); }
};
await page.evaluate((proj) => {
  const api = window.__cockpit.api;
  api.clear();
  api.addPanel({ id: "project-unity", component: "project", title: "Proje", params: { path: proj } });
}, proj);
const ui = page.locator(".proj");
const termIds = () => page.evaluate(() => Object.keys(window.__cockpitTerms));
const runBuild = async (method) => {
  const before = await termIds();
  await ui.locator(".build input").fill(method);
  await ui.locator(".build button").click();
  await sleep(1500);
  return (await termIds()).find((id) => !before.includes(id)) ?? null;
};

await check("unity info", async () => {
  await waitFor(async () => /6000\.3\.26f1/.test(await ui.innerText()), 8000, "version");
  const t = await ui.innerText();
  if (!/Editör bulundu/.test(t)) throw new Error(t.slice(0, 400));
  return t.match(/Unity MCP:[^\n]*/)?.[0];
});
await check("build succeeds, streams log, reports exit 0", async () => {
  fs.rmSync(path.join(proj, "build-ok.txt"), { force: true });
  const id = await runBuild("CockpitBuild.Run");
  if (!id) throw new Error("no build terminal opened");
  const t0 = Date.now();
  const t = await waitFor(async () => { const s = await text(id); return /Unity çıkış kodu: \d+/.test(s) ? s : null; }, 600000, "exit code");
  return { sec: Math.round((Date.now() - t0) / 1000), exit: t.match(/Unity çıkış kodu: (\d+)/)[1], logStreamed: /COCKPIT BUILD OK/.test(t), file: fs.existsSync(path.join(proj, "build-ok.txt")) };
});
await check("failing method reports non-zero exit", async () => {
  const id = await runBuild("CockpitBuild.Fail");
  const t = await waitFor(async () => { const s = await text(id); return /Unity çıkış kodu: \d+/.test(s) ? s : null; }, 600000, "exit code");
  return { exit: t.match(/Unity çıkış kodu: (\d+)/)[1], errorLogged: /COCKPIT BUILD FAIL/.test(t) };
});
await check("project open in editor (lock held) -> build refused", async () => {
  const lock = path.join(proj, "Temp", "UnityLockfile");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const holder = spawn("powershell.exe", ["-NoProfile", "-Command", `$f=[IO.File]::Open('${lock}','OpenOrCreate','ReadWrite','None'); Start-Sleep 20; $f.Close()`]);
  await sleep(2500);
  const id = await runBuild("CockpitBuild.Run");
  const msg = await ui.locator("p.warn").allInnerTexts();
  holder.kill();
  if (id) throw new Error("build started despite lock");
  return msg;
});
await check("invalid method rejected", async () => {
  await sleep(500);
  const id = await runBuild("rm -rf /");
  if (id) throw new Error("build started");
  return await ui.locator("p.warn").allInnerTexts();
});
console.log(JSON.stringify({ results }, null, 1));
await browser.close();
