// Makes Deadlock's gameinfo.gi load addons\pak##_dir.vpk, the standard modding change:
//
//     Mod     citadel          <- the game's own config/mod path (keybinds etc.)
//     Write   citadel          <- where it saves settings
//     Game    citadel/addons   <- mods, searched before the base game
//     Game    citadel
//
// The Mod/Write lines matter: without them the engine treats the FIRST Game path as its mod
// and write folder, so with addons first it looks for its key bindings in addons\ and stops
// with "failed to load user key bindings". A Steam "verify files" or game update undoes this.

const line = (indent, key, gap, value) => `${indent}${key}${gap}${value}`;

/** Returns the patched text, or the same text if it's already set up. Never duplicates keys. */
export function addAddonsSearchPath(text) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const block = /SearchPaths\s*\{([\s\S]*?)\}/.exec(text);
  if (!block) throw new Error("gameinfo.gi has no SearchPaths block; not changing it");
  const body = block[1];
  const base = /^([ \t]*)Game([ \t]+)citadel[ \t]*\r?$/m.exec(body);
  if (!base) throw new Error('gameinfo.gi has no "Game citadel" line under SearchPaths; not changing it');
  const [, indent, gap] = base;

  const has = (re) => re.test(body);
  const add = [];
  if (!has(/^[ \t]*Mod[ \t]+citadel[ \t]*\r?$/m)) add.push(line(indent, "Mod", gap.replace(/\t/, ""), "citadel"));
  if (!has(/^[ \t]*Write[ \t]+citadel[ \t]*\r?$/m)) add.push(line(indent, "Write", gap.replace(/\t/, ""), "citadel"));
  const hasAddons = has(/^[ \t]*Game[ \t]+citadel\/addons[ \t]*\r?$/m);
  if (!hasAddons) add.push(line(indent, "Game", gap, "citadel/addons"));
  if (add.length === 0) return text;

  // Insert the missing lines above the addons line if it exists, else above "Game citadel".
  const anchor = hasAddons ? /^[ \t]*Game[ \t]+citadel\/addons[ \t]*\r?$/m : /^[ \t]*Game[ \t]+citadel[ \t]*\r?$/m;
  const newBody = body.replace(anchor, (m) => `${add.join(nl)}${nl}${m}`);
  const start = block.index + block[0].indexOf(body);
  return text.slice(0, start) + newBody + text.slice(start + body.length);
}
