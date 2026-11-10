// Pulls Deadlock's Panorama UI files (layouts, styles, scripts) out of the game's VPK, so the
// build can patch the current hud.xml and we can look up real panel names. Read-only: it never
// touches the game folder.
//   npm run extract                      find Deadlock via Steam's library list
//   npm run extract -- --game "Z:\SteamLibrary\steamapps\common\Deadlock"
// Output: vanilla/hud.xml (used by the build) and vanilla/extracted/panorama/... (for searching).
// These are Valve's files: keep them local, never upload them.

import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vanillaDir = join(here, "..", "vanilla");
const args = process.argv.slice(2);

/** Finds the Deadlock folder from Steam's libraryfolders.vdf. */
export function findGame() {
  const arg = args.indexOf("--game");
  if (arg >= 0) return args[arg + 1];
  const steamRoots = ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"];
  for (const root of steamRoots) {
    const vdf = join(root, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    const libs = [...readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"));
    for (const lib of libs) {
      const game = join(lib, "steamapps", "common", "Deadlock");
      if (existsSync(join(game, "game", "citadel", "pak01_dir.vpk"))) return game;
    }
  }
  return null;
}

/** Reads a VPK v1/v2 directory: returns entries { path, crc, preload, archive, offset, length }. */
export function readVpkDir(buf) {
  if (buf.readUInt32LE(0) !== 0x55aa1234) throw new Error("Not a VPK file");
  const version = buf.readUInt32LE(4);
  const treeSize = buf.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const treeEnd = headerSize + treeSize;
  let pos = headerSize;
  const str = () => {
    const end = buf.indexOf(0, pos);
    const s = buf.toString("utf8", pos, end);
    pos = end + 1;
    return s;
  };
  const entries = [];
  for (;;) {
    const ext = str();
    if (!ext) break;
    for (;;) {
      const dir = str();
      if (!dir) break;
      for (;;) {
        const name = str();
        if (!name) break;
        const crc = buf.readUInt32LE(pos);
        const preloadBytes = buf.readUInt16LE(pos + 4);
        const archive = buf.readUInt16LE(pos + 6);
        const offset = buf.readUInt32LE(pos + 8);
        const length = buf.readUInt32LE(pos + 12);
        pos += 18; // + 0xFFFF terminator
        const preload = buf.subarray(pos, pos + preloadBytes);
        pos += preloadBytes;
        const path = `${dir === " " ? "" : `${dir}/`}${name}${ext === " " ? "" : `.${ext}`}`;
        entries.push({ path, crc, preload, archive, offset, length });
      }
    }
  }
  return { entries, dataStart: treeEnd };
}

/** File bytes for an entry: preload data + the rest from the dir file or a numbered archive. */
export function readEntry(vpkDirPath, dirBuf, dataStart, e) {
  if (e.length === 0) return Buffer.from(e.preload);
  let rest;
  if (e.archive === 0x7fff) {
    rest = dirBuf.subarray(dataStart + e.offset, dataStart + e.offset + e.length);
  } else {
    const archivePath = vpkDirPath.replace(/_dir\.vpk$/, `_${String(e.archive).padStart(3, "0")}.vpk`);
    const fd = openSync(archivePath, "r");
    try {
      rest = Buffer.alloc(e.length);
      readSync(fd, rest, 0, e.length, e.offset);
    } finally {
      closeSync(fd);
    }
  }
  return Buffer.concat([e.preload, rest]);
}

/** Resource blocks of a compiled file: { type, data }. */
export function resourceBlocks(buf) {
  const blockOffset = buf.readUInt32LE(8);
  const blockCount = buf.readUInt32LE(12);
  const out = [];
  for (let i = 0; i < blockCount; i++) {
    const at = 8 + blockOffset + i * 12;
    const start = at + 4 + buf.readUInt32LE(at + 4);
    out.push({ type: buf.toString("ascii", at, at + 4), data: buf.subarray(start, start + buf.readUInt32LE(at + 8)) });
  }
  return out;
}

/**
 * Readable strings (3+ chars) from a compiled layout's LaCo block, in file order. Current
 * Deadlock layouts are stored in this binary form, so this is how we see panel types, ids and
 * classes without a decompiler. Returns null if the file has no LaCo block.
 */
export function layoutStrings(buf) {
  const laco = resourceBlocks(buf).find((b) => b.type === "LaCo");
  if (!laco) return null;
  return [...laco.data.toString("latin1").matchAll(/[\x20-\x7e]{3,}/g)].map((m) => m[0]);
}

/**
 * Source text from a compiled Panorama resource (.vcss_c / .vjs_c and old-style .vxml_c). Their
 * DATA block holds the original file after a small header, so we take it from the first text
 * character.
 */
export function panoramaSource(buf) {
  for (const { type, data } of resourceBlocks(buf)) {
    if (type !== "DATA") continue;
    // Header: CRC (4) + source size (2) + ... ; the source starts at the first printable char.
    let s = 6;
    while (s < data.length && (data[s] < 0x09 || (data[s] > 0x0d && data[s] < 0x20))) s++;
    let end = data.length;
    while (end > s && data[end - 1] === 0) end--;
    return data.toString("utf8", s, end);
  }
  throw new Error("No DATA block");
}

async function main() {
  const game = findGame();
  if (!game) {
    console.error('Deadlock not found. Run: npm run extract -- --game "<path to Deadlock>"');
    process.exit(1);
  }
  const vpkPath = join(game, "game", "citadel", "pak01_dir.vpk");
  console.log(`Reading ${vpkPath}`);
  const dirBuf = readFileSync(vpkPath);
  const { entries, dataStart } = readVpkDir(dirBuf);
  const wanted = entries.filter((e) => e.path.startsWith("panorama/") && /\.(vxml_c|vcss_c|vjs_c|vts_c)$/.test(e.path));
  let text = 0, binary = 0;
  const failed = [];
  for (const e of wanted) {
    try {
      const buf = readEntry(vpkPath, dirBuf, dataStart, e);
      const base = join(vanillaDir, "extracted", e.path.replace(/\.v(xml|css|js|ts)_c$/, ".$1"));
      await mkdir(dirname(base), { recursive: true });
      const strings = e.path.endsWith(".vxml_c") ? layoutStrings(buf) : null;
      if (strings) {
        // Binary layout: save its strings for searching (not a usable hud.xml).
        await writeFile(`${base}.strings.txt`, strings.join("\n") + "\n");
        binary++;
      } else {
        await writeFile(base, panoramaSource(buf));
        text++;
      }
    } catch (err) {
      failed.push(`${e.path}: ${err.message}`);
    }
  }
  console.log(`Extracted ${text} text files (styles/scripts) and ${binary} binary layouts (as .strings.txt) to vanilla/extracted/`);
  if (failed.length) console.log(`Couldn't read ${failed.length}:\n  ${failed.slice(0, 10).join("\n  ")}`);
  const hud = join(vanillaDir, "extracted", "panorama", "layout", "hud.xml");
  if (existsSync(hud)) {
    await writeFile(join(vanillaDir, "hud.xml"), readFileSync(hud));
    console.log("Copied panorama/layout/hud.xml to vanilla/hud.xml (used by npm run build).");
  } else {
    console.log("hud.xml is a compiled binary layout: export it as XML with Source 2 Viewer for the build (see README).");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
