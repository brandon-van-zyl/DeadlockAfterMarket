import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bannerText,
  type Config,
  crossedWarnings,
  formatSeconds,
  nextOccurrence,
  nextWave,
  parseClock,
  type WaveConfig,
  upcoming,
  validateConfig,
} from "./schedule.ts";

const cfg: Config = {
  warnSeconds: [30, 10],
  showUpcoming: 4,
  lookaheadSeconds: 120,
  bannerSeconds: 4,
  events: [
    { id: "buffs", label: "Bridge buffs", first: "5:00", every: 300 },
    { id: "urn", label: "Soul Urn", first: "10:00", every: 300 },
    { id: "camps", label: "Small camps", first: "2:00" },
    { id: "rift", label: "Rift", first: "11:00", approx: true },
    { id: "off", label: "Disabled", first: "1:00", enabled: false },
  ],
};

test("parseClock reads the HUD clock formats", () => {
  assert.equal(parseClock("0:00"), 0);
  assert.equal(parseClock("4:05"), 245);
  assert.equal(parseClock("45:30"), 2730);
  assert.equal(parseClock("1:02:03"), 3723);
  assert.equal(parseClock("-0:15"), -15);
  assert.equal(parseClock(" 12:00 "), 720);
  assert.equal(parseClock(""), null);
  assert.equal(parseClock("--:--"), null);
  assert.equal(parseClock(null), null);
});

test("formatSeconds", () => {
  assert.equal(formatSeconds(0), "0:00");
  assert.equal(formatSeconds(9), "0:09");
  assert.equal(formatSeconds(125), "2:05");
  assert.equal(formatSeconds(-3), "0:00");
});

test("nextOccurrence handles one-offs and repeats", () => {
  const buffs = cfg.events[0];
  assert.equal(nextOccurrence(buffs, 0), 300);
  assert.equal(nextOccurrence(buffs, 300), 300); // happening right now
  assert.equal(nextOccurrence(buffs, 301), 600);
  assert.equal(nextOccurrence(buffs, 2400), 2400);
  const camps = cfg.events[2];
  assert.equal(nextOccurrence(camps, 100), 120);
  assert.equal(nextOccurrence(camps, 121), null);
  assert.equal(nextOccurrence({ id: "x", label: "x", first: "5:00", every: 300, until: "10:00" }, 601), null);
});

test("upcoming lists soonest events in the lookahead window, skipping disabled ones", () => {
  const at = upcoming(cfg, 30); // 0:30
  assert.deepEqual(at.map((o) => o.id), ["camps"]);
  assert.equal(at[0].remaining, 90);

  const later = upcoming(cfg, 540); // 9:00
  // Buffs and urn both at 10:00 -> alphabetical; rift exactly at the 120s edge is included
  assert.deepEqual(later.map((o) => o.id), ["buffs", "urn", "rift"]);
  assert.equal(later[2].approx, true);
});

test("warnings fire once when crossing 30s and 10s", () => {
  // Bridge buffs at 5:00 -> warnings at 4:30 and 4:50
  assert.deepEqual(crossedWarnings(cfg, 269, 270).map((w) => [w.id, w.warn]), [["buffs", 30]]);
  assert.deepEqual(crossedWarnings(cfg, 270, 271), []);
  assert.deepEqual(crossedWarnings(cfg, 289, 290).map((w) => [w.id, w.warn]), [["buffs", 10]]);
  // Fractional ticks (0.25s) still fire exactly once
  const ticks = [269, 269.25, 269.5, 269.75, 270, 270.25];
  let fired = 0;
  for (let i = 1; i < ticks.length; i++) fired += crossedWarnings(cfg, ticks[i - 1], ticks[i]).length;
  assert.equal(fired, 1);
});

test("no warning burst after a clock jump or rewind", () => {
  assert.deepEqual(crossedWarnings(cfg, 100, 900), []);
  assert.deepEqual(crossedWarnings(cfg, 300, 200), []);
  assert.deepEqual(crossedWarnings(cfg, null, 270), []);
});

