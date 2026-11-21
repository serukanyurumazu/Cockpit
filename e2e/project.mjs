// Project panel e2e: git status, Unity log tail (append, truncate), TASKS.md add/toggle/conflict.
//   node e2e/project.mjs <scratch-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { connect, sleep } from "./lib.mjs";

const scratch = process.argv[2];
const proj = path.join(scratch, "unity-proj-" + Date.now());
const log = path.join(scratch, "fake-Editor-" + Date.now() + ".log");
const git = (...a) => execFileSync("git", a, { cwd: proj });
fs.mkdirSync(path.join(proj, "Assets"), { recursive: true });
fs.mkdirSync(path.join(proj, "ProjectSettings"));
fs.writeFileSync(path.join(proj, "Assets", "Player.cs"), "class Player {}\n");
git("init", "-q", "-b", "main");
git("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
fs.appendFileSync(path.join(proj, "Assets", "Player.cs"), "// edit\n");
fs.writeFileSync(log, "Unity Editor version: 6000.3.26f1\nStart importing Packages/x/Warning.png using Guid(1)\n");

const { browser, page, waitFor } = await connect();
const results = [];
const check = async (name, fn) => {
  try { results.push({ name, ok: true, detail: await fn() }); } catch (e) { results.push({ name, ok: false, error: String(e.message ?? e).slice(0, 300) }); }
};
const id = await page.evaluate(({ proj, log }) => {
  const api = window.__cockpit.api;
  api.clear();
  api.addPanel({ id: "project-e2e", component: "project", title: "Proje", params: { path: proj, logPath: log } });
  return "project-e2e";
}, { proj, log });
const panel = () => page.locator(".proj");
const has = (sel, re) => async () => re.test((await panel().locator(sel).allInnerTexts()).join("\n"));

await check("git: branch + modified file", () => waitFor(has("section >> nth=0", /main[\s\S]*1 değişiklik[\s\S]*Player\.cs/), 10000, "git"));
await check("git: new file picked up by polling", async () => {
  fs.writeFileSync(path.join(proj, "new.txt"), "x");
  await waitFor(has("section >> nth=0", /2 değişiklik[\s\S]*new\.txt/), 20000, "untracked");
});
await check("log: backlog shown, importer 'Warning.png' not a warning", async () => {
  await waitFor(has(".lines", /Unity Editor version/), 5000, "backlog");
  return panel().locator(".lines .warning").count();
});
await check("log: appended error is red", async () => {
  fs.appendFileSync(log, "Assets/Player.cs(1,1): error CS0103: The name 'x' does not exist\n");
  await waitFor(async () => (await panel().locator(".lines .error").count()) === 1, 5000, "error line");
});
await check("log: truncation -> separator", async () => {
  fs.writeFileSync(log, "fresh editor start\n");
  await waitFor(has(".lines", /log yeniden başladı[\s\S]*fresh editor start/), 5000, "reset");
});
const tasksPath = path.join(proj, ".cockpit", "brain", "TASKS.md");
await check("tasks: add creates TASKS.md", async () => {
  await panel().locator("input[placeholder='Yeni görev…']").fill("zıplama fiziği");
  await page.keyboard.press("Enter");
  await waitFor(() => fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, "utf8").includes("- [ ] zıplama fiziği"), 5000, "file");
});
await check("tasks: toggle writes [x]", async () => {
  await panel().locator(".tasks input[type=checkbox]").first().click();
  await waitFor(() => fs.readFileSync(tasksPath, "utf8").includes("- [x] zıplama fiziği"), 5000, "toggled");
});
await check("tasks: external edit picked up, stale write refused", async () => {
  fs.writeFileSync(tasksPath, "# Tasks\n\n- [x] zıplama fiziği\n- [ ] agent added this\n");
  await waitFor(has(".tasks", /agent added this/), 6000, "reload");
  // race: change file again right before a UI toggle
  fs.writeFileSync(tasksPath, "# Tasks\n\n- [x] zıplama fiziği\n- [ ] agent added this\n- [ ] and this\n");
  await panel().locator(".tasks input[type=checkbox]").first().click();
  await sleep(1000);
  const md = fs.readFileSync(tasksPath, "utf8");
  const box = await panel().locator(".tasks input[type=checkbox]").first().isChecked();
  if (!box) throw new Error("checkbox out of sync with TASKS.md ([x] but unchecked)");
  return { kept: md.includes("and this"), msg: await panel().locator("p.warn").allInnerTexts() };
});
execFileSync("powershell.exe", ["-NoProfile", "-File", path.resolve("e2e/shot.ps1"), "-Out", path.join(scratch, "project.png")]);
console.log(JSON.stringify({ results }, null, 1));
await browser.close();
