// Writes a single-file VPK (version 2), the format Deadlock loads from game\citadel\addons\.
// All file data lives in the _dir.vpk itself (archive index 0x7FFF), like community mod paks.

import { createHash } from "node:crypto";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const md5 = (...parts) => {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return h.digest();
};

/** Splits "panorama/layout/hud.vxml_c" into VPK tree parts (" " means none). */
function splitPath(path) {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const slash = clean.lastIndexOf("/");
  const dir = slash >= 0 ? clean.slice(0, slash) : " ";
  const file = clean.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return { dir: dir || " ", name: dot > 0 ? file.slice(0, dot) : file, ext: dot > 0 ? file.slice(dot + 1) : " " };
}

/**
 * Builds a VPK from { "panorama/layout/hud.vxml_c": Buffer, ... }.
 * Paths are stored lower-case with forward slashes, as the engine looks them up.
 */
export function buildVpk(files) {
  const entries = Object.entries(files).map(([path, data]) => ({ ...splitPath(path), data }));
  const seen = new Set();
  for (const e of entries) {
    const key = `${e.dir}/${e.name}.${e.ext}`;
    if (seen.has(key)) throw new Error(`Duplicate path in VPK: ${key}`);
    seen.add(key);
  }

  // Tree: extension -> directory -> file, each list ended by an empty string.
  const byExt = new Map();
  for (const e of entries) {
    if (!byExt.has(e.ext)) byExt.set(e.ext, new Map());
    const dirs = byExt.get(e.ext);
    if (!dirs.has(e.dir)) dirs.set(e.dir, []);
    dirs.get(e.dir).push(e);
  }
  const tree = [];
  const data = [];
  let offset = 0;
  const str = (s) => tree.push(Buffer.from(`${s}\0`, "utf8"));
  for (const [ext, dirs] of byExt) {
    str(ext);
    for (const [dir, list] of dirs) {
      str(dir);
      for (const e of list) {
        str(e.name);
        const meta = Buffer.alloc(18);
        meta.writeUInt32LE(crc32(e.data), 0);
        meta.writeUInt16LE(0, 4); // preload bytes
        meta.writeUInt16LE(0x7fff, 6); // data is in this file
        meta.writeUInt32LE(offset, 8);
        meta.writeUInt32LE(e.data.length, 12);
        meta.writeUInt16LE(0xffff, 16);
        tree.push(meta);
        data.push(e.data);
        offset += e.data.length;
      }
      str("");
    }
    str("");
  }
  str("");
  const treeBuf = Buffer.concat(tree);
  const dataBuf = Buffer.concat(data);
  const archiveMd5 = Buffer.alloc(0);

  const header = Buffer.alloc(28);
  header.writeUInt32LE(0x55aa1234, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(treeBuf.length, 8);
  header.writeUInt32LE(dataBuf.length, 12);
  header.writeUInt32LE(archiveMd5.length, 16);
  header.writeUInt32LE(48, 20); // tree, archive-section and whole-file MD5s
  header.writeUInt32LE(0, 24); // no signature

  const treeSum = md5(treeBuf);
  const archiveSum = md5(archiveMd5);
  const wholeSum = md5(header, treeBuf, dataBuf, archiveMd5, treeSum, archiveSum);
  return Buffer.concat([header, treeBuf, dataBuf, archiveMd5, treeSum, archiveSum, wholeSum]);
}
