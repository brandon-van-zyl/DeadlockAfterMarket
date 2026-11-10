// Builds the mod's Panorama files into ./content, ready to copy into CSDK for compiling.
//   npm run build            release build
//   npm run build -- --debug logs clock readings to the in-game console

import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../src/schedule.ts";
import { patchHud } from "./patch-hud.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");
const out = join(src, "content");
const debug = process.argv.includes("--debug");
const rel = (p) => relative(src, p);

// 1. Check the event list
const config = JSON.parse(await readFile(join(src, "events.json"), "utf8"));
validateConfig(config);

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "panorama", "scripts"), { recursive: true });
await mkdir(join(out, "panorama", "styles"), { recursive: true });
await mkdir(join(out, "panorama", "layout"), { recursive: true });

// 2. Bundle TypeScript + events.json into one classic script
const scriptOut = join(out, "panorama", "scripts", "event_timers.js");
await build({
  entryPoints: [join(src, "src", "main.ts")],
  outfile: scriptOut,
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  minify: false,
  legalComments: "none",
  define: { __DEBUG__: String(debug) },
  logLevel: "warning",
});

// 3. Styles
await copyFile(join(src, "panorama", "styles", "event_timers.css"), join(out, "panorama", "styles", "event_timers.css"));

// 4. hud.xml = the game's own hud.xml + this mod's includes and panels
const vanilla = join(src, "vanilla", "hud.xml");
const hudOut = join(out, "panorama", "layout", "hud.xml");
let hudOk = false;
if (existsSync(vanilla)) {
  const snippet = await readFile(join(src, "panorama", "layout", "hud_snippet.xml"), "utf8");
  await writeFile(hudOut, patchHud(await readFile(vanilla, "utf8"), snippet));
  hudOk = true;
}

console.log(`Built${debug ? " (debug)" : ""} -> ${rel(out)}`);
console.log(`  ${rel(scriptOut)}`);
console.log(`  ${rel(join(out, "panorama", "styles", "event_timers.css"))}`);
if (hudOk) {
  console.log(`  ${rel(hudOut)}`);
} else {
  console.log("");
  console.log("  hud.xml NOT built: put the game's current hud.xml in source/vanilla/hud.xml first.");
  console.log("  (Export panorama/layout/hud.vxml_c from Deadlock's pak01_dir.vpk with Source 2 Viewer.)");
  process.exitCode = 2;
}
