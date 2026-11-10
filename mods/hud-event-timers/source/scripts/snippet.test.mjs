// Guards hud_snippet.xml against leaking game classes into the HUD.
// A GlobalClassListener puts the game's classes (e.g. gShopOpen) on its PARENT. Placed straight
// under CitadelHud it switched on every vanilla ".gShopOpen ..." rule and moved the Quickbuy queue
// over the shop. So every listener must sit inside one of our own DA* panels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const snippet = readFileSync(new URL("../panorama/layout/hud_snippet.xml", import.meta.url), "utf8").replace(/<!--[\s\S]*?-->/g, "");

/** Each GlobalClassListener with the id of the element it's directly inside (null = HUD root). */
function listenerParents(xml) {
  const stack = [];
  const out = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z]\w*)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    if (tag === "GlobalClassListener") out.push(stack.length ? stack[stack.length - 1] : null);
    if (!selfClose) stack.push(/\bid="([^"]+)"/.exec(attrs)?.[1] ?? `(${tag})`);
  }
  return out;
}

test("every GlobalClassListener sits inside one of our own DA* panels", () => {
  for (const p of listenerParents(snippet)) assert.match(p ?? "(HUD root)", /^DA/, `listener directly inside ${p ?? "the HUD root"}`);
});

test("the check catches a listener at the top level", () => {
  assert.deepEqual(listenerParents('<GlobalClassListener classes="gShopOpen" />'), [null]);
  assert.deepEqual(listenerParents('<Panel id="DAx"><GlobalClassListener classes="a" /></Panel>'), ["DAx"]);
});
