Title: Event Timers HUD
Version: 1.0.0
Hero: none
Category: HUD
NSFW: no

## Description

A clean, game-styled HUD add-on that keeps you on top of the map's timings. Everything reads
the match clock on your own HUD, so it stays right through pauses, reconnects and new matches.
It only changes UI files: no memory reading, no injection.

- **Next events panel** (top right): countdowns to bridge buffs, Soul Urn drops, crate and
  statue spawns, jungle camp first spawns and the Unstable Rift.
- **Warning banners**: a gold banner 30 seconds before each event and a red one at 10 seconds,
  in the game's own announcement style.
- **Trooper wave countdown**: time to the next wave launching from base (first wave 0:17,
  then every 30s, 25s from 20:00, 20s from 35:00).
- **Next Quickbuy item**: souls still needed for the next item in your Quickbuy queue, with a
  "+2 READY" count when you can already afford earlier items. Clears when you clear the queue.
- **Minimap**: heavy (tough) crate markers that appear once crates spawn at 3:00, an optional
  grey-backdrop removal, and a bigger map on F8 (100% / 140%).
- **Options** (click OPTIONS on the panel while the shop is open): map size, map backdrop,
  crate markers, team-side flip, hide timers. **F9** hides or shows everything.
- Only runs in real matches (not the hideout, sandbox or Street Brawl).

Settings you change in-game last until you close the game; after a restart the mod starts
from its defaults (map 100%, backdrop off, crate markers on).

Note: it replaces the game's hud.xml, so it can't be combined with other mods that also
replace hud.xml. Crate spawn spots come from the community map at deadlockvault.net.

## Install

Easiest: install with Deadlock Mod Manager (https://deadlockmods.app) and search for this mod.

Manual: put the .vpk file into `Deadlock\game\citadel\addons` and make sure `gameinfo.gi`
loads addons (see INSTALL.txt in the download).

## Changelog

### 1.0.0
- Next events panel, 30s/10s banners, trooper wave countdown, next Quickbuy item.
- Minimap: heavy crate markers after 3:00, backdrop toggle, F8 map size, options panel.
- Only runs in real matches; re-syncs itself to the game clock and between matches.
- Game-styled look (Radiance/VALVEPulp fonts, the game's colours and announcement plates).

### 0.1.0
- First version: clock-based countdowns and 30s/10s warning banners.
