// Panorama entry point. Reads the HUD match clock and drives the timer panel
// declared in panorama/layout/hud_snippet.xml.
//
// Kept cheap on purpose: panels are looked up once and cached, the HUD is only searched
// again if Valve rebuilds it, and text/classes are only written when they change. Most
// ticks see the same clock second as the last one and do nothing beyond one text read.

import rawConfig from "../events.json";
import crateLocations from "../crate_locations.json";
import { type Banner, type Config, bannerText, crossedWarnings, formatSeconds, nextWave, parseClock, upcoming } from "./schedule.ts";
import { formatSouls, orderQueue, queueStatus } from "./shop.ts";
import { matchActive } from "./match.ts";
import { chooseClock, clockRestarted } from "./sync.ts";
import {
  clampScale, defaultSettings, flipActive, type LocationData, locationPoints, type MapPoint, type MapSettings,
  markerLook, markerPosition, type MarkerState, markerStates, type MarkerType,
  effectiveScale, nextFlipMode, nextQuickSize, parseSettings, soonKinds, uiScaleValue,
} from "./minimap.ts";

const config = rawConfig as unknown as Config; // checked by validateConfig at build time
const TICK_SECONDS = 0.25;
/** While the clock isn't found (menus, loading), search the HUD at most this often. */
const CLOCK_RETRY_SECONDS = 2;
const ROWS = 4;
const LOG = "[event-timers]";

// Replaced at build time: `npm run build -- --debug` logs clock readings to the console.
declare const __DEBUG__: boolean;
const DEBUG = __DEBUG__;

/**
 * The HUD layout this script was loaded into (CitadelHud). Our own panels are looked up only
 * here, so if the game ever has a second HUD instance we can never show a banner on one copy
 * and hide it on another.
 */
let ctx: Panel | null = null;
/** Where the game's panels (clock, souls, minimap) are searched: ctx, or the whole UI as fallback. */
let root: Panel | null = null;
let clockSearches = 0;
/** Clock searches inside our own HUD before also looking through the whole UI. */
const CLOCK_SEARCHES_BEFORE_FALLBACK = 5;
/** Every GameTime label in the HUD (there's more than one); we trust the one that's ticking. */
let clocks: { panel: LabelPanel; lastText: string | null; changedAt: number }[] = [];
let clockIndex = -1;
let nextClockSearch = 0;
/** Re-find everything we read this often, in case the game swapped panels under us. */
const RESYNC_SECONDS = 30;
let nextResync = RESYNC_SECONDS;
let elapsed = 0;
let lastClockText: string | null = null;
let prevNow: number | null = null;
/** The banner shows until this script time. Re-applied every tick, so it can't get stuck. */
let bannerUntil = 0;

/** Cached panels by id, plus the last text/classes we wrote to each. */
const panels = new Map<string, LabelPanel>();
const texts = new Map<string, string>();
const classes = new Map<string, boolean>();

function valid<T extends Panel>(p: T | null | undefined): p is T {
  return p != null && p.IsValid();
}

function resetCache(): void {
  panels.clear();
  texts.clear();
  classes.clear();
  lastClockText = null;
}

function hudRoot(): Panel {
  let p = $.GetContextPanel();
  let parent = p.GetParent();
  while (parent) {
    p = parent;
    parent = p.GetParent();
  }
  return p;
}

/** Re-finds all clock labels, keeping what we knew about ones that are still there. */
function findClocks(r: Panel): void {
  const found = (r.FindChildrenWithClassTraverse("GameTime") ?? []) as LabelPanel[];
  clocks = found.map((panel) => clocks.find((c) => c.panel === panel) ?? { panel, lastText: null, changedAt: -1 });
  if (clockIndex >= clocks.length) clockIndex = -1;
}

/** The current clock text from the live clock label, or null if none is readable. */
function readClock(): string | null {
  for (const c of clocks) {
    const text = valid(c.panel) ? c.panel.text : null;
    if (text !== c.lastText) { c.lastText = text; c.changedAt = elapsed; }
  }
  clockIndex = chooseClock(clocks.map((c) => ({ text: c.lastText, changedAt: c.changedAt })), clockIndex);
  return clockIndex >= 0 ? clocks[clockIndex].lastText : null;
}

/** Cached lookup. A stale panel (HUD rebuilt) clears the cache so everything is re-found. */
function el(id: string): LabelPanel | null {
  const cached = panels.get(id);
  if (cached) {
    if (cached.IsValid()) return cached;
    resetCache();
  }
  if (!valid(ctx)) return null;
  const found = ctx.FindChildTraverse(id) as LabelPanel | null;
  if (found) panels.set(id, found);
  return found;
}

function setText(id: string, text: string): void {
  if (texts.get(id) === text) return;
  const p = el(id);
  if (!p) return;
  p.text = text;
  texts.set(id, text);
}

