// After a restart: the restored agent pane must offer resume; clicking Sürdür resumes the session.
import { connect } from "./lib.mjs";
const { browser, page, text, waitFor, agentState } = await connect();
const pane = await page.evaluate(() => window.__cockpit.api.panels.find((p) => p.params?.agent)?.id);
const overlay = await page.isVisible("text=Sürdür");
await page.click("text=Sürdür");
const state = await waitFor(async () => { const s = await agentState(pane); return s && s !== "unknown" ? s : null; }, 90000, "hook after resume");
const t = await text(pane);
console.log(JSON.stringify({ pane, overlay, state, sawPrevPrompt: t.includes("Reply with only the word OK"), sessionId: await page.evaluate((id) => window.__cockpit.api.getPanel(id).params.sessionId, pane) }));
await browser.close();
