import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clampScale, effectiveScale, flipActive, locationPoints, markerStates, nextQuickSize, markerPosition, type MinimapConfig, nextFlipMode, parseSettings, soonKinds,
  uiScaleValue, validateMinimap,
} from "./minimap.ts";

const cfg: MinimapConfig = {
  find: { scaleTarget: ["#hud_minimap"], minimap: [".HudMinimap"], mapLayer: [".MapImage"] },
  scale: { default: 1, min: 1, max: 1.6, step: 0.05 },
  markers: { insert: "minimap", soonSeconds: 30, points: [{ x: 25, y: 40, kind: "crates" }, { x: 50, y: 50, kind: "urn" }] },
  flip: { mode: "auto", whenFound: [".invert_map"] },
};

test("clampScale rounds to the step and stays in range", () => {
  assert.equal(clampScale(1.23, cfg.scale), 1.25);
  assert.equal(clampScale(0.5, cfg.scale), 1);
  assert.equal(clampScale(9, cfg.scale), 1.6);
  assert.equal(clampScale(1.05 + 0.05, cfg.scale), 1.1); // no float drift
});

test("markerStates hides markers until their crates spawn, then shows them bright for a while", () => {
  const events = [{ id: "crates", label: "Crates", first: "3:00" }];
  const pts = [{ x: 1, y: 1, kind: "crates" }, { x: 2, y: 2, kind: "custom" }];
  assert.equal(markerStates(pts, events, 179, 30).get("crates"), "hidden");
  assert.equal(markerStates(pts, events, 180, 30).get("crates"), "new");
  assert.equal(markerStates(pts, events, 209, 30).get("crates"), "new");
  assert.equal(markerStates(pts, events, 210, 30).get("crates"), "shown");
  assert.equal(markerStates(pts, events, 0, 30).get("custom"), "shown"); // no event: always shown
});

test("locationPoints turns the flat spawn lists into markers of the chosen types", () => {
  const data = { crate: [10, 20, 30, 40], tough: [50, 60], statue: [70, 80] };
  assert.deepEqual(locationPoints(data, ["tough", "statue"]), [
    { x: 50, y: 60, kind: "crates", type: "tough" },
    { x: 70, y: 80, kind: "crates", type: "statue" },
  ]);
  assert.equal(locationPoints(data, ["crate", "tough", "statue"]).length, 4);
  assert.deepEqual(locationPoints(data, []), []);
});

test("shipped crate_locations.json has the expected spawn spots, all on the map", () => {
  const data = JSON.parse(readFileSync(new URL("../crate_locations.json", import.meta.url), "utf8"));
  assert.equal(data.crate.length / 2, 423);
  assert.equal(data.tough.length / 2, 78);
  assert.equal(data.statue.length / 2, 168);
  for (const v of [...data.crate, ...data.tough, ...data.statue]) assert.ok(v >= 0 && v <= 100, `${v} is outside the map`);
});

test("nextQuickSize switches between the two sizes", () => {
  assert.equal(nextQuickSize(1, [1, 1.4]), 1.4);
  assert.equal(nextQuickSize(1.4, [1, 1.4]), 1);
  assert.equal(nextQuickSize(1.25, [1, 1.4]), 1); // a slider value in between: back to small
});

test("effectiveScale steps back to 100% while the game shows its big map", () => {
  assert.equal(effectiveScale(1.3, false), 1.3);
  assert.equal(effectiveScale(1.3, true), 1);
});

test("uiScaleValue is a Panorama ui-scale percentage", () => {
  assert.equal(uiScaleValue(1), "100%");
  assert.equal(uiScaleValue(1.35), "135%");
});

test("markerPosition maps percent to pixels and flips for the other team", () => {
  assert.deepEqual(markerPosition({ x: 25, y: 40, kind: "crates" }, 200, 300, false), { left: 50, top: 120 });
  assert.deepEqual(markerPosition({ x: 25, y: 40, kind: "crates" }, 200, 300, true), { left: 150, top: 180 });
});

test("soonKinds brightens markers in the last seconds before their event", () => {
  const events = [{ id: "crates", label: "Crates", first: "3:00" }, { id: "urn", label: "Urn", first: "10:00", every: 300 }];
  assert.deepEqual([...soonKinds(cfg.markers.points, events, 140, 30)], []);
  assert.deepEqual([...soonKinds(cfg.markers.points, events, 150, 30)], ["crates"]);
  assert.deepEqual([...soonKinds(cfg.markers.points, events, 181, 30)], []); // one-off: gone after spawning
  assert.deepEqual([...soonKinds(cfg.markers.points, events, 880, 30)], ["urn"]); // 15:00 repeat
});

test("flip modes", () => {
  assert.equal(flipActive("auto", true), true);
  assert.equal(flipActive("auto", false), false);
  assert.equal(flipActive("on", false), true);
  assert.equal(flipActive("off", true), false);
  // Markers inside the panel the game mirrors already flip with it: don't flip twice.
  assert.equal(flipActive("auto", true, true), false);
  assert.equal(flipActive("on", true, true), true);
  assert.equal(nextFlipMode("auto"), "on");
  assert.equal(nextFlipMode("on"), "off");
  assert.equal(nextFlipMode("off"), "auto");
});

test("parseSettings keeps good saved values and ignores broken ones", () => {
  const base = { mapScale: 1, markers: true, flip: "auto", backdrop: false };
  assert.deepEqual(parseSettings(null, cfg), base);
  assert.deepEqual(parseSettings('{"mapScale":1.32,"markers":false,"flip":"on","backdrop":true}', cfg), { mapScale: 1.3, markers: false, flip: "on", backdrop: true });
  assert.deepEqual(parseSettings('{"mapScale":"big","flip":"sideways","backdrop":"yes"}', cfg), base);
  assert.deepEqual(parseSettings("not json", cfg), base);
});

test("shipped minimap config is valid", () => {
  const shipped = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));
  validateMinimap(shipped.minimap);
});

test("validateMinimap rejects mistakes", () => {
  assert.throws(() => validateMinimap({ ...cfg, markers: { ...cfg.markers, insert: "somewhere" as never } }), /insert/);
  assert.throws(() => validateMinimap({ ...cfg, quickSizes: { key: "key_F8", sizes: [1, 3] } }), /quickSizes/);
  assert.throws(() => validateMinimap({ ...cfg, quickSizes: { key: "F8", sizes: [1, 1.4] } }), /key_F8/);
  assert.throws(() => validateMinimap({ ...cfg, scale: { ...cfg.scale, default: 3 } }), /default/);
  assert.throws(() => validateMinimap({ ...cfg, markers: { ...cfg.markers, points: [{ x: 120, y: 5, kind: "crates" }] } }), /0-100/);
  assert.throws(() => validateMinimap({ ...cfg, flip: { mode: "sometimes" as never, whenFound: [] } }), /flip.mode/);
});
