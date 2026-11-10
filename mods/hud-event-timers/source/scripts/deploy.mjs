// One command from source to a playable mod:
//   npm run deploy            build -> compile with CSDK 12 -> pack build\pak40_dir.vpk
//   npm run deploy:install    ...and copy it into Deadlock and enable addons in gameinfo.gi
// Options: --csdk "C:\Reduced_CSDK_12"   --game "Z:\...\Deadlock"   --pak 40   --debug
// CSDK 12 (community repack of Valve's CS2 Workshop Tools) must be unzipped somewhere first;
// Steam should be running while it compiles.

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVpk } from "./vpk.mjs";
import { addAddonsSearchPath } from "./gameinfo.mjs";
import { findGame } from "./extract-panorama.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");
const modDir = join(src, "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ADDON = "event_timers";
// CSDK 13 keeps the compiler in game\bin\win64, CSDK 12 in game\bin_tools\win64.
const COMPILERS = [join("game", "bin", "win64", "resourcecompiler.exe"), join("game", "bin_tools", "win64", "resourcecompiler.exe")];
const fail = (msg) => { console.error(`\n${msg}`); process.exit(1); };

/** Finds the CSDK folder (Reduced_CSDK_13 / _12, also when unzipped one folder deep). */
function findCsdk() {
  const given = opt("--csdk") ?? process.env.CSDK_ROOT;
  const home = homedir();
  const roots = given ? [given] : ["C:\\", "D:\\", "Z:\\", join(home, "Downloads"), join(home, "Desktop"), join(home, "Documents")];
  const names = ["Reduced_CSDK_13", "Reduced_CSDK_12", "CSDK_13", "CSDK_12"];
  const candidates = given ? [given, ...names.map((n) => join(given, n))] : roots.flatMap((r) => names.flatMap((n) => [join(r, n), join(r, n, n)]));
  for (const dir of candidates) {
    for (const c of COMPILERS) {
      if (existsSync(join(dir, c)) && existsSync(join(dir, "content"))) return { dir, compiler: join(dir, c) };
    }
  }
  return null;
}

function steamRunning() {
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq steam.exe", "/NH"], { encoding: "utf8" });
  return /steam\.exe/i.test(r.stdout ?? "");
}

function gameRunning() {
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq deadlock.exe", "/NH"], { encoding: "utf8" });
  return /deadlock\.exe/i.test(r.stdout ?? "");
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

// --- 1. Build the source files ---------------------------------------------------------
console.log("1/4 Building...");
const built = spawnSync(process.execPath, [join(here, "build.mjs"), ...(args.includes("--debug") ? ["--debug"] : [])], { stdio: "inherit" });
if (built.status !== 0) fail("Build failed (see above).");
const content = join(src, "content", "panorama");

// --- 2. Compile with CSDK 12 ----------------------------------------------------------
const found = findCsdk();
if (!found) {
  fail(
    "CSDK not found. Unzip Reduced_CSDK_13 to C:\\Reduced_CSDK_13 (or pass --csdk <folder>).\n" +
    `It must contain ${COMPILERS.join(" or ")}.`,
  );
}
const csdk = found.dir;
if (!steamRunning()) console.warn("Warning: Steam isn't running; CSDK's compiler may refuse to start.");
console.log(`2/4 Compiling with ${found.compiler}`);
const csdkContent = join(csdk, "content", "citadel_addons", ADDON);
const csdkGame = join(csdk, "game", "citadel_addons", ADDON);
rmSync(join(csdkContent, "panorama"), { recursive: true, force: true });
rmSync(join(csdkGame, "panorama"), { recursive: true, force: true });
mkdirSync(csdkContent, { recursive: true });
mkdirSync(csdkGame, { recursive: true });
cpSync(content, join(csdkContent, "panorama"), { recursive: true });

// Styles and scripts first: hud.xml includes them.
const order = (p) => (p.endsWith(".css") ? 0 : p.endsWith(".js") ? 1 : 2);
const sources = listFiles(join(csdkContent, "panorama")).sort((a, b) => order(a) - order(b));
const compilerDir = dirname(found.compiler);
for (const file of sources) {
  const r = spawnSync(found.compiler, ["-i", file, "-f"], { cwd: compilerDir, encoding: "utf8" });
  const log = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 || /error/i.test(log.replace(/0 error/gi, ""))) {
    console.error(log.trim());
    fail(`Compiling ${relative(csdkContent, file)} failed (exit ${r.status}).`);
  }
  console.log(`  compiled ${relative(csdkContent, file)}`);
}

// --- 3. Pack the compiled files -------------------------------------------------------
const compiled = listFiles(join(csdkGame, "panorama")).filter((p) => p.endsWith("_c"));
const expected = ["panorama/layout/hud.vxml_c", "panorama/scripts/event_timers.vjs_c", "panorama/styles/event_timers.vcss_c"];
const files = Object.fromEntries(compiled.map((p) => [relative(csdkGame, p).replace(/\\/g, "/"), readFileSync(p)]));
const missing = expected.filter((p) => !files[p]);
if (missing.length) fail(`Compiler didn't produce: ${missing.join(", ")}\nLook in ${csdkGame}`);
const pak = String(opt("--pak") ?? 40).padStart(2, "0");
const vpkName = `pak${pak}_dir.vpk`;
mkdirSync(join(modDir, "build"), { recursive: true });
const vpkPath = join(modDir, "build", vpkName);
writeFileSync(vpkPath, buildVpk(files));
console.log(`3/4 Packed ${Object.keys(files).length} files -> ${relative(join(modDir, ".."), vpkPath)}`);

// --- 4. Install into Deadlock (optional) ----------------------------------------------
if (!args.includes("--install")) {
  console.log("4/4 Skipped install (use npm run deploy:install to copy it into the game).");
  process.exit(0);
}
const game = findGame();
if (!game) fail('Deadlock not found. Pass --game "<Deadlock folder>".');
const citadel = join(game, "game", "citadel");
const addons = join(citadel, "addons");
mkdirSync(addons, { recursive: true });
if (gameRunning()) fail(`Deadlock is running and has the mod file locked. Close it, then run npm run deploy:install again.\nThe new VPK is ready at ${vpkPath}`);
copyFileSync(vpkPath, join(addons, vpkName));
console.log(`4/4 Installed ${join(addons, vpkName)}`);

const gameinfo = join(citadel, "gameinfo.gi");
const before = readFileSync(gameinfo, "utf8");
const after = addAddonsSearchPath(before);
if (after === before) {
  console.log("    gameinfo.gi already loads addons.");
} else if (gameRunning()) {
  console.log("    Close Deadlock, then run npm run deploy:install again to enable addons in gameinfo.gi.");
} else {
  const backup = join(citadel, "gameinfo.gi.before-addons.bak");
  if (!existsSync(backup)) writeFileSync(backup, before);
  writeFileSync(gameinfo, after);
  console.log(`    Enabled addons in gameinfo.gi (backup: ${backup}).`);
}
console.log("\nStart Deadlock (launch options -dev -console), play a bot match, and open the console (F7):");
console.log('you should see "[event-timers] loaded 11 events".');
