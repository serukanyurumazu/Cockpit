// Live agent check: launch <agent> in <cwd>, follow hook-driven states through a prompt and a
// permission request. Uses the CLI's own login (sends two short prompts).
//   node e2e/agent-live.mjs claude <cwd> <shotdir>
import { execFileSync } from "node:child_process";
import path from "node:path";
import { connect, sleep } from "./lib.mjs";

const [agent = "claude", cwd = process.cwd(), shots = ".", ...args] = process.argv.slice(2);
const { browser, page, text, waitFor, agentState, type } = await connect();
const shot = (n) => execFileSync("powershell.exe", ["-NoProfile", "-File", path.resolve("e2e/shot.ps1"), "-Out", path.join(shots, n + ".png")]);
const log = [];
const seen = new Set();
const paneId = await page.evaluate(({ agent, cwd, args }) => {
  const api = window.__cockpit.api;
  api.clear();
  const id = "terminal-live-" + agent + "-" + Date.now();
  api.addPanel({ id, component: "terminal", title: agent, params: { agent, cwd, args } });
  return id;
}, { agent, cwd, args });
const watch = setInterval(async () => { try { const s = await agentState(paneId); if (s) seen.add(s); } catch {} }, 150);
const step = async (name, fn) => {
  const t0 = Date.now();
  try { log.push({ name, ok: true, ms: Date.now() - t0, detail: await fn() }); }
  catch (e) { log.push({ name, ok: false, error: String(e.message ?? e).slice(0, 300), tail: (await text(paneId)).slice(-600) }); }
};

await step("session start -> state from hook", async () => {
  return waitFor(async () => {
    const t = await text(paneId);
    // One-time first-run prompts of the CLIs (folder trust, Codex hook review).
    const answer = async (key, keys) => {
      if (seen.has(key)) return;
      seen.add(key);
      await page.evaluate((id) => window.__cockpitTerms[id].focus(), paneId);
      for (const k of keys) await page.keyboard.press(k);
      await sleep(1500);
    };
    const screen = t.slice(-3000);
    if (/Yes, I trust this folder/.test(screen)) await answer("claudeTrust", ["ArrowDown", "Enter"]);
    if (/1\. Trust and continue/.test(screen)) await answer("codexTrust", ["Enter"]);
    if (/2\. Trust all and continue/.test(screen)) await answer("codexHooks", ["ArrowDown", "Enter"]);
    const s = await agentState(paneId);
    return s && s !== "unknown" ? s : null;
  }, 90000, "first hook");
});
shot(agent + "-1-started");

await step("prompt -> working -> idle", async () => {
  seen.delete("working");
  await type(paneId, "Reply with only the word OK. Do not use any tools.");
  await sleep(300);
  await page.keyboard.press("Enter");
  await waitFor(async () => seen.has("working"), 60000, "working");
  await waitFor(async () => (await agentState(paneId)) === "idle", 120000, "idle");
  return [...seen];
});

await step("permission request -> needs_input", async () => {
  await type(paneId, process.env.PERM_PROMPT ?? "Create a new file named cockpit-perm-test.txt containing the word hi. Use your file write tool.");
  await sleep(300);
  await page.keyboard.press("Enter");
  await waitFor(async () => (await agentState(paneId)) === "needs_input", 120000, "needs_input");
  shot(agent + "-2-needs-input");
  await page.keyboard.press("Escape");
  await waitFor(async () => (await agentState(paneId)) !== "needs_input", 60000, "leave needs_input");
  return await agentState(paneId);
});

const params = await page.evaluate((id) => window.__cockpit.api.getPanel(id)?.params, paneId);
const hooks = await page.evaluate((id) => (window.__cockpitHookLog ?? []).filter((h) => h.paneId === id).map((h) => [h.event, h.notificationType].filter(Boolean).join(":")), paneId);
clearInterval(watch);
console.log(JSON.stringify({ paneId, log, params, states: [...seen], hooks }, null, 1));
await browser.close();
