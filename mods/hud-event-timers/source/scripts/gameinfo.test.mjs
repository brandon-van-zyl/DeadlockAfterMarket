import { test } from "node:test";
import assert from "node:assert/strict";
import { addAddonsSearchPath } from "./gameinfo.mjs";

const block = (...lines) => ["\t\tSearchPaths", "\t\t{", ...lines, "\t\t}", "\t\t\"ToolsDir\"\t\"../sdktools\""].join("\r\n");
const vanilla = block("\t\t\tGame_LowViolence\tcitadel_lv", "", "\t\t\tGame\t\t\t\tcitadel", "\t\t\tGame\t\t\t\tcore");
const searchPaths = (text) => /SearchPaths\s*\{([\s\S]*?)\}/.exec(text)[1].split("\r\n").map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);

test("adds Mod/Write citadel and the addons path above Game citadel, keeping CRLF", () => {
  const out = addAddonsSearchPath(vanilla);
  assert.deepEqual(searchPaths(out), ["Game_LowViolence citadel_lv", "Mod citadel", "Write citadel", "Game citadel/addons", "Game citadel", "Game core"]);
  assert.ok(!/[^\r]\n/.test(out), "only CRLF line endings");
});

test("repairs a file that only has the addons line (the keybinding crash)", () => {
  const broken = block("\t\t\tGame\t\t\t\tcitadel/addons", "\t\t\tGame\t\t\t\tcitadel", "\t\t\tGame\t\t\t\tcore");
  assert.deepEqual(searchPaths(addAddonsSearchPath(broken)), ["Mod citadel", "Write citadel", "Game citadel/addons", "Game citadel", "Game core"]);
});

test("running it twice changes nothing, and existing Mod/Write lines aren't duplicated", () => {
  const once = addAddonsSearchPath(vanilla);
  assert.equal(addAddonsSearchPath(once), once);
  const withMod = block("\t\t\tMod\t\t\tcitadel", "\t\t\tGame\t\t\t\tcitadel");
  assert.equal(searchPaths(addAddonsSearchPath(withMod)).filter((l) => l.startsWith("Mod")).length, 1);
});

test("refuses a file without the expected lines", () => {
  assert.throws(() => addAddonsSearchPath("nothing here"), /SearchPaths/);
  assert.throws(() => addAddonsSearchPath(block("\t\t\tGame core")), /no "Game citadel"/);
});