function setClass(id: string, cls: string, on: boolean): void {
  const key = `${id}.${cls}`;
  if (classes.get(key) === on) return;
  const p = el(id);
  if (!p) return;
  p.SetHasClass(cls, on);
  classes.set(key, on);
}

// --- Hide/show the whole mod HUD ---------------------------------------------------
// A key (if Panorama delivers it), the HIDE TIMERS button or the "hidden" chip, and an
// optional auto-hide time. Hiding only adds a class; the script keeps running so showing
// again is instant and correct. The minimap size setting stays as it is.

const MOD_PANELS = ["DATimers", "DAWave", "DANextItem", "DATimersBanner", "DAOptions"];
let userHidden = false;
let autoHideDone = false;
let clickHandlersSet = false;
let optionsOpen = false;

function keyLabel(): string {
  return (config.hide?.key ?? "").replace(/^key_/, "").toUpperCase();
}

function setUserHidden(hidden: boolean): void {
  userHidden = hidden;
  for (const id of MOD_PANELS) setClass(id, "DAUserHidden", hidden);
  if (valid(markerLayer)) markerLayer.SetHasClass("DAUserHidden", hidden);
  const key = keyLabel();
  setText("DAToggleText", key ? `TIMERS HIDDEN · ${key}` : "TIMERS HIDDEN");
  setClass("DAToggle", "Hidden", !hidden || lastActive === false);
  if (DEBUG) $.Msg(LOG, hidden ? "hidden" : "shown");
}

function toggleHidden(): void {
  setUserHidden(!userHidden);
}

function setOptionsOpen(open: boolean): void {
  optionsOpen = open;
  setClass("DAOptions", "Hidden", !open);
  renderOptions();
}

/** Click handlers need the panels to exist, so they're attached on the first tick that finds them. */
let nextClickSetup = 0;
let clickSetupTries = 0;
function setupClicks(): void {
  // Retry like the clock search, and give up after a while (e.g. no click support): keeps it cheap.
  if (clickHandlersSet || elapsed < nextClickSetup || clickSetupTries >= 30) return;
  nextClickSetup = elapsed + CLOCK_RETRY_SECONDS;
  clickSetupTries++;
  const handlers: Record<string, () => void> = {
    DAToggle: () => setUserHidden(false),
    DAOptionsButton: () => setOptionsOpen(!optionsOpen),
    DAHideButton: () => { setOptionsOpen(false); setUserHidden(true); },
    DAMapSizeDown: () => changeMapScale(-1),
    DAMapSizeUp: () => changeMapScale(1),
    DAMarkersToggle: () => updateSettings({ markers: !mapSettings.markers }),
    DABackdropToggle: () => updateSettings({ backdrop: !mapSettings.backdrop }),
    DAFlipToggle: () => updateSettings({ flip: nextFlipMode(mapSettings.flip) }),
  };
  const found = Object.keys(handlers).map((id) => [id, el(id)] as const);
  if (found.some(([, p]) => !p || !p.SetPanelEvent)) return;
  for (const [id, p] of found) p!.SetPanelEvent!("onactivate", handlers[id]);
  clickHandlersSet = true;
  renderOptions();
}

// --- Minimap: size setting and crate markers ------------------------------------------
// Map size: ui-scale on the scale target (#hud_minimap). Not a transform, because the game
// mirrors the minimap with a transform for one team and we must not overwrite that.
// Markers: a layer placed right after the map picture inside #hud_minimap, so every icon after
// it draws on top. It copies the map picture's size each tick. The game zooms by resizing
// #hud_minimap and mirrors it for team 2, so markers inside it follow both by themselves.

const SETTINGS_KEY = "deadlock-aftermarket.event-timers.settings";
const mm = config.minimap && config.minimap.enabled !== false ? config.minimap : null;
let mapSettings: MapSettings = mm ? loadSettings(mm) : { mapScale: 1, markers: false, flip: "off", backdrop: true };
let scalePanel: Panel | null = null;
let minimapPanel: Panel | null = null;
let mapLayer: Panel | null = null;
let markerLayer: Panel | null = null;
let markerPanels: { panel: Panel; point: MapPoint }[] = [];
let nextMapSearch = 0;
let mapSearches = 0;
let nextTeamCheck = 0;
let teamMatch = false;
let inheritsGameFlip = false;
let appliedScaleKey = "";
let layoutKey = "";
let soonKey = "";

/**
 * Where settings are kept. The game may not have $.persistentStorage, so they are also stored
 * as an attribute on the top-level UI panel, which outlives the HUD reload at every new match
 * (but not a game restart: then events.json's defaults apply).
 */
