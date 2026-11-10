# Event Timers HUD: source

A HUD panel that counts down to map events, plus a banner 30s and 10s before each one.

## How it works

- `src/main.ts` runs inside the game's HUD (Panorama). Every 0.25s it reads the HUD's own
  match clock (the label with class `GameTime`), so pauses and reconnects are handled
  automatically. No memory reading or injection.
- `src/schedule.ts` is the timing logic (no game APIs, unit-tested in Node).
- **Staying in sync** (`src/sync.ts`): nothing counts on its own; every tick re-reads the game
  clock, so pauses, lag and reconnects can't make it drift. The HUD has more than one
  `GameTime` label, so the mod trusts the one that's actually ticking. Every 30s it re-finds
  every panel it reads and rewrites its own text/classes, so a panel the game swapped out heals
  by itself. When a new match starts (clock jumps back, or you come back from the hideout) it
  resets banners and un-hides itself. It only runs during a real match (`match` in
  `events.json`: `GameStateInProgress`, not the hideout, sandbox, tutorial or Street Brawl).
  `npm run sim -- 4:20 5:05 --stale-clock`, `npm run sim -- 30:00 34:00 --new-match-at 31:00`
  and `npm run sim -- 24:10 27:10 --end-at 25:00` (match ends, 20s post-game, new match)
  replay those cases.
- `events.json` lists the events. Edit it after patches. Times are match-clock `m:ss`;
  `every` is the repeat interval in seconds; `approx: true` shows a `~`; `enabled: false`
  hides an event.
- A small `WAVE 0:12` line above the panel counts down to the next trooper wave. It never
  shows a banner and only turns gold in the last `soonSeconds`. The `waves` block in
  `events.json` sets the intervals: 30s, then 25s from 20:00, then 20s from 35:00
  (deadlock.wiki/Trooper). Set `"enabled": false` there to hide it.
- A `NEXT  Mystic Burst  1,150` line above that walks your whole Quickbuy queue. It counts
  down to the first item, and once you can afford that one it moves on to the second
  (`NEXT  Enduring Speed  800  +1 READY`), and so on. The count includes the items before it,
  since you'd buy those first. When you can afford the whole queue it shows a gold
  `All 3 items  READY`. Buying removes the item and the line keeps going. It hides when the
  queue is empty. It reads your souls and the queued item's name and price
  straight from the HUD (`src/shop.ts` does the maths). The `nextItem.find` lists in
  `events.json` say where to look and are **guesses until checked in-game** (see below).
- **Options panel:** click `OPTIONS` on the panel title while your cursor is free (e.g. shop
  open). It has:
  - **Map size:** `-` / `+` scale the minimap from 100% to 160% in 5% steps. It grows away
    from its screen corner (`minimap.anchor`).
  - **Crate markers** on or off.
  - **Team side flip:** `AUTO` / `ON` / `OFF` (see below).
  - **Hide timers.**
  Settings are saved if the game allows it (`$.persistentStorage`); otherwise they reset each
  launch and the defaults come from `minimap.scale.default` in `events.json`.
