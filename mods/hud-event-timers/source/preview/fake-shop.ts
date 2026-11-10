// A fake souls counter and Quickbuy queue for the preview, built from the selectors in
// events.json (nextItem.find), so the mod's real lookup code finds them the same way it
// would in-game. Imported before src/main.ts.
import rawConfig from "../events.json";
import type { Config } from "../src/schedule.ts";
import { formatSouls } from "../src/shop.ts";

const cfg = (rawConfig as unknown as Config).nextItem;

/** Example queue only: names and prices are placeholders, not real game data. */
export const EXAMPLE_QUEUE = [
  { name: "Mystic Burst", cost: 1600 },
  { name: "Enduring Speed", cost: 3200 },
  { name: "Boundless Spirit", cost: 6400 },
];

function make(selector: string | undefined, base: "Panel" | "Label"): HTMLElement {
  const el = document.createElement("div");
  el.className = base;
  if (selector?.startsWith("#")) el.id = selector.slice(1);
  else if (selector?.startsWith(".")) el.classList.add(selector.slice(1));
  return el;
}

const host = document.getElementById("PreviewFakeShop") as HTMLElement;
const soulsEl = make(cfg?.find.souls[0], "Label");
const queueEl = make(cfg?.find.queue[0], "Panel");
// Like the game: the next item has its own entry (#QuickbuyNext), and the list is shown in
// reverse buying order. The mod has to get the order right anyway.
const nextEl = make(cfg?.find.next?.[0], "Panel");
host.append(soulsEl, queueEl, nextEl);

function fillEntry(row: HTMLElement, item: { name: string; cost: number } | undefined): void {
  row.replaceChildren();
  if (!item) return;
  const name = make(cfg?.find.itemName[0], "Label");
  const cost = make(cfg?.find.itemCost[0], "Label");
  name.textContent = item.name;
  cost.textContent = formatSouls(item.cost);
  row.append(name, cost);
}

let shownIndex = -1;

/** Updates the fake HUD: souls text, and rebuilds the queue only when it changes (like buying). */
export function renderFakeShop(souls: number, queueIndex: number): void {
  soulsEl.textContent = formatSouls(souls);
  if (queueIndex === shownIndex) return;
  shownIndex = queueIndex;
  queueEl.replaceChildren();
  const remaining = EXAMPLE_QUEUE.slice(queueIndex);
  for (const item of [...remaining].reverse()) {
    const row = make(cfg?.find.queueItem[0], "Panel");
    fillEntry(row, item);
    queueEl.append(row);
  }
  fillEntry(nextEl, remaining[0]);
}
