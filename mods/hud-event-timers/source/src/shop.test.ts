import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatSouls, orderQueue, parseSouls, queueStatus, validateNextItem } from "./shop.ts";

const A = { name: "Mystic Burst", cost: "1,600" };
const B = { name: "Enduring Speed", cost: "3,200" };
const C = { name: "Boundless Spirit", cost: "6,400" };

test("orderQueue: the game's next item decides the order", () => {
  assert.deepEqual(orderQueue(A, [A, B, C]), [A, B, C]); // already in order
  assert.deepEqual(orderQueue(A, [C, B, A]), [A, B, C]); // listed last-first (the reported bug)
  assert.deepEqual(orderQueue(A, [B, C]), [A, B, C]); // list leaves the next item out
  assert.deepEqual(orderQueue(null, [A, B]), [A, B]); // no next panel: use the list
  assert.deepEqual(orderQueue({ name: "", cost: "" }, [A, B]), [A, B]); // empty next panel
  assert.deepEqual(orderQueue(A, []), [A]); // only the next item
});

test("parseSouls reads the HUD number formats", () => {
  assert.equal(parseSouls("800"), 800);
  assert.equal(parseSouls("12,345"), 12345);
  assert.equal(parseSouls("12 345"), 12345);
  assert.equal(parseSouls(" 3,000 "), 3000);
  assert.equal(parseSouls("12.3k"), 12300);
  assert.equal(parseSouls("6K"), 6000);
  assert.equal(parseSouls(""), null);
  assert.equal(parseSouls("Mystic Burst"), null);
  assert.equal(parseSouls(null), null);
});

test("formatSouls adds thousands separators", () => {
  assert.equal(formatSouls(0), "0");
  assert.equal(formatSouls(950), "950");
  assert.equal(formatSouls(1150), "1,150");
  assert.equal(formatSouls(1234567), "1,234,567");
  assert.equal(formatSouls(-5), "0");
});

const queue = [
  { name: "Mystic Burst", cost: "1,600" },
  { name: "Enduring Speed", cost: "3,200" },
  { name: "Boundless Spirit", cost: "6,400" },
];

test("queueStatus counts down the first item", () => {
  assert.deepEqual(queueStatus(queue, "450"), { name: "Mystic Burst", need: 1150, readyCount: 0, total: 3, allReady: false });
});

test("queueStatus moves on to the next item once the first is affordable", () => {
  // 1,600 covers the first item exactly; the second needs 1,600 + 3,200 = 4,800 in total.
  assert.deepEqual(queueStatus(queue, "1,600"), { name: "Enduring Speed", need: 3200, readyCount: 1, total: 3, allReady: false });
  assert.deepEqual(queueStatus(queue, "4,000"), { name: "Enduring Speed", need: 800, readyCount: 1, total: 3, allReady: false });
  assert.deepEqual(queueStatus(queue, "5,000"), { name: "Boundless Spirit", need: 6200, readyCount: 2, total: 3, allReady: false });
});

test("queueStatus is all ready when the whole queue is affordable", () => {
  assert.deepEqual(queueStatus(queue, "11,200"), { name: "Boundless Spirit", need: 0, readyCount: 3, total: 3, allReady: true });
  assert.deepEqual(queueStatus([queue[0]], "2,000"), { name: "Mystic Burst", need: 0, readyCount: 1, total: 1, allReady: true });
});

test("queueStatus after buying: the bought item leaves the queue and souls drop", () => {
  assert.deepEqual(queueStatus(queue.slice(1), "400"), { name: "Enduring Speed", need: 2800, readyCount: 0, total: 2, allReady: false });
});

test("queueStatus hides on an empty queue or unreadable souls, and stops at an unreadable item", () => {
  assert.equal(queueStatus([], "100"), null);
  assert.equal(queueStatus(queue, null), null);
  assert.equal(queueStatus([{ name: "", cost: "800" }], "100"), null);
  const broken = [queue[0], { name: "Mystery", cost: "" }, queue[2]];
  assert.deepEqual(queueStatus(broken, "2,000"), { name: "Mystic Burst", need: 0, readyCount: 1, total: 1, allReady: true });
});

test("shipped nextItem config is valid", () => {
  const shipped = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));
  validateNextItem(shipped.nextItem);
});

test("validateNextItem rejects bad selectors", () => {
  const find = { souls: ["#Souls"], queue: ["#Queue"], queueItem: [".Item"], itemName: [".Name"], itemCost: [".Cost"] };
  assert.throws(() => validateNextItem({ label: "Next", find: { ...find, souls: ["Souls"] } }), /must be/);
  assert.throws(() => validateNextItem({ label: "Next", find: { ...find, queue: [] } }), /at least one/);
});