function readStoredSettings(): string | null {
  try {
    const stored = $.persistentStorage?.getItem(SETTINGS_KEY);
    if (stored) return stored;
  } catch { /* not available */ }
  try {
    const top = hudRoot();
    const v = top.GetAttributeString?.(SETTINGS_KEY, "");
    if (v) return v;
  } catch { /* not available */ }
  return null;
}

function storeSettings(json: string): void {
  try { $.persistentStorage?.setItem(SETTINGS_KEY, json); } catch { /* not available */ }
  try { hudRoot().SetAttributeString?.(SETTINGS_KEY, json); } catch { /* not available */ }
}

function loadSettings(cfg: NonNullable<typeof mm>): MapSettings {
  try {
    return parseSettings(readStoredSettings(), cfg);
  } catch {
    return defaultSettings(cfg);
  }
}

function updateSettings(change: Partial<MapSettings>): void {
  if (!mm) return;
  mapSettings = { ...mapSettings, ...change };
  storeSettings(JSON.stringify(mapSettings));
  layoutKey = ""; // re-place markers (flip may have changed)
  nextCrateIconCheck = 0; // apply marker/backdrop changes right away
  renderOptions();
  applyMapScale();
  applyMapLook();
  if (valid(markerLayer)) markerLayer.SetHasClass("Hidden", !mapSettings.markers);
}

function changeMapScale(dir: number): void {
  if (!mm) return;
  updateSettings({ mapScale: clampScale(mapSettings.mapScale + dir * mm.scale.step, mm.scale) });
}

/** The quick-size key / SMALL-BIG button: switch between the two sizes in minimap.quickSizes. */
function toggleQuickSize(): void {
  if (!mm?.quickSizes) return;
  updateSettings({ mapScale: clampScale(nextQuickSize(mapSettings.mapScale, mm.quickSizes.sizes), mm.scale) });
}

if (mm?.quickSizes?.key && $.RegisterKeyBind) {
  try {
    $.RegisterKeyBind($.GetContextPanel(), mm.quickSizes.key, toggleQuickSize);
  } catch (e) {
    $.Msg(LOG, "could not bind", mm.quickSizes.key, String(e));
  }
}

function renderOptions(): void {
  if (!mm) return;
  const s = mm.scale;
  const pct = `${Math.round(s.max > s.min ? ((mapSettings.mapScale - s.min) / (s.max - s.min)) * 100 : 100)}%`;
  setText("DAMapSizeValue", `${Math.round(mapSettings.mapScale * 100)}%`);
  const fill = el("DAMapSizeFill");
  if (fill?.style) fill.style.width = pct;
  setText("DAMarkersToggleText", mapSettings.markers ? "ON" : "OFF");
  setText("DABackdropToggleText", mapSettings.backdrop ? "ON" : "OFF");
  setText("DAFlipToggleText", mapSettings.flip.toUpperCase());
}

/**
 * The map's look: the game's grey backdrop (a class on #minimap_persp switches our CSS rule) and
 * the game's own hidden crate spawn icons (.map_button.powerup_spawn, opacity 0 in vanilla). Those
 * icons live in the minimap's own layout, which our stylesheet may not reach, so their opacity is
 * set directly. Cheap: class checks each tick, the icon search only every few seconds.
 */
let nextCrateIconCheck = 0;
function applyMapLook(): void {
  if (!mm) return;
  if (valid(scalePanel)) {
    const hide = !mapSettings.backdrop;
    if ((scalePanel.BHasClass?.("DANoMapBackdrop") ?? !hide) !== hide) scalePanel.SetHasClass("DANoMapBackdrop", hide);
  }
  if (!valid(minimapPanel) || elapsed < nextCrateIconCheck) return;
  nextCrateIconCheck = elapsed + CLOCK_RETRY_SECONDS;
  const show = mapSettings.markers && !userHidden;
  if ((minimapPanel.BHasClass?.("DAShowCrateIcons") ?? !show) !== show) minimapPanel.SetHasClass("DAShowCrateIcons", show);
  for (const icon of minimapPanel.FindChildrenWithClassTraverse("powerup_spawn") ?? []) {
    if (icon.style) icon.style.opacity = show ? "0.7" : "0";
  }
}

/**
 * ui-scale on #minimap_persp. That panel is pinned to the bottom-right corner, so a bigger
 * ui-scale grows the whole minimap (frame, blur, map, markers) up and to the left. While the
 * game shows its own big map (targeting, scoreboard) we step back to 100%.
 */
function applyMapScale(): void {
  if (!mm || !valid(scalePanel) || !scalePanel.style) return;
  const panel = scalePanel;
  const gameResizing = (mm.scale.scaleOffWhen ?? []).some((c) => panel.BHasClass?.(c) ?? false);
  const s = effectiveScale(mapSettings.mapScale, gameResizing);
  const key = `${s}`;
  if (key === appliedScaleKey) return;
  // Leave the game's own styling alone until the player actually changes the size.
  if (appliedScaleKey === "" && s === 1) { appliedScaleKey = key; return; }
  appliedScaleKey = key;
  panel.style!.uiScale = uiScaleValue(s);
  layoutKey = "";
}

