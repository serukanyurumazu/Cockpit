// Shared helpers for driving the dev app over WebView2 CDP.
import { chromium } from "playwright-core";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("main page not found");
  await page.waitForFunction(() => window.__cockpit?.api);
  const text = (paneId) =>
    page.evaluate((id) => {
      const t = window.__cockpitTerms[id];
      if (!t) return "";
      const b = t.buffer.active;
      const out = [];
      for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
      return out.join("\n");
    }, paneId);
  const waitFor = async (fn, ms = 30000, what = "condition") => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await fn();
      if (v) return v;
      await sleep(250);
    }
    throw new Error("timeout: " + what);
  };
  const agentState = (paneId) => page.evaluate((id) => window.__cockpitAgents?.[id]?.state ?? null, paneId);
  const type = async (paneId, s) => {
    await page.evaluate((id) => window.__cockpitTerms[id].focus(), paneId);
    await page.keyboard.type(s);
  };
  return { browser, page, text, waitFor, agentState, type };
}
