import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseClock, clockRestarted } from "./sync.ts";

test("the live clock beats a stale one", () => {
  const stale = { text: "38:12", changedAt: 5 }; // left over, stopped changing
  const live = { text: "4:31", changedAt: 120 };
  assert.equal(chooseClock([stale, live], 0), 1);
  assert.equal(chooseClock([live, stale], 1), 0);
});

test("unreadable clocks are skipped; none readable gives -1", () => {
  assert.equal(chooseClock([{ text: "", changedAt: 99 }, { text: "1:00", changedAt: 1 }], -1), 1);
  assert.equal(chooseClock([{ text: null, changedAt: 0 }, { text: "--", changedAt: 0 }], -1), -1);
});

test("on a tie (paused game) the previous choice sticks", () => {
  const a = { text: "10:00", changedAt: 50 }, b = { text: "10:00", changedAt: 50 };
  assert.equal(chooseClock([a, b], 1), 1);
  assert.equal(chooseClock([a, b], 0), 0);
});

test("clockRestarted spots a new match but ignores small corrections", () => {
  assert.equal(clockRestarted(1800, 5), true); // 30:00 -> 0:05: new match
  assert.equal(clockRestarted(605, 603), false); // 2s correction
  assert.equal(clockRestarted(null, 5), false);
  assert.equal(clockRestarted(100, null), false);
});
