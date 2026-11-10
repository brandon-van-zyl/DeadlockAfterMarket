// The in-game JS engine (Panorama) may lack locale support. localeCompare in the event sort froze
// the timer rows at 3:00 in a real match, while every Node-based test passed. So: no
// locale-dependent APIs in the mod's code, and the simulator must survive without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const FORBIDDEN = /\b(localeCompare|toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleUpperCase|toLocaleLowerCase)\s*\(|\bIntl\./;

test("mod code uses no locale-dependent JavaScript", () => {
  const files = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
  for (const f of files) {
    const code = readFileSync(join(root, "src", f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, FORBIDDEN, `src/${f} uses a locale-dependent API`);
  }
});

test("rows keep updating past 3:00 when the engine has no locale support", () => {
  // Builds the script even without the game's hud.xml (CI has none); exit code 2 only means
  // "hud.xml not patched", which this test doesn't need.
  try {
    execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "ignore" });
  } catch (e) {
    if (e.status !== 2) throw e;
  }
  const out = execFileSync(process.execPath, [join(root, "scripts", "simulate.mjs"), "2:50", "3:20", "--panorama-js"], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(out, /error/i, out);
  assert.match(out, /3:15\s+panel:\s+Bridge buffs 1:45/, out);
});
