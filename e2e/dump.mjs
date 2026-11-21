// Prints the first lines of each terminal buffer (debug helper).
import { connect } from "./lib.mjs";
const { browser, page, text } = await connect();
const ids = await page.evaluate(() => Object.keys(window.__cockpitTerms));
for (const id of ids) console.log("== " + id + "\n" + (await text(id)).split("\n").slice(0, Number(process.argv[2] ?? 25)).join("\n"));
await browser.close();
