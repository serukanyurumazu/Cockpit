// Prints the current dockview panels of the running dev app (used to verify layout restore).
import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
await p.waitForFunction(() => window.__cockpit?.api);
console.log(JSON.stringify(await p.evaluate(() => window.__cockpit.api.panels.map((x) => ({ id: x.id, title: x.title, params: x.params, group: x.group.id })))));
await b.close();
