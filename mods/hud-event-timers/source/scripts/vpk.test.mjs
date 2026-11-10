import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildVpk, crc32 } from "./vpk.mjs";
import { readEntry, readVpkDir } from "./extract-panorama.mjs";

const files = {
  "panorama/layout/hud.vxml_c": Buffer.from("layout bytes"),
  "panorama/scripts/event_timers.vjs_c": Buffer.from("script bytes, a bit longer"),
  "panorama/styles/event_timers.vcss_c": Buffer.from("style"),
  "README": Buffer.from("no extension, no folder"),
};

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("a built VPK reads back with the same paths, bytes and CRCs", () => {
  const vpk = buildVpk(files);
  const { entries, dataStart } = readVpkDir(vpk);
  assert.deepEqual(entries.map((e) => e.path).sort(), Object.keys(files).map((p) => p.toLowerCase()).sort());
  for (const e of entries) {
    const bytes = readEntry("unused_dir.vpk", vpk, dataStart, e);
    const original = files[Object.keys(files).find((p) => p.toLowerCase() === e.path)];
    assert.deepEqual(bytes, original, e.path);
    assert.equal(e.crc, crc32(original));
    assert.equal(e.archive, 0x7fff);
  }
});

test("VPK v2 checksums cover the tree and the whole file", () => {
  const vpk = buildVpk(files);
  const treeSize = vpk.readUInt32LE(8);
  const dataSize = vpk.readUInt32LE(12);
  const tree = vpk.subarray(28, 28 + treeSize);
  const sums = vpk.subarray(28 + treeSize + dataSize);
  assert.equal(sums.length, 48);
  assert.deepEqual(sums.subarray(0, 16), createHash("md5").update(tree).digest());
  assert.deepEqual(sums.subarray(32), createHash("md5").update(vpk.subarray(0, vpk.length - 16)).digest());
});

test("duplicate paths are refused", () => {
  assert.throws(() => buildVpk({ "a/b.txt": Buffer.from("1"), "A/B.txt": Buffer.from("2") }), /Duplicate/);
});
