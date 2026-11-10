// Runs the BUILT script (content/panorama/scripts/event_timers.js) against a fake Panorama HUD
// and prints what the panel and banners would show. Use it to check events.json changes
// without launching the game.
//   npm run build && npm run sim               simulate 0:00 to 12:00
//   npm run sim -- 4:20 5:10                   simulate a custom range

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "..", "content", "panorama", "scripts", "event_timers.js");

const toSec = (t) => { const [m, s] = t.split(":").map(Number); return m * 60 + s; };
const fmt = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !["--new-match-at", "--end-at", "--clear-queue-at"].includes(all[i - 1]));
const [from = "0:00", to = "12:00"] = positional;

// --- Fake Panorama -----------------------------------------------------------
// Counts the work the script does, to keep it cheap.
const stats = { treeSearches: 0, textWrites: 0, classChanges: 0 };

class FakePanel {
  constructor(id, classes = []) { this.id = id; this.classes = new Set(classes); this._text = ""; this.children = []; this.parent = null; this.style = {}; }
  get text() { return this._text; }
  set text(v) { stats.textWrites++; this._text = v; }
  add(child) { child.parent = this; this.children.push(child); return child; }
  IsValid() { return true; }
  GetParent() { return this.parent; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  FindChildTraverse(id) { stats.treeSearches++; for (const p of this.walk()) if (p.id === id) return p; return null; }
  FindChildrenWithClassTraverse(cls) { stats.treeSearches++; return [...this.walk()].filter((p) => p.classes.has(cls)); }
  AddClass(c) { stats.classChanges++; this.classes.add(c); }
  RemoveClass(c) { stats.classChanges++; this.classes.delete(c); }
  SetHasClass(c, on) { stats.classChanges++; on ? this.classes.add(c) : this.classes.delete(c); }
  SetPanelEvent(event, fn) { this.events = { ...this.events, [event]: fn }; }
  BAscendantHasClass(c) { for (let p = this.parent; p; p = p.parent) if (p.classes.has(c)) return true; return false; }
  BHasClass(c) { return this.classes.has(c); }
  GetChildCount() { return this.children.length; }
  GetChild(i) { return this.children[i] ?? null; }
}

// The HUD root carries the game state; --hideout simulates the hideout (mod should stay hidden).
const hud = new FakePanel("Hud", process.argv.includes("--hideout")
  ? ["WindowRoot", "connectedToHideout", "InHideout", "GameStateInProgress"]
  : ["WindowRoot", "connectedToGame", "gamemode_standard", "GameStateInProgress"]);
// --stale-clock: a second, frozen GameTime label earlier in the tree (the mod must ignore it).
// --new-match-at m:ss: from that time the clock restarts at 0:00 (like queueing into a new game).
if (process.argv.includes("--stale-clock")) hud.add(new FakePanel("", ["GameTime"]))._text = "38:12";
const clock = hud.add(new FakePanel("", ["GameTime"]));
const newMatchArg = process.argv.indexOf("--new-match-at");
const newMatchAt = newMatchArg >= 0 ? toSec(process.argv[newMatchArg + 1]) : null;
// --end-at m:ss: the match ends there (post-game screen for 20s, clock frozen), then a new match
// starts from 0:00, the way the game goes match -> post-game -> next match.
const clearArg = process.argv.indexOf("--clear-queue-at");
const clearQueueAt = clearArg >= 0 ? toSec(process.argv[clearArg + 1]) : null;
const endArg = process.argv.indexOf("--end-at");
const endAt = endArg >= 0 ? toSec(process.argv[endArg + 1]) : null;
const POST_GAME = 20;
function gameState(t) {
  if (endAt === null || t < endAt) return { state: "GameStateInProgress", clock: t };
  if (t < endAt + POST_GAME) return { state: "GameStatePostGame", clock: endAt };
  return { state: "GameStateInProgress", clock: t - endAt - POST_GAME };
}
const timers = hud.add(new FakePanel("DATimers", ["Hidden"]));
timers.add(new FakePanel("DATimersTitle"));
timers.add(new FakePanel("DAOptionsButton"));
hud.add(new FakePanel("DAToggle", ["Hidden"])).add(new FakePanel("DAToggleText"));
const options = hud.add(new FakePanel("DAOptions", ["Hidden"]));
for (const id of ["DAMapSizeDown", "DAMapSizeUp", "DAMapSizeValue", "DAMapSizeFill", "DAMarkersToggle", "DAMarkersToggleText", "DAFlipToggle", "DAFlipToggleText", "DAHideButton"]) {
  options.add(new FakePanel(id));
}
for (let i = 0; i < 4; i++) {
  const row = timers.add(new FakePanel(`DATimersRow${i}`, ["DATimersRow", "Hidden"]));
  row.add(new FakePanel(`DATimersRow${i}Name`));
  row.add(new FakePanel(`DATimersRow${i}Time`));
}
const wave = hud.add(new FakePanel("DAWave", ["Hidden"]));
wave.add(new FakePanel("DAWaveLabel"));
const waveTime = wave.add(new FakePanel("DAWaveTime"));
const nextItem = hud.add(new FakePanel("DANextItem", ["Hidden"]));
nextItem.add(new FakePanel("DANextItemLabel"));
const nextItemName = nextItem.add(new FakePanel("DANextItemName"));
const nextItemNeed = nextItem.add(new FakePanel("DANextItemNeed"));
const nextItemReady = nextItem.add(new FakePanel("DANextItemReady"));

// Fake souls counter and one queued item, using the selectors from events.json.
const shopCfg = JSON.parse(await readFile(join(here, "..", "events.json"), "utf8")).nextItem;
const fromSel = (sel) => (sel.startsWith("#") ? new FakePanel(sel.slice(1)) : new FakePanel("", [sel.slice(1)]));
const soulsPanel = shopCfg ? hud.add(fromSel(shopCfg.find.souls[0])) : null;
if (shopCfg) {
  // Like the game: queue list and next-item entry live inside the Quickbuy panel, which gets
  // the "Empty" class when the queue is cleared (--clear-queue-at m:ss).
  globalThis.quickbuy = hud.add(new FakePanel("CitadelHudQuickbuy", ["HudQuickbuy"]));
  const queuePanel = globalThis.quickbuy.add(fromSel(shopCfg.find.queue[0]));
  globalThis.queueList = queuePanel;
  // Three example items (placeholder names and prices), never bought, so the line walks the queue.
  // Like the game: the next item also has its own #QuickbuyNext entry, and the list is in
  // reverse buying order (the bug the user saw). The mod must still count Item A first.
  const items = [["Item A", "1,600"], ["Item B", "1,600"], ["Item C", "3,200"]];
  const addEntry = (parent, [name, cost], sel) => {
    const item = parent.add(sel ? fromSel(sel) : fromSel(shopCfg.find.queueItem[0]));
    item.classes.add(shopCfg.find.queueItem[0].slice(1));
    item.add(fromSel(shopCfg.find.itemName[0]))._text = name;
    item.add(fromSel(shopCfg.find.itemCost[0]))._text = cost;
  };
  for (const it of [...items].reverse()) addEntry(queuePanel, it);
  if (shopCfg.find.next) addEntry(globalThis.quickbuy, items[0], shopCfg.find.next[0]);
}
const SOULS_PER_SECOND = 12;

// Fake minimap: panel > map picture, using the selectors from events.json.
const mapCfg = JSON.parse(await readFile(join(here, "..", "events.json"), "utf8")).minimap;
if (mapCfg) {
  const scaleTarget = hud.add(fromSel(mapCfg.find.scaleTarget[0]));
  const host = scaleTarget.add(fromSel(mapCfg.find.minimap[0]));
  Object.assign(host, { actuallayoutwidth: 300, actuallayoutheight: 300, actualxoffset: 0, actualyoffset: 0 });
  host.add(fromSel(mapCfg.find.mapLayer[0]));
}

const banner = hud.add(new FakePanel("DATimersBanner"));
const bannerTitle = banner.add(new FakePanel("DATimersBannerText"));
const bannerTime = banner.add(new FakePanel("DATimersBannerTime"));
const context = hud.add(new FakePanel("ScriptContext"));

let now = 0; // simulated real time in seconds
let queue = [];
const logs = [];
// --duplicate-hud: a decoy copy of the HUD sits FIRST in the UI (like a second HUD instance).
// The mod must keep using its own HUD, or a banner could show on one copy and hide on the other.
const uiTop = new FakePanel("UIRoot");
let decoyBanner = null;
if (process.argv.includes("--duplicate-hud")) {
  const decoy = uiTop.add(new FakePanel("DecoyHud", ["WindowRoot"]));
  for (const id of ["DAWave", "DANextItem"]) decoy.add(new FakePanel(id, ["Hidden"]));
  const decoyTimers = decoy.add(new FakePanel("DATimers", ["Hidden"]));
  for (let i = 0; i < 4; i++) {
    const row = decoyTimers.add(new FakePanel(`DATimersRow${i}`, ["DATimersRow", "Hidden"]));
    row.add(new FakePanel(`DATimersRow${i}Name`))._text = "decoy";
    row.add(new FakePanel(`DATimersRow${i}Time`))._text = "decoy";
  }
  globalThis.decoyRows = decoyTimers;
  decoyBanner = decoy.add(new FakePanel("DATimersBanner"));
  decoyBanner.add(new FakePanel("DATimersBannerText"));
  decoyBanner.add(new FakePanel("DATimersBannerTime"));
}
uiTop.add(hud);

const $ = {
  GetContextPanel: () => hud, // the script's own HUD layout root
  _unused: context,
  Schedule: (secs, fn) => { queue.push({ at: now + secs, fn }); return queue.length; },
  Msg: (...a) => logs.push(a.join(" ")),
};

const code = await readFile(scriptPath, "utf8");
const sandbox = { $ };
vm.createContext(sandbox);
// --panorama-js: act like a JS engine without locale support (Panorama's may not have it), so
// locale-dependent calls fail here the way they did in-game.
if (process.argv.includes("--panorama-js")) {
  vm.runInContext(`
    String.prototype.localeCompare = function () { throw new Error("localeCompare is not available"); };
    Number.prototype.toLocaleString = function () { throw new Error("toLocaleString is not available"); };
    delete globalThis.Intl;
  `, sandbox);
}
vm.runInContext(code, sandbox);

// --- Run the clock -------------------------------------------------------------
const start = toSec(from), end = toSec(to);
let lastPanel = "", lastBanner = "", lastWaveTime = "", lastReady = null;
const waveSpawns = [];
const scriptStats = { ticks: 0, treeSearches: 0, textWrites: 0, classChanges: 0 };
for (let t = start; t <= end; t += 0.25) {
  now = t;
  const gs = gameState(t);
  for (const s of ["GameStateInProgress", "GameStatePostGame"]) hud.classes.delete(s);
  hud.classes.add(gs.state);
  clock.text = fmt(Math.floor(newMatchAt !== null && t >= newMatchAt ? t - newMatchAt : gs.clock));
  if (soulsPanel) soulsPanel._text = String(Math.floor((t - start) * SOULS_PER_SECOND)); // not counted as script work
  // Clearing the queue: the list empties and the panel gets "Empty", but #QuickbuyNext keeps
  // its old name/price text (that's what the game does).
  if (clearQueueAt !== null && t >= clearQueueAt && globalThis.queueList?.children.length) {
    for (const c of globalThis.queueList.children) c.IsValid = () => false;
    globalThis.queueList.children = [];
    globalThis.quickbuy.classes.add("Empty");
  }
  const due = queue.filter((q) => q.at <= now + 1e-9);
  queue = queue.filter((q) => q.at > now + 1e-9);
  for (const q of due) {
    const before = { ...stats };
    q.fn();
    for (const k of Object.keys(stats)) scriptStats[k] += stats[k] - before[k];
    scriptStats.ticks++;
  }

  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = hud.FindChildTraverse(`DATimersRow${i}`);
    if (row.classes.has("Hidden")) continue;
    const mark = row.classes.has("Now") ? "!!" : row.classes.has("Soon") ? "! " : "  ";
    rows.push(`${mark}${hud.FindChildTraverse(`DATimersRow${i}Name`).text} ${hud.FindChildTraverse(`DATimersRow${i}Time`).text}`);
  }
  const panelText = timers.classes.has("Hidden") ? "(hidden)" : rows.join(" | ") || "(no events soon)";
  const bannerText = banner.classes.has("Visible") ? `${bannerTitle.text} ${bannerTime.text}` : "";

