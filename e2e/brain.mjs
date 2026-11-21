// Second brain e2e (PLAN M4 acceptance).  node e2e/brain.mjs <scratch-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { connect, sleep } from "./lib.mjs";

const scratch = process.argv[2];
const projA = path.join(scratch, "brainA-" + Date.now());
const projB = path.join(scratch, "brainB-" + Date.now());
fs.mkdirSync(projA);
fs.mkdirSync(projB);
const { browser, page, waitFor } = await connect();
const inv = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
const vaultA = await inv("plugin:brain|vault_for_project", { project: projA });
const vaultB = await inv("plugin:brain|vault_for_project", { project: projB });
await page.evaluate(({ vaultA, projA }) => {
  const api = window.__cockpit.api;
  api.clear();
  api.addPanel({ id: "brain-e2e", component: "brain", title: "Beyin", params: { vault: vaultA, project: projA } });
}, { vaultA, projA });
const ui = page.locator(".brain");
const results = [];
const check = async (name, fn) => {
  try { results.push({ name, ok: true, detail: await fn() }); } catch (e) { results.push({ name, ok: false, error: String(e.message ?? e).slice(0, 300) }); }
};
const listText = async () => (await ui.locator("aside ul").allInnerTexts()).join("\n");
const search = async (q) => { await ui.locator("input.q").fill(q); await sleep(500); return listText(); };

await check("agent-written note searchable within 2 s", async () => {
  const t0 = Date.now();
  fs.writeFileSync(path.join(vaultA, "Gravity.md"), "---\ntags: [physics]\n---\n# Yerçekimi\nDüşme hızı 9.8 m/s²\n");
  await ui.locator("input.q").fill("düşme");
  await waitFor(async () => /Yerçekimi/.test(await listText()), 4000, "search hit");
  const ms = Date.now() - t0;
  if (ms > 2500) throw new Error("too slow: " + ms + "ms");
  return { ms };
});
await check("Turkish prefix search", async () => /Yerçekimi/.test(await search("yerçek")) || Promise.reject(new Error(await listText())));
await check("create note from UI", async () => {
  await ui.locator("input.q").fill("");
  await ui.locator("input[placeholder='+ Yeni not başlığı']").fill("Zıplama");
  await page.keyboard.press("Enter");
  await waitFor(() => fs.existsSync(path.join(vaultA, "Zıplama.md")), 4000, "file");
});
await check("edit + Ctrl+S saves", async () => {
  await ui.locator("textarea").fill("# Zıplama\n\nKullanır: [[gravity]]\n");
  await ui.locator("textarea").press("Control+s");
  await waitFor(() => fs.readFileSync(path.join(vaultA, "Zıplama.md"), "utf8").includes("[[gravity]]"), 4000, "saved");
});
await check("backlinks", async () => {
  await ui.locator("aside li button", { hasText: "Yerçekimi" }).click();
  await waitFor(async () => /Zıplama/.test((await ui.locator("footer").allInnerTexts()).join()), 4000, "backlink");
});
await check("conflict keeps both versions", async () => {
  await ui.locator("button.mini", { hasText: "Düzenle" }).click();
  await ui.locator("textarea").fill("# Yerçekimi\nbenim düzenlemem\n");
  fs.writeFileSync(path.join(vaultA, "Gravity.md"), "# Yerçekimi\najanın düzenlemesi\n");
  await ui.locator("button.mini", { hasText: "Kaydet" }).click();
  await sleep(800);
  const files = fs.readdirSync(vaultA);
  const draft = files.find((f) => f.startsWith("Gravity (çakışma"));
  if (!draft) throw new Error("no draft: " + files);
  const disk = fs.readFileSync(path.join(vaultA, "Gravity.md"), "utf8");
  const mine = fs.readFileSync(path.join(vaultA, draft), "utf8");
  if (!disk.includes("ajanın") || !mine.includes("benim")) throw new Error("versions lost");
  return { draft, msg: await ui.locator(".msg").innerText() };
});
await check("agent edit of open note shows up (no local changes)", async () => {
  // the conflict draft has the same title, so write to whatever note is open
  const open = await ui.locator(".bar strong").innerText();
  const t0 = Date.now();
  fs.writeFileSync(path.join(vaultA, open), "# Yerçekimi\nyeni ajan satırı\n");
  const shownText = () => page.evaluate(() => (document.querySelector(".brain .md")?.textContent ?? "") + (document.querySelector(".brain textarea")?.value ?? ""));
  await waitFor(async () => (await shownText()).includes("yeni ajan satırı"), 5000, "reload");
  return { open, ms: Date.now() - t0 };
});
await check("rename drops old entry", async () => {
  fs.renameSync(path.join(vaultA, "Zıplama.md"), path.join(vaultA, "Jump.md"));
  await sleep(1800);
  const t = await search("kullanır");
  const n = await ui.locator("aside li button").count();
  if (n !== 1) throw new Error("hits: " + t);
});
await check("deleting index db rebuilds same results", async () => {
  const before = await search("ajan");
  const db = await inv("plugin:brain|index_db", { vault: vaultA });
  fs.rmSync(db);
  await ui.locator("input.q").fill("");
  await sleep(300);
  const after = await search("ajan");
  if (before !== after) throw new Error(before + " != " + after);
  return { exists: fs.existsSync(db) };
});
await check("two vaults with same note name stay separate", async () => {
  fs.writeFileSync(path.join(vaultB, "Gravity.md"), "# B projesi yerçekimi\n");
  const a = await inv("plugin:brain|search", { vault: vaultA, q: "yerçekimi" });
  const b = await inv("plugin:brain|search", { vault: vaultB, q: "yerçekimi" });
  if (a.some((n) => n.title.startsWith("B ")) || b.length !== 1 || !b[0].title.startsWith("B ")) throw new Error(JSON.stringify({ a, b }));
});
await check("preview: no script, no remote image", async () => {
  fs.writeFileSync(path.join(vaultA, "Evil.md"), "# Evil\n<script>window.__pwned=1</script>\n![px](https://tracker.example/p.gif)\n<img src=x onerror='window.__pwned=2'>\n");
  await search("evil");
  await ui.locator("aside li button", { hasText: "Evil" }).click();
  await ui.locator("button.mini", { hasText: "Önizleme" }).click();
  await sleep(500);
  const counts = await ui.locator(".md").evaluate((el) => ({ scripts: el.querySelectorAll("script").length, imgs: el.querySelectorAll("img").length }));
  const pwned = await page.evaluate(() => window.__pwned ?? null);
  if (counts.scripts || counts.imgs || pwned) throw new Error(JSON.stringify({ counts, pwned }));
});
await check("agent pointer added once", async () => {
  await ui.locator("button", { hasText: "Ajanlara tanıt" }).click();
  await sleep(500);
  await ui.locator("button", { hasText: "Ajanlara tanıt" }).click();
  await sleep(500);
  const md = fs.readFileSync(path.join(projA, "AGENTS.md"), "utf8");
  if ((md.match(/cockpit-vault/g) ?? []).length !== 1) throw new Error(md);
  return await ui.locator(".msg").innerText();
});
await ui.locator("input.q").fill("");
await ui.locator("aside li button", { hasText: "Yerçekimi" }).first().click();
await sleep(600);
execFileSync("powershell.exe", ["-NoProfile", "-File", path.resolve("e2e/shot.ps1"), "-Out", path.join(scratch, "brain.png")]);
console.log(JSON.stringify({ results }, null, 1));
await browser.close();