/** True if our marker layer sits inside the panel the game mirrors (e.g. .invert_map). */
function checkInheritedFlip(): void {
  if (!mm || !valid(markerLayer) || !markerLayer.BAscendantHasClass) { inheritsGameFlip = false; return; }
  inheritsGameFlip = mm.flip.whenFound.some((sel) => sel[0] === "." && markerLayer!.BAscendantHasClass!(sel.slice(1)));
}

/**
 * Every marker to draw: the spawn spots from crate_locations.json (types picked in
 * minimap.markers.showTypes) plus any placed by hand. Computed once at load.
 */
const allPoints: MapPoint[] = mm
  ? [...locationPoints(crateLocations as LocationData, mm.markers.showTypes ?? []), ...mm.markers.points]
  : [];

/** Marker look by type (crate dim and small, tough crate teal, statue gold); brighter when soon. */
function styleMarker(p: Panel, soon: boolean, type?: MarkerType): void {
  const st = p.style;
  if (!st) return;
  const look = markerLook(type);
  st.width = `${look.size}px`;
  st.height = `${look.size}px`;
  st.backgroundColor = soon ? "#FFED79" : look.color;
  st.border = "1px solid #10130Dc0";
  st.opacity = soon ? "0.95" : `${look.dim}`;
  st.transform = "rotateZ( 45deg )";
}

function buildMarkers(cfg: NonNullable<typeof mm>, layer: Panel): void {
  if (!$.CreatePanel || allPoints.length === 0) return;
  const after = cfg.markers.insert === "after";
  const parent = after ? layer.GetParent() : layer;
  if (!parent) return;
  markerLayer = $.CreatePanel("Panel", parent, "DAMapMarkers");
  markerLayer.hittest = false;
  if (after) {
    parent.MoveChildAfter?.(markerLayer, layer);
  } else {
    // First child: early in the order, so later icons draw on top.
    const first = parent.GetChild?.(0);
    if (first && first !== markerLayer) parent.MoveChildBefore?.(markerLayer, first);
  }
  markerPanels = allPoints.map((point) => {
    const panel = $.CreatePanel!("Panel", markerLayer!, "");
    panel.hittest = false;
    panel.AddClass("DAMapMarker");
    // Inline too: these panels live inside the minimap's own layout, which our stylesheet may not reach.
    styleMarker(panel, false, point.type);
    if (panel.style) panel.style.visibility = "collapse"; // until we know the crates have spawned
    return { panel, point };
  });
  markerLayer.SetHasClass("Hidden", !mapSettings.markers);
  markerLayer.SetHasClass("DAUserHidden", userHidden);
  checkInheritedFlip();
  layoutKey = "";
  soonKey = "";
  updateMarkerSoon(prevNow); // apply hidden/new/shown now, not on the next clock change
}

/** Matches the marker layer to the map picture, and places markers. Cheap when nothing moved. */
function layoutMarkers(cfg: NonNullable<typeof mm>): void {
  if (!valid(markerLayer) || !valid(mapLayer)) return;
  const sx = mapLayer.actualuiscale_x || 1;
  const sy = mapLayer.actualuiscale_y || 1;
  const w = (mapLayer.actuallayoutwidth ?? 0) / sx;
  const h = (mapLayer.actuallayoutheight ?? 0) / sy;
  const inside = cfg.markers.insert !== "after";
  const x = inside ? 0 : (mapLayer.actualxoffset ?? 0) / sx;
  const y = inside ? 0 : (mapLayer.actualyoffset ?? 0) / sy;
  const transform = inside ? "" : mapLayer.style?.transform ?? "";
  const origin = inside ? "" : mapLayer.style?.transformOrigin ?? "";
  const flip = flipActive(mapSettings.flip, teamMatch, inheritsGameFlip);
  const key = `${w}|${h}|${x}|${y}|${transform}|${origin}|${flip}`;
  if (key === layoutKey || w <= 0 || h <= 0) return;
  layoutKey = key;
  const st = markerLayer.style;
  if (st) {
    st.width = `${w}px`;
    st.height = `${h}px`;
    st.marginLeft = `${x}px`;
    st.marginTop = `${y}px`;
    if (!inside) {
      st.transform = transform || "none";
      if (origin) st.transformOrigin = origin;
    }
  }
  for (const m of markerPanels) {
    const pos = markerPosition(m.point, w, h, flip);
    if (m.panel.style) {
      m.panel.style.marginLeft = `${pos.left - 3}px`; // centre the 6px marker
      m.panel.style.marginTop = `${pos.top - 3}px`;
    }
  }
}