  if (Number.isInteger(t) && t % 15 === 0 && panelText !== lastPanel) {
    console.log(`${clock.text.padStart(6)}  panel: ${panelText}`);
    lastPanel = panelText;
  }
  if (bannerText && bannerText !== lastBanner) console.log(`${clock.text.padStart(6)}  BANNER: ${bannerText}${banner.classes.has("Urgent") ? " (red)" : ""}`);
  if (!bannerText && lastBanner) console.log(`${clock.text.padStart(6)}  banner cleared`);
  lastBanner = bannerText;
  if (decoyBanner && decoyBanner.classes.has("Visible")) console.log(`${clock.text.padStart(6)}  ERROR: the decoy HUD's banner was touched`);
  if (globalThis.decoyRows && [...globalThis.decoyRows.walk()].some((p) => p._text && p._text !== "decoy")) {
    console.log(`${clock.text.padStart(6)}  ERROR: the decoy HUD's timer rows were written to`);
    globalThis.decoyRows = null;
  }

  if (!wave.classes.has("Hidden") && waveTime.text === "0:00" && lastWaveTime !== "0:00") waveSpawns.push(clock.text);
  lastWaveTime = waveTime.text;

  // Log when the line switches item or state (not every souls change).
  const itemState = nextItem.classes.has("Hidden")
    ? "(hidden)"
    : `${nextItemName.text}${nextItem.classes.has("Ready") ? " READY" : ""}${nextItem.classes.has("SomeReady") ? ` [${nextItemReady.text}]` : ""}`;
  if (itemState !== lastReady) {
    console.log(`${clock.text.padStart(6)}  NEXT ITEM: ${itemState}${nextItem.classes.has("Ready") ? "" : ` (needs ${nextItemNeed.text})`}`);
    lastReady = itemState;
  }
}

const shown = waveSpawns.length > 12 ? [...waveSpawns.slice(0, 6), "...", ...waveSpawns.slice(-6)] : waveSpawns;
console.log(`\nWave line hit 0:00 ${waveSpawns.length} times: ${shown.join(" ")}`);

for (const l of logs) if (/error/i.test(l)) console.log("SCRIPT ERROR:", l);
console.log(`\nScript log: ${logs.join(" / ")}`);
const per = (n) => (n / Math.max(1, end - start)).toFixed(1);
console.log(
  `Script work over ${end - start}s of match time: ${scriptStats.ticks} ticks, ` +
  `${scriptStats.treeSearches} HUD searches (${per(scriptStats.treeSearches)}/s), ` +
  `${scriptStats.textWrites} text writes (${per(scriptStats.textWrites)}/s), ` +
  `${scriptStats.classChanges} class changes (${per(scriptStats.classChanges)}/s)`,
);
