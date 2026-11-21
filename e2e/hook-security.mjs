// Hook listener trust-boundary checks against the running app.
import http from "node:http";
import { connect } from "./lib.mjs";

const { browser, page } = await connect();
const reg = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:hooks|register", { paneId: "e2e-probe" }));
const post = (headers, body = "{}") =>
  new Promise((res) => {
    const r = http.request({ host: "127.0.0.1", port: reg.port, path: "/hook", method: "POST", headers: { "Content-Length": Buffer.byteLength(body), ...headers }, setHost: false }, (x) => res(x.statusCode));
    r.on("error", (e) => res("ERR " + e.message));
    r.end(body);
  });
const host = `127.0.0.1:${reg.port}`;
const out = {
  valid: await post({ Host: host, "X-Cockpit-Token": reg.token }),
  wrongToken: await post({ Host: host, "X-Cockpit-Token": "nope" }),
  withOrigin: await post({ Host: host, "X-Cockpit-Token": reg.token, Origin: "https://evil.example" }),
  wrongHost: await post({ Host: "evil.example", "X-Cockpit-Token": reg.token }),
  tooBig: await post({ Host: host, "X-Cockpit-Token": reg.token }, "x".repeat(70000)),
  fromPageFetch: await page.evaluate(async (port) => {
    try { await fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", body: "{}", headers: { "X-Cockpit-Token": "x" } }); return "reached"; } catch (e) { return "blocked: " + e.message; }
  }, reg.port),
};
await page.evaluate((t) => window.__TAURI_INTERNALS__.invoke("plugin:hooks|unregister", { token: t }), reg.token);
out.afterUnregister = await post({ Host: host, "X-Cockpit-Token": reg.token });
console.log(JSON.stringify(out));
await browser.close();