/** Brightens markers whose crates spawn soon. Runs when the clock changes. */
/**
 * Markers appear only once their crates have spawned (3:00): hidden before, bright for
 * `soonSeconds` right after, then normal. Runs when the clock changes; writes only on a change.
 */
function updateMarkerSoon(now: number | null): void {
  if (!mm || markerPanels.length === 0) return;
  const states = now === null ? new Map<string, MarkerState>() : markerStates(allPoints, config.events, now, mm.markers.soonSeconds);
  const key = [...states].map(([k, s]) => `${k}=${s}`).sort().join(",");
  if (key === soonKey) return;
  soonKey = key;
  for (const m of markerPanels) {
    const state = states.get(m.point.kind) ?? "hidden";
    m.panel.SetHasClass("Soon", state === "new");
    styleMarker(m.panel, state === "new", m.point.type);
    if (m.panel.style) m.panel.style.visibility = state === "hidden" ? "collapse" : "visible";
  }
}

function tickMinimap(): void {
  if (!mm || !valid(root)) return;
  if (!valid(scalePanel) || !valid(minimapPanel) || !valid(mapLayer)) {
    if (elapsed < nextMapSearch) return;
    // Back off if the names in events.json don't match anything (e.g. after a game patch).
    mapSearches++;
    nextMapSearch = elapsed + (mapSearches > 15 ? 10 : CLOCK_RETRY_SECONDS);
    if (!valid(scalePanel)) {
      scalePanel = findFirst(root, mm.find.scaleTarget);
      appliedScaleKey = "";
      applyMapScale();
    }
    if (!valid(minimapPanel) || !valid(mapLayer)) {
      minimapPanel = findFirst(root, mm.find.minimap);
      mapLayer = !minimapPanel ? null : mm.markers.insert === "minimap" ? minimapPanel : findFirst(minimapPanel, mm.find.mapLayer);
      markerLayer = null;
      markerPanels = [];
      if (DEBUG) $.Msg(LOG, "minimap: scale target", scalePanel ? "found" : "NOT found", "/ minimap", minimapPanel ? "found" : "NOT found", "/ map layer", mapLayer ? "found" : "NOT found");
      if (mapLayer && allPoints.length > 0) buildMarkers(mm, mapLayer);
    }
    if (valid(scalePanel) && valid(minimapPanel) && valid(mapLayer)) mapSearches = 0;
  }
  if (mm.flip.mode !== "off" && mm.flip.whenFound.length > 0 && elapsed >= nextTeamCheck) {
    nextTeamCheck = elapsed + 10; // team doesn't change mid-match; keep this rare
    const before = `${teamMatch}|${inheritsGameFlip}`;
    teamMatch = findFirst(root, mm.flip.whenFound) !== null;
    checkInheritedFlip();
    if (`${teamMatch}|${inheritsGameFlip}` !== before) layoutKey = "";
  }
  applyMapScale(); // cheap: only writes when the scale (or the game's big-map state) changes
  applyMapLook();
  layoutMarkers(mm);
}

function checkAutoHide(now: number | null): void {
  const at = config.hide?.autoHideAt;
  if (!at || now === null) return;
  const hideAt = parseClock(at);
  if (hideAt === null) return;
  if (now < hideAt) autoHideDone = false; // new match, or the clock went back
  else if (!autoHideDone) {
    autoHideDone = true;
    setUserHidden(true);
  }
}

if (config.hide?.key && $.RegisterKeyBind) {
  try {
    $.RegisterKeyBind($.GetContextPanel(), config.hide.key, toggleHidden);
  } catch (e) {
    $.Msg(LOG, "could not bind", config.hide.key, String(e));
  }
}

function showBanner(b: Banner): void {
  if (userHidden) return; // don't pop a banner the player asked not to see
  setText("DATimersBannerText", b.title);
  setText("DATimersBannerTime", b.time);
  setClass("DATimersBanner", "Urgent", b.urgent);
  bannerUntil = elapsed + config.bannerSeconds;
  applyBanner();
}

/**
 * Shows or hides the banner from bannerUntil. Called every tick, not from a one-off timer: if a
 * hide is ever missed (panel swapped, cache reset), the next tick puts it right.
 */
function applyBanner(): void {
  setClass("DATimersBanner", "Visible", elapsed < bannerUntil && !userHidden && lastActive !== false);
}

/** The quiet wave line: just a countdown, brighter in the last few seconds, never a banner. */
function renderWave(now: number | null): void {
  const waves = config.waves;
  const remaining = now === null ? null : nextWave(waves, now);
  setClass("DAWave", "Hidden", remaining === null);
  if (remaining === null || !waves) return;
  setText("DAWaveLabel", waves.label.toUpperCase());
  setText("DAWaveTime", formatSeconds(remaining));
  setClass("DAWave", "Soon", remaining <= waves.soonSeconds);
}

