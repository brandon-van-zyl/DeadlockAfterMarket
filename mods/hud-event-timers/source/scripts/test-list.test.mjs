// Guards the "test" script: every *.test file must be listed, and every listed file must exist.
// (A missing space between two names once made node skip test files without any error.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const listed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.test.split(/\s+/).filter((a) => /\.test\./.test(a));

test("every test file is in npm test, and every listed file exists", () => {
  const onDisk = ["src", "scripts"].flatMap((d) => readdirSync(join(root, d)).filter((f) => /\.test\.(ts|mjs)$/.test(f)).map((f) => `${d}/${f}`));
  for (const f of listed) assert.ok(existsSync(join(root, f)), `listed but missing: ${f}`);
  assert.deepEqual([...listed].sort(), onDisk.sort());
});
