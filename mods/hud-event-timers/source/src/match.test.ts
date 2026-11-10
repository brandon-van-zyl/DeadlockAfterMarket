import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchActive, validateMatch } from "./match.ts";

const shipped = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8")).match;
const has = (classes: string) => (c: string) => classes.split(" ").includes(c);

test("a standard match counts (classes from the real HUD root)", () => {
  const root = "WindowRoot connectedToGame joined_team alive isDefaultMap loaded localPlayerTeam2 IsHideoutExclusive gamemode_standard is3LaneMap GameStateInProgress";
  assert.equal(matchActive(shipped, has(root)), true);
});

test("the hideout, pre-game, sandbox and street brawl don't count", () => {
  assert.equal(matchActive(shipped, has("connectedToHideout InHideout GameStateInProgress")), false);
  assert.equal(matchActive(shipped, has("connectedToGame GameStatePreGameWait")), false);
  assert.equal(matchActive(shipped, has("connectedToNewPlayerSandbox GameStateInProgress")), false);
  assert.equal(matchActive(shipped, has("connectedToGame gamemode_streetbrawl GameStateInProgress")), false);
});

test("without a config everything counts (old behaviour)", () => {
  assert.equal(matchActive(undefined, () => false), true);
});

test("shipped match config is valid; bad names are refused", () => {
  validateMatch(shipped);
  assert.throws(() => validateMatch({ requireClasses: [".GameStateInProgress"], blockClasses: [] }), /bare class/);
});