/**
 * Runs one part of the HUD update. A failure is logged (once per distinct error, with the
 * stack) and doesn't stop the other parts: an error in the event list once froze its rows
 * while the wave line kept going.
 */
const loggedErrors = new Set<string>();
function guard(part: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    const msg = `${part}: ${String(e)}`;
    if (!loggedErrors.has(msg)) {
      loggedErrors.add(msg);
      $.Msg(LOG, "error in", msg, (e as Error)?.stack ?? "");
    }
  }
}

function renderRows(now: number): void {
  const list = upcoming(config, now);
  for (let i = 0; i < ROWS; i++) {
    const row = `DATimersRow${i}`;
    const item = list[i];
    setClass(row, "Hidden", !item);
    if (!item) continue;
    setText(`${row}Name`, item.label);
    setText(`${row}Time`, item.remaining <= 0 ? "NOW" : (item.approx ? "~" : "") + formatSeconds(item.remaining));
    setClass(row, "Soon", item.remaining <= 30);
    setClass(row, "Now", item.remaining <= 10);
  }
}

function render(now: number | null): void {
  guard("panel", () => setClass("DATimers", "Hidden", now === null || now < 0));
  guard("wave", () => renderWave(now));
  if (now === null) return;
  guard("rows", () => renderRows(now));
  guard("banner", () => {
    const banner = bannerText(crossedWarnings(config, prevNow, now));
    if (banner) showBanner(banner);
  });
}

// --- Quickbuy queue ---------------------------------------------------------------
// The souls label and queue container are found once and cached. The queued items are
// re-read inside the (small) queue every ITEM_REFRESH_SECONDS, since buying shifts the queue.
// The line counts down to the first item you can't afford yet; items before it show as ready.

const ITEM_REFRESH_SECONDS = 0.5;
const DUMP_SECONDS = 10;
type QueuedItem = { panel: Panel; name: LabelPanel | null; cost: LabelPanel | null };
let soulsLabel: LabelPanel | null = null;
let queuePanel: Panel | null = null;
let queued: QueuedItem[] = [];
let nextShopSearch = 0;
let nextItemRefresh = 0;
let nextDump = 0;
let lastItemKey: string | null = null;

/** All matches for the first selector ("#PanelId" / ".ClassName") that matches anything in `scope`. */
function findAll(scope: Panel, selectors: string[]): Panel[] {
  for (const sel of selectors) {
    const name = sel.slice(1);
    const found = sel[0] === "#" ? [scope.FindChildTraverse(name)].filter((p): p is Panel => !!p) : scope.FindChildrenWithClassTraverse(name) ?? [];
    if (found.length > 0) return found;
  }
  return [];
}

function findFirst(scope: Panel, selectors: string[]): Panel | null {
  return findAll(scope, selectors)[0] ?? null;
}

/** Re-reads the queue's item panels, keeping cached labels for items that didn't change. */
/**
 * The queue's item panels in their real child order. A search result's order isn't guaranteed,
 * so we walk the direct children when Panorama lets us, and only fall back to the search.
 */
function queueChildren(queue: Panel, selectors: string[]): Panel[] {
  const classes = selectors.filter((s) => s[0] === ".").map((s) => s.slice(1));
  if (queue.GetChildCount && queue.GetChild && classes.length > 0) {
    const out: Panel[] = [];
    for (let i = 0; i < queue.GetChildCount(); i++) {
      const c = queue.GetChild(i);
      if (c && classes.some((cls) => c.BHasClass?.(cls))) out.push(c);
    }
    if (out.length > 0) return out;
  }
  return findAll(queue, selectors);
}

const itemLabels = (panel: Panel, find: NonNullable<Config["nextItem"]>["find"]): QueuedItem => ({
  panel,
  name: findFirst(panel, find.itemName) as LabelPanel | null,
  cost: findFirst(panel, find.itemCost) as LabelPanel | null,
});

/** The game's own "next item" entry (#QuickbuyNext): it decides the queue order. */
let nextEntry: QueuedItem | null = null;

/** Re-reads the queue's item panels, keeping cached labels for items that didn't change. */
function refreshQueue(queue: Panel, find: NonNullable<Config["nextItem"]>["find"]): void {
  if (find.next && valid(root) && (!nextEntry || !valid(nextEntry.panel) || !valid(nextEntry.name) || !valid(nextEntry.cost))) {
    const p = findFirst(root, find.next);
    nextEntry = p ? itemLabels(p, find) : null;
  }
  const panelsNow = queueChildren(queue, find.queueItem);
  const same = panelsNow.length === queued.length && panelsNow.every((p, i) => p === queued[i].panel && valid(queued[i].name) && valid(queued[i].cost));
  if (same) return;
  queued = panelsNow.map((panel) => itemLabels(panel, find));
}