- **Crate markers on the minimap:** small, dim gold diamonds at the crate spawn spots. They
  brighten for the last 30s before their crates spawn (each marker's `kind` matches an event id
  such as `crates` or `tunnel-crates`). They sit just above the map picture, so hero and enemy
  icons draw on top of them. They show where crates spawn, not whether one is still there.
  - **Zoom/pan:** every tick the marker layer copies the map picture's size, position and
    transform, so markers stay on their spots when the map zooms or moves. With
    `"insert": "inside"` they're children of the map picture and follow it automatically.
  - **Team sides:** if the game turns the map picture for the other team, markers follow that
    rotation by themselves. If it swaps the picture instead, `AUTO` flips the markers while one
    of `minimap.flip.whenFound` exists in the HUD (something only one team's HUD has), and
    `ON`/`OFF` override it.
- **Hiding it:** press **F9**, or use **Hide timers** in the options, to hide everything the
  mod draws (the map size stays). A faint `TIMERS HIDDEN · F9` chip stays; click it or press
  F9 again to bring it all back. Set `hide.autoHideAt` in
  `events.json` (e.g. `"30:00"`) to hide it automatically late in the match, and change
  `hide.key` for a different key.
- The build bundles everything into one script and inserts the panel plus `<include>` lines
  into **the game's own current `hud.xml`**, so other HUD elements stay as Valve made them.

Only fixed-schedule events can be predicted from the clock. Things that respawn after
being killed or broken (mid boss/Rejuvenator, crate respawns, camp respawns) are listed
by first spawn only.

## One-time setup

1. Install Node.js (already done on this PC), then in this folder:
   ```
   npm install
   ```
2. Install **Source 2 Viewer** (https://valveresourceformat.github.io) and **CSDK 12**
   (the Deadlock modding toolkit used in the community guides).

## Build

0. **Look up the game's real panel names (optional, after patches):** `npm run extract`
   reads Deadlock's `pak01_dir.vpk` (found through Steam) and writes the UI stylesheets to
   `vanilla\extracted\panorama\styles\`, plus readable strings from each compiled layout as
   `*.strings.txt`. The ids/classes in `events.json` came from these (`hud_minimap.css`,
   `hud_quickbuy*.css`, `hud_gold_and_ap_container.css`, `citadel_hud_top_bar.css`). Layouts
   are compiled binaries now, so this can't produce a usable `hud.xml`; that still needs
   Source 2 Viewer (step 1). Everything in `vanilla\` is Valve's: never upload it.
1. **Get the game's current hud.xml.** In Source 2 Viewer, open
   `Deadlock\game\citadel\pak01_dir.vpk`, find `panorama/layout/hud.vxml_c`, decompile/export
   it, and save it as `source\vanilla\hud.xml`. Redo this after every game patch that
   touches the HUD.
2. **Build:**
   ```
   npm test
   npm run build
   ```
   Output goes to `source\content\panorama\...` (script, styles, patched hud.xml).
   `npm run build -- --debug` also logs clock readings to the in-game console.
3. **Preview in the browser (do this before testing in-game):**
   ```
   npm run preview
   ```
   Opens a local page that runs the real mod script and `events.json` against a fake match
   clock, drawn over the first screenshot in `mods\hud-event-timers\images\` (add one from a
   match for a realistic background).
   - Play/Pause (Space), speed 1x/10x/60x, a slider and a `m:ss` box to jump to any time
     (e.g. `4:28` to watch the 4:30 bridge-buff banner).
   - **Next warning** jumps to 3 seconds before the next banner and plays.
   - At 10x/60x it pauses when a banner appears, so you can see it (untick to disable).
   - Jumping works like a reconnect: banners only fire when the clock plays through a warning.
   - **Souls**, **+500** and **Buy next** drive a fake souls counter and an example Quickbuy
     queue (placeholder names and prices). Souls also go up slowly while the clock plays.
   - **Fake minimap** (bottom-left) with example hero icons. **Other team side** and **Zoomed**
     mimic the game turning and zooming the map, to check the markers follow.
   - **Placing crate markers:** save a minimap screenshot from a match as
     `source\preview\minimap.png`, cropped to just the map. If you were on team 2 (map
     mirrored), turn it 180° first: markers are stored for the non-mirrored map. Tick **Place
     markers**, pick the kind (`crates`, `tunnel-crates`, ...), click each spawn spot (use a
     community map for where they are), right-click to remove one. **Copy markers** copies the
     list; paste it over `"points": []` under `minimap.markers` in `events.json`. **Reset draft**
     goes back to what's in `events.json`.
   - Saving the CSS, `hud_snippet.xml`, `events.json`, code or images reloads the page, and
     a typo in `events.json` shows as an error at the top.
   - Panorama CSS is converted to browser CSS (alignment and `flow-children` become
     flexbox/positioning), so fonts and spacing are close but not exact. Check the final
     look in a bot match.

   For a text-only check: `npm run sim -- 4:20 10:30` prints what the panel and banners
   show over that time range. Its last line counts the script's work: HUD searches, text
   writes and class changes per second. Keep those near zero (about 0.0, 2 and 0.1 per
   second today) so the mod stays cheap. The next-item line adds about 2 small searches a
   second inside the Quickbuy queue (not the whole HUD), plus a text write whenever your
   souls change.
4. **Compile, pack and install in one go:** unzip CSDK 12 (from
   https://deadlockmodding.pages.dev/modding-tools/csdk-12) to `C:\Reduced_CSDK_12`, keep
   Steam open, close Deadlock, then:
   ```
   npm run deploy:install
   ```
   It builds, copies the files into CSDK's `content\citadel_addons\event_timers\`, compiles
   them with `resourcecompiler.exe`, packs `mods\hud-event-timers\build\pak40_dir.vpk` (our own
   VPK writer, `scripts\vpk.mjs`), copies it to `Deadlock\game\citadel\addons\`, and adds
   `Game citadel/addons` to `gameinfo.gi` (backup: `gameinfo.gi.before-addons.bak`).
   `npm run deploy` does everything except the install. Options: `--csdk <folder>`,
   `--pak 41`, `--debug`.

   Doing it by hand instead (old way): **Compile and pack with CSDK 12.**
   - Copy the `content\panorama` folder into CSDK's
     `content\citadel_addons\event_timers\` folder (create it).
   - Compile it there, then use the CS2 Workshop Manager (New > Submit) to get the VPK in
     `game\citadel_addons`. The compiled files are `.vjs_c`, `.vcss_c` and `.vxml_c`.
   - Rename the VPK to `pak##_dir.vpk` (e.g. `pak40_dir.vpk`) and put it in
     `mods\hud-event-timers\build\`.
5. **Package for GameBanana** from the repo root:
   ```
   .\tools\package.ps1 hud-event-timers
   ```

## Testing in-game

1. Copy the VPK into `Deadlock\game\citadel\addons`. Mod Manager sets the game up to load
   addons. Doing it by hand, `game\citadel\gameinfo.gi` needs `Game citadel/addons` above
   `Game citadel` under `SearchPaths`.
2. Launch with `-dev -console` (Steam > Deadlock > Properties > Launch options) and
   start a bot match or sandbox.
3. In the console you should see `[event-timers] loaded 11 events`. With a `--debug` build
   you'll also see the clock it reads. F6 opens the Panorama debugger. The game runs
   slowly while it's open.

**Confirmed from the game's own files** (Source 2 Viewer export + F6 debugger, Nov 2026):
clock `Label#GameTime.GameTime` (`{s:game_clock}`); souls `Label#hudCurGoldLabel`; queue
`#QuickbuyQueue` filled with `.QuickbuyItem` entries holding `#ModName` / `#ModCost`; minimap
`#HudMinimapContainer > HudMinimap#hud_minimap` (gets `.invert_map` for team 2) with the map
picture `#MinimapBackgroundTest` as its first child. The full exported layouts are in
`vanilla\layout-xml\` for looking things up.

**Untested assumptions to check the first time** (this was built without the game running):
- The clock label still has class `GameTime` (it's what other timer mods use). If the panel
  never appears, find the clock in the F6 debugger and update `findClock` in `src/main.ts`.
- Fonts: the CSS uses `"Valve Pulp"` (titles, timers, banner) and `"Valve Occult"` (event
  names), the names fan sources give for Deadlock's UI fonts. If the game shows a plain
  fallback font, check a vanilla label's `font-family` in the F6 debugger and use that name.
  For the browser preview, drop the font files into `source\preview\fonts\` (see the README
  there). Until then it shows the Oswald lookalike.
- Gradients and text-shadow use Valve's Panorama syntax (`gradient( linear, ... )`,
  `x y blur strength color`). If either doesn't render, swap it for a plain
  `background-color` or remove the shadow.
- Panel position and look: adjust `panorama/styles/event_timers.css` (`margin-top`,
  `margin-right`, sizes).
- The clock shows match time from 0:00 at the start, not including pre-game.
- **Next item line (needs a one-time setup).** If it never appears:
  1. Build with `npm run build -- --debug`, load a bot match and queue an item.
  2. The console prints `next-item: souls NOT found / queue ...` and then a list of labels
     that contain numbers, with their panel path, e.g. `/#HudRoot/#SoulsDisplay [Label] "1,250"`.
     Your souls count and the queued item's price will be in that list.
  3. In the F6 debugger, check those panels plus the queue container, one queued item, and
     its name label. Put each `#id` or `.class` first in the matching `nextItem.find` list in
     `events.json`, then rebuild.
  4. If the queue shows no price as text (only an icon), tell me: the line would then need a
     small item price table instead.
- **Minimap (one-time setup).** In the F6 debugger find the whole minimap panel and the panel
  that draws the map picture; put their `#id`/`.class` first in `minimap.find.minimap` and
  `minimap.find.mapLayer`. A `--debug` build logs `minimap found / map layer found`. If hero
  icons are children of the map picture panel, use `"insert": "inside"`. Check that markers line
  up on both team sides and when the map zooms; if they're mirrored on one side, set
  `minimap.flip.whenFound` to something only that side's HUD has (or use `ON`/`OFF`).
  Clicks on the options need a free cursor; if `SetPanelEvent` isn't available the options
  won't respond and the defaults from `events.json` apply.
- Hide key: Panorama may only pass key presses to the HUD while it has keyboard focus
  (e.g. shop open), not while you're moving and shooting. If F9 does nothing in a fight,
  use the title/chip click, or `autoHideAt`. Key names follow Panorama's `key_...` style;
  if `key_F9` isn't recognised the console shows `could not bind`.
- Waves count down to the **spawn at base** (troopers launching on the zipline), not landing
  in lane, which changes through the game. `waves.firstWave` (0:17, seen in a real match) is
  the first spawn; each next wave follows the last by the interval in force (30s, 25s from
  20:00, 20s from 35:00). If the first wave moves after a patch, change `firstWave` only.
  Older note: the countdown used to assume the first wave at 0:00 and that each interval change
  starts its own rhythm (20:00, 35:00). If the line is a few seconds off what you see in
  lane, shift the phase `from` times in `events.json`.

## After a game patch

1. Re-export `hud.xml` into `vanilla\` and rebuild. An old hud.xml can break the HUD.
2. Check the patch notes for spawn time changes and update `events.json`.
3. Bump the version in `mods\hud-event-timers\mod.md`, repack and re-upload.
