// Opens one agent pane and samples its screen over time (debug helper).
//   node e2e/open-agent.mjs <agent> <cwd> [extra args...]
import { connect, sleep } from "./lib.mjs";
const [agent, cwd, ...args] = process.argv.slice(2);
const { browser, page, text, agentState } = await connect();
const id = await page.evaluate(({ agent, cwd, args }) => {
  const api = window.__cockpit.api;
  api.clear();
  const id = "terminal-" + agent + "-" + Date.now();
  api.addPanel({ id, component: "terminal", title: agent, params: { agent, cwd, args } });
  return id;
}, { agent, cwd, args });
for (const ms of [1500, 4000, 8000]) {
  await sleep(ms);
  const t = (await text(id)).split("\n").filter((l) => l.trim()).slice(-12).join("\n");
  console.log("--- t+" + ms + " state=" + (await agentState(id)) + "\n" + t);
}
await browser.close();