/** --debug only: logs labels whose text has digits, to help find the souls and price labels. */
function dumpNumberLabels(r: Panel): void {
  if (!r.GetChildCount || !r.GetChild) return;
  const lines: string[] = [];
  const walk = (p: Panel, path: string): void => {
    const count = p.GetChildCount?.() ?? 0;
    for (let i = 0; i < count && lines.length < 40; i++) {
      const c = p.GetChild?.(i);
      if (!c) continue;
      const here = c.id ? `${path}/#${c.id}` : path;
      const text = (c as LabelPanel).text;
      if (typeof text === "string" && /\d/.test(text) && text.length < 24) lines.push(`${here} [${c.paneltype ?? "?"}] "${text}"`);
      walk(c, here);
    }
  };
  walk(r, "");
  $.Msg(LOG, "next-item: souls or queue not found. Labels with numbers:");
  for (const l of lines) $.Msg(LOG, "  ", l);
}

function renderNextItem(): void {
  const cfg = config.nextItem;
  if (!cfg || cfg.enabled === false || !valid(root)) return;

  if ((!valid(soulsLabel) || !valid(queuePanel)) && elapsed >= nextShopSearch) {
    if (!valid(soulsLabel)) soulsLabel = findFirst(root, cfg.find.souls) as LabelPanel | null;
    if (!valid(queuePanel)) queuePanel = findFirst(root, cfg.find.queue);
    nextShopSearch = elapsed + CLOCK_RETRY_SECONDS;
    if (DEBUG && (!soulsLabel || !queuePanel) && elapsed >= nextDump) {
      $.Msg(LOG, "next-item: souls", soulsLabel ? "found" : "NOT found", "/ queue", queuePanel ? "found" : "NOT found");
      dumpNumberLabels(root);
      nextDump = elapsed + DUMP_SECONDS;
    }
  }

  // A bought item's panel is removed: look again right away instead of waiting for the refresh.
  const stale = queued.some((q) => !valid(q.panel));
  if (valid(queuePanel) && (stale || elapsed >= nextItemRefresh)) {
    nextItemRefresh = elapsed + ITEM_REFRESH_SECONDS;
    refreshQueue(queuePanel, cfg.find);
  } else if (!valid(queuePanel)) {
    queued = [];
  }

  const read = (q: QueuedItem) => ({ name: valid(q.name) ? q.name.text : null, cost: valid(q.cost) ? q.cost.text : null });
  // After a "clear queue" the next-item panel keeps its old text; the game marks the Quickbuy
  // panel Empty instead. So: empty -> nothing queued, whatever the leftover labels say.
  const emptyClasses = cfg.emptyWhen ?? [];
  const nextPanel = nextEntry && valid(nextEntry.panel) ? nextEntry.panel : null;
  const queueEmpty = emptyClasses.some((c) =>
    (nextPanel?.BHasClass?.(c) ?? false) || (nextPanel?.BAscendantHasClass?.(c) ?? false) ||
    (valid(queuePanel) && ((queuePanel.BHasClass?.(c) ?? false) || (queuePanel.BAscendantHasClass?.(c) ?? false))));
  // Buying order, anchored on the game's own next-item panel (the list alone can be reversed).
  const items = queueEmpty ? [] : orderQueue(nextPanel ? read(nextEntry!) : null, queued.map(read));
  const souls = valid(soulsLabel) ? soulsLabel.text : null;
  const key = `${souls}|${items.map((i) => `${i.name}=${i.cost}`).join(";")}`;
  if (key === lastItemKey) return;
  lastItemKey = key;

  const status = queueStatus(items, souls);
  if (DEBUG) $.Msg(LOG, "next-item", JSON.stringify({ souls, items }), "->", JSON.stringify(status));
  setClass("DANextItem", "Hidden", !status);
  if (!status) return;
  setText("DANextItemLabel", cfg.label.toUpperCase());
  setText("DANextItemName", status.allReady && status.total > 1 ? `All ${status.total} items` : status.name);
  setText("DANextItemNeed", status.allReady ? "READY" : formatSouls(status.need));
  setText("DANextItemReady", `+${status.readyCount} READY`);
  setClass("DANextItem", "Ready", status.allReady);
  const someReady = status.readyCount > 0 && !status.allReady;
  setClass("DANextItem", "SomeReady", someReady);
  setClass("DANextItemReady", "Hidden", !someReady);
}

// --- Real match or not? ------------------------------------------------------------------
// The hideout runs a match clock too, so the clock alone isn't enough. The game's state is on
// the HUD root as classes; our own panel is inside it, so asking its ancestors is enough (no
// tree search). Without BAscendantHasClass we fall back to "always a match".
let lastActive: boolean | null = null;