test("simultaneous warnings share one banner", () => {
  const two: Config = { ...cfg, events: [cfg.events[0], { id: "tc", label: "Tunnel crates", first: "5:00" }] };
  const b = bannerText(crossedWarnings(two, 269, 270));
  assert.deepEqual(b, { title: "Bridge buffs + Tunnel crates", time: "in 30 seconds", urgent: false });
  assert.deepEqual(bannerText(crossedWarnings(cfg, 649.75, 650)), { title: "Rift", time: "in ~10 seconds", urgent: true });
  assert.equal(bannerText([]), null);
});

test("a shared banner drops the trailing 'spawn'/'drops' to stay short; a single one keeps it", () => {
  const three: Config = { ...cfg, events: [
    { id: "b", label: "Bridge buffs", first: "5:00" },
    { id: "m", label: "Medium camps spawn", first: "5:00" },
    { id: "t", label: "Tunnel crates spawn", first: "5:00" },
  ] };
  assert.equal(bannerText(crossedWarnings(three, 269, 270))!.title, "Bridge buffs + Medium camps + Tunnel crates");
  const one: Config = { ...cfg, events: [{ id: "s", label: "Small camps spawn", first: "2:00" }] };
  assert.equal(bannerText(crossedWarnings(one, 89, 90))!.title, "Small camps spawn");
});

const waves: WaveConfig = {
  label: "Wave",
  soonSeconds: 5,
  phases: [{ from: "0:00", every: 30 }, { from: "20:00", every: 25 }, { from: "35:00", every: 20 }],
};

test("nextWave without a first-wave time starts at 0:00 and follows each interval", () => {
  assert.equal(nextWave(waves, -10), 10); // pre-game counts down to 0:00
  assert.equal(nextWave(waves, 0), 0);
  assert.equal(nextWave(waves, 1), 29);
  assert.equal(nextWave(waves, 30), 0);
  assert.equal(nextWave(waves, 1199), 1); // a 30s wave lands on 20:00
  assert.equal(nextWave(waves, 1201), 24); // 25s waves after 20:00
  assert.equal(nextWave(waves, 2099), 1);
  assert.equal(nextWave(waves, 2105), 15); // 20s waves after 35:00
});

test("nextWave counts from the first wave and keeps its rhythm through the interval changes", () => {
  const w: WaveConfig = { ...waves, firstWave: "0:17" }; // seen in a real match: :17 and :47
  assert.equal(nextWave(w, 0), 17); // counting down to the first wave
  assert.equal(nextWave(w, 17), 0);
  assert.equal(nextWave(w, 18), 29);
  assert.equal(nextWave(w, 47), 0);
  // 19:47 is a 30s wave; the next comes 30s later at 20:17 (no extra wave at 20:00), then every 25s.
  assert.equal(nextWave(w, 1190), 27);
  assert.equal(nextWave(w, 1218), 24); // 20:42
  // 25s waves from 20:17 land on 35:17; after that every 20s.
  assert.equal(nextWave(w, 2110), 7);
  assert.equal(nextWave(w, 2118), 19); // 35:37
});

test("nextWave is null when waves are off", () => {
  assert.equal(nextWave(undefined, 100), null);
  assert.equal(nextWave({ ...waves, enabled: false }, 100), null);
});

test("shipped events.json is valid", () => {
  const shipped = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));
  validateConfig(shipped);
});

test("validateConfig rejects mistakes", () => {
  assert.throws(() => validateConfig({ ...cfg, events: [{ id: "a", label: "A", first: "5 min" }] }), /Bad time/);
  assert.throws(() => validateConfig({ ...cfg, events: [cfg.events[0], cfg.events[0]] }), /Duplicate/);
  assert.throws(() => validateConfig({ ...cfg, showUpcoming: 9 }), /showUpcoming/);
  assert.throws(() => validateConfig({ ...cfg, waves: { ...waves, phases: [waves.phases[1], waves.phases[0]] } }), /time order/);
  assert.throws(() => validateConfig({ ...cfg, waves: { ...waves, phases: [{ from: "0:00", every: 0 }] } }), /every/);
});
