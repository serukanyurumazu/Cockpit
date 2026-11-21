// Unity timeline: a batch-build terminal pane feeds compile/build lines into the Unity panel.
import { connect } from "./lib.mjs";

const { browser, page, waitFor } = await connect();
// fresh state: close a pane left over from an aborted run, open the Unity panel and clear it
await page.evaluate(() => window.__cockpit.termApi.getPanel("terminal-unitytl")?.api.close());
await page.click("nav >> text=Unity");
await page.click("text=Temizle", { trial: false }).catch(() => {});
await page.evaluate(() => {
  const { termApi } = window.__cockpit;
  termApi.addPanel({
    id: "terminal-unitytl",
    component: "terminal",
    title: "Build · e2e",
    params: { unityBuild: "e2e", run: "'Reloading assemblies after finishing script compilation.'; 'Build Finished, Result: Success.'; 'Unity çıkış kodu: 0'" },
  });
});
const rows = await waitFor(
  () => page.evaluate(() => [...document.querySelectorAll("ol > li")].filter((li) => li.textContent.includes("e2e")).map((li) => li.textContent.replace(/\s+/g, " ").trim())),
  20000,
  "timeline rows",
).then(async (r) => (r.length >= 3 ? r : waitFor(async () => { const x = await page.evaluate(() => [...document.querySelectorAll("ol > li")].filter((li) => li.textContent.includes("e2e")).map((li) => li.textContent.replace(/\s+/g, " ").trim())); return x.length >= 3 && x; }, 20000, "3 rows")));
console.log(JSON.stringify(rows, null, 1));
await page.evaluate(() => window.__cockpit.termApi.getPanel("terminal-unitytl")?.api.close());
await browser.close();
if (!rows.some((r) => r.includes("Build başarılı")) || !rows.some((r) => r.includes("Batch build bitti")) || !rows.some((r) => r.includes("Derleme başarılı"))) {
  console.error("FAIL");
  process.exit(1);
}
console.log("OK");