function inMatch(): boolean {
  const probe = el("DATimers");
  if (!probe?.BAscendantHasClass) return true;
  return matchActive(config.match, (c) => probe.BAscendantHasClass!(c));
}

function onMatchChange(active: boolean): void {
  if (DEBUG) $.Msg(LOG, active ? "match started" : "not in a match");
  if (!active) {
    setOptionsOpen(false);
    setClass("DANextItem", "Hidden", true);
    setClass("DAToggle", "Hidden", true);
    lastItemKey = null;
    autoHideDone = false;
  } else {
    setClass("DAToggle", "Hidden", !userHidden);
  }
  if (valid(markerLayer)) markerLayer.SetHasClass("DAUserHidden", userHidden || !active);
}

// --- Staying in sync ---------------------------------------------------------------------
// Nothing counts on its own: every tick re-reads the game clock. On top of that:
// - every RESYNC_SECONDS we re-find every panel we read and rewrite our own text/classes, so a
//   swapped or stale panel (HUD rebuilt, reconnect, spectating) heals within 30s;
// - a new match (clock jumps back, or we come back from the hideout) resets banners and the
//   player's "hidden" choice, so nothing carries over from the last game.

function resync(reason: string): void {
  if (DEBUG) $.Msg(LOG, "resync:", reason);
  resetCache(); // our own panels: re-find and rewrite everything on the next render
  if (valid(root)) findClocks(root);
  soulsLabel = null;
  queuePanel = null;
  queued = [];
  nextEntry = null;
  nextShopSearch = 0;
  nextItemRefresh = 0; // re-read the queue in the same tick, so the line doesn't flicker
  lastItemKey = null;
  if (mm && valid(root)) {
    // Only rebuild markers if the game really gave us a different minimap panel.
    const fresh = findFirst(root, mm.find.minimap);
    if (fresh && fresh !== minimapPanel) minimapPanel = null;
    const freshScale = findFirst(root, mm.find.scaleTarget);
    if (freshScale && freshScale !== scalePanel) scalePanel = null;
    nextMapSearch = 0;
    layoutKey = "";
  }
  clickHandlersSet = false; // re-attach in case the buttons were recreated
  clickSetupTries = 0;
  nextClickSetup = 0;
}

function startNewMatch(): void {
  if (DEBUG) $.Msg(LOG, "new match");
  prevNow = null; // no warning burst from the jump
  bannerUntil = 0;
  applyBanner();
  autoHideDone = false;
  if (userHidden) setUserHidden(false);
  resync("new match");
}

function tick(): void {
  elapsed += TICK_SECONDS;
  try {
    if (!valid(ctx)) {
      ctx = $.GetContextPanel();
      root = ctx;
      clockSearches = 0;
      resetCache();
      clocks = [];
    }
    if (!valid(root)) root = ctx;
    const clockLost = clocks.length === 0 || clocks.some((c) => !valid(c.panel));
    if (clockLost && elapsed >= nextClockSearch) {
      findClocks(root!);
      nextClockSearch = elapsed + CLOCK_RETRY_SECONDS;
      // Not inside our own HUD? Look through the whole UI instead (old behaviour).
      if (clocks.length === 0 && ++clockSearches === CLOCK_SEARCHES_BEFORE_FALLBACK && root === ctx) {
        root = hudRoot();
        if (DEBUG) $.Msg(LOG, "clock not in our HUD layout, searching the whole UI");
      }
    }
    if (elapsed >= nextResync) {
      nextResync = elapsed + RESYNC_SECONDS;
      resync("periodic");
    }
    const active = inMatch();
    if (active !== lastActive) {
      const wasActive = lastActive;
      lastActive = active;
      onMatchChange(active);
      if (active && wasActive === false) startNewMatch();
    }
    // Outside a match the clock counts as missing: everything hides and no banners fire.
    const text = active ? readClock() : null;
    // The clock shows whole seconds: nothing to do until it changes.
    if (text !== lastClockText) {
      lastClockText = text;
      const now = parseClock(text);
      if (DEBUG) $.Msg(LOG, "clock", text ?? "(not found)", "->", now, `(label ${clockIndex + 1} of ${clocks.length})`);
      if (clockRestarted(prevNow, now)) startNewMatch();
      guard("auto-hide", () => checkAutoHide(now));
      render(now);
      guard("map markers", () => updateMarkerSoon(now));
      prevNow = now;
    }
    guard("banner state", applyBanner);
    guard("clicks", setupClicks);
    if (active) {
      guard("next item", renderNextItem);
      guard("minimap", tickMinimap);
    }
  } catch (e) {
    $.Msg(LOG, "error", String(e));
  }
  $.Schedule(TICK_SECONDS, tick);
}

$.Msg(LOG, "loaded", config.events.length, "events");
tick();
