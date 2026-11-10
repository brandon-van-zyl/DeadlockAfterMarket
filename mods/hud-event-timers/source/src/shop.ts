// Pure logic for the "souls needed for the next queued item" line. No Panorama APIs here.

export interface NextItemConfig {
  enabled?: boolean;
  label: string;
  /**
   * Where to find things in the game's HUD. Each entry is "#PanelId" or ".ClassName"; the first
   * one that matches wins. These are the part to check with the F6 debugger the first time.
   */
  find: {
    /** The label showing your current souls. */
    souls: string[];
    /** The Quickbuy queue container. */
    queue: string[];
    /** A queued item, searched inside the queue. All matches are read, in queue order. */
    queueItem: string[];
    /** Inside a queued item: its name label. */
    itemName: string[];
    /** Inside a queued item: its price label. */
    itemCost: string[];
    /** The game's own "next item" panel (#QuickbuyNext); anchors the queue order. Optional. */
    next?: string[];
  };
  /**
   * Classes the game puts on the Quickbuy panel (or the next-item panel) when the queue is empty.
   * The next-item panel keeps its old text after a clear, so this is what says "nothing queued".
   */
  emptyWhen?: string[];
}

export interface QueuedItemText {
  name: string | null | undefined;
  cost: string | null | undefined;
}

export interface QueueStatus {
  /** The item being counted down: the first one you can't afford yet (or the last item if all are). */
  name: string;
  /** Souls still needed for it, counting the queued items before it (0 when everything is affordable). */
  need: number;
  /** How many items from the front of the queue you can already afford together. */
  readyCount: number;
  /** Queue length. */
  total: number;
  allReady: boolean;
}

/** Reads a souls/price label: "12,345", "12 345", "12.3k", "800". Returns null if unreadable. */
export function parseSouls(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const k = /^(\d+(?:\.\d+)?)\s*k$/.exec(t);
  if (k) return Math.round(Number(k[1]) * 1000);
  const plain = t.replace(/[,\s .]/g, "");
  return /^\d+$/.test(plain) ? Number(plain) : null;
}

/** 1150 -> "1,150". Written by hand because Panorama's JS may not have locale formatting. */
export function formatSouls(n: number): string {
  const s = String(Math.max(0, Math.round(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const sameItem = (a: QueuedItemText, b: QueuedItemText) =>
  !!a.name && (a.name ?? "").trim() === (b.name ?? "").trim() && (a.cost ?? "").trim() === (b.cost ?? "").trim();

/**
 * Puts the queue in buying order. The game shows the next item in its own panel
 * (#QuickbuyNext), separate from the #QuickbuyQueue list, and the list's panel order isn't
 * guaranteed to be buying order. So the next item anchors it:
 * - list starts with the next item -> list is in order;
 * - list ends with it -> list is reversed;
 * - list doesn't contain it -> next item first, then the list as it is.
 * Without a readable next item, the list is used as it is.
 */
export function orderQueue(next: QueuedItemText | null | undefined, list: QueuedItemText[]): QueuedItemText[] {
  if (!next || !(next.name ?? "").trim()) return list;
  if (list.length > 0 && sameItem(list[0], next)) return list;
  if (list.length > 0 && sameItem(list[list.length - 1], next)) return [...list].reverse();
  return [next, ...list];
}

/**
 * Walks the Quickbuy queue in order. Items you can already afford (together, since you'd buy
 * them first) count as ready; the line then counts down to the next one. Returns null to hide
 * the line (empty queue, or the souls/price labels can't be read).
 */
export function queueStatus(items: QueuedItemText[], soulsText: string | null | undefined): QueueStatus | null {
  const souls = parseSouls(soulsText);
  if (souls === null) return null;
  const queue: { name: string; cost: number }[] = [];
  for (const it of items) {
    const name = (it.name ?? "").trim();
    const cost = parseSouls(it.cost);
    if (!name || cost === null) break; // stop at the first unreadable item rather than guess
    queue.push({ name, cost });
  }
  if (queue.length === 0) return null;

  let spent = 0;
  for (let i = 0; i < queue.length; i++) {
    spent += queue[i].cost;
    if (spent > souls) {
      return { name: queue[i].name, need: spent - souls, readyCount: i, total: queue.length, allReady: false };
    }
  }
  const last = queue[queue.length - 1];
  return { name: last.name, need: 0, readyCount: queue.length, total: queue.length, allReady: true };
}

/** Throws a readable error for config mistakes. Run at build time. */
export function validateNextItem(cfg: NextItemConfig | undefined): void {
  if (!cfg) return;
  for (const [key, list] of Object.entries(cfg.find ?? {})) {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`nextItem.find.${key} needs at least one selector`);
    for (const sel of list) {
      if (!/^[#.][A-Za-z_][\w-]*$/.test(sel)) throw new Error(`nextItem.find.${key}: "${sel}" must be "#PanelId" or ".ClassName"`);
    }
  }
  for (const key of ["souls", "queue", "queueItem", "itemName", "itemCost"]) {
    if (!cfg.find?.[key as keyof NextItemConfig["find"]]) throw new Error(`nextItem.find.${key} is missing`);
  }
}
