// Pure logic for the minimap size setting and crate markers. No Panorama APIs here.

import { type EventDef, nextOccurrence, toSeconds } from "./schedule.ts";

export interface MapPoint {
  /** Percent of the map width/height from the top-left corner (0-100). */
  x: number;
  y: number;
  /** Event id this marker belongs to, e.g. "crates". It brightens shortly before that event. */
  kind: string;
  /** What spawns there; sets the marker's look. */
  type?: MarkerType;
}

export type MarkerType = "crate" | "tough" | "statue";
export const MARKER_TYPES: MarkerType[] = ["crate", "tough", "statue"];

/** crate_locations.json: flattened [x1, y1, x2, y2, ...] per type, % of the minimap texture. */
export type LocationData = Partial<Record<MarkerType, number[]>>;

/** Spawn spots of the chosen types as markers that brighten before `kind` (the 3:00 crates). */
export function locationPoints(data: LocationData, show: MarkerType[], kind = "crates"): MapPoint[] {
  const out: MapPoint[] = [];
  for (const type of show) {
    const flat = data[type] ?? [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1], kind, type });
  }
  return out;
}

/** Marker look per type: size in px, colour, and opacity when not "soon". */
export function markerLook(type: MarkerType | undefined): { size: number; color: string; dim: number } {
  if (type === "statue") return { size: 6, color: "#FFED79", dim: 0.6 };
  if (type === "tough") return { size: 5, color: "#99FFD6", dim: 0.55 };
  return { size: 4, color: "#FFEFD7", dim: 0.35 };
}

export interface MinimapConfig {
  enabled?: boolean;
  find: {
    /** Panel that gets ui-scale for the map size setting. */
    scaleTarget: string[];
    /** Panel the markers go into (with insert "minimap"); the game mirrors and zooms it. */
    minimap: string[];
    /** The map picture, for insert "after"/"inside". */
    mapLayer: string[];
  };
  scale: {
    default: number; min: number; max: number; step: number;
    /** Classes on the scale target that mean "the game is resizing the map itself" (big map). */
    scaleOffWhen?: string[];
  };
  /** Default for the game's grey round backdrop behind the map (false = hidden). */
  backdrop?: boolean;
  /** One key (and a button) to switch between two map sizes. */
  quickSizes?: { key: string; sizes: [number, number] };
  markers: {
    enabled?: boolean;
    /** "minimap": child of the minimap panel; "after": next to mapLayer; "inside": in mapLayer. */
    insert: "minimap" | "after" | "inside";
    soonSeconds: number;
    /** Extra markers placed by hand (preview tool). */
    points: MapPoint[];
    /** Which spawn spots from crate_locations.json to show: "crate", "tough", "statue". */
    showTypes?: MarkerType[];
  };
  /** Team side: markers turn 180° while one of `whenFound` exists in the HUD (mode "auto"). */
  flip: { mode: FlipMode; whenFound: string[] };
}

export type FlipMode = "auto" | "on" | "off";

/** Player settings changed in the options panel (saved where Panorama allows it). */
export interface MapSettings {
  mapScale: number;
  markers: boolean;
  flip: FlipMode;
  /** Show the game's grey round backdrop (#minimap_frame) behind the map. */
  backdrop: boolean;
}

export function defaultSettings(cfg: MinimapConfig): MapSettings {
  return { mapScale: cfg.scale.default, markers: cfg.markers.enabled !== false, flip: cfg.flip.mode, backdrop: cfg.backdrop ?? false };
}

/** Reads saved settings, ignoring anything missing or broken. */
export function parseSettings(text: string | null | undefined, cfg: MinimapConfig): MapSettings {
  const base = defaultSettings(cfg);
  if (!text) return base;
  try {
    const s = JSON.parse(text) as Partial<MapSettings>;
    return {
      mapScale: typeof s.mapScale === "number" ? clampScale(s.mapScale, cfg.scale) : base.mapScale,
      markers: typeof s.markers === "boolean" ? s.markers : base.markers,
      flip: s.flip === "auto" || s.flip === "on" || s.flip === "off" ? s.flip : base.flip,
      backdrop: typeof s.backdrop === "boolean" ? s.backdrop : base.backdrop,
    };
  } catch {
    return base;
  }
}

export function nextFlipMode(m: FlipMode): FlipMode {
  return m === "auto" ? "on" : m === "on" ? "off" : "auto";
}

/**
 * Whether we should turn the markers 180° ourselves. In "auto", only when the map is inverted
 * for this team and the game isn't already mirroring the panel our markers are in.
 */
export function flipActive(mode: FlipMode, teamMatch: boolean, inheritsGameFlip = false): boolean {
  return mode === "on" || (mode === "auto" && teamMatch && !inheritsGameFlip);
}

/** The quick-size key: from the small size go big, from anything else go back to small. */
export function nextQuickSize(current: number, sizes: [number, number]): number {
  const [small, big] = sizes;
  return Math.abs(current - small) < 0.001 ? big : small;
}

/** The scale to apply now: the player's setting, or 1 while the game shows its own big map. */
export function effectiveScale(setting: number, gameResizing: boolean): number {
  return gameResizing ? 1 : setting;
}

/** Panorama ui-scale value for the map size setting. */
export function uiScaleValue(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Rounds to the step and keeps the value inside min..max. */
export function clampScale(value: number, s: MinimapConfig["scale"]): number {
  const stepped = Math.round((value - s.min) / s.step) * s.step + s.min;
  const v = Math.min(s.max, Math.max(s.min, stepped));
  return Math.round(v * 100) / 100;
}

/** Marker position in pixels inside a layer of the given size. `flip` turns the map 180°. */
export function markerPosition(p: MapPoint, width: number, height: number, flip: boolean): { left: number; top: number } {
  const x = flip ? 100 - p.x : p.x;
  const y = flip ? 100 - p.y : p.y;
  return { left: Math.round((x / 100) * width), top: Math.round((y / 100) * height) };
}

export type MarkerState = "hidden" | "new" | "shown";

/**
 * Markers only show once their crates have spawned: hidden before the event's first time,
 * bright ("new") for `newSeconds` after it, then normal. Kinds with no matching event always show.
 */
export function markerStates(points: MapPoint[], events: EventDef[], now: number, newSeconds: number): Map<string, MarkerState> {
  const out = new Map<string, MarkerState>();
  for (const kind of new Set(points.map((p) => p.kind))) {
    const ev = events.find((e) => e.id === kind && e.enabled !== false);
    if (!ev) { out.set(kind, "shown"); continue; }
    const first = toSeconds(ev.first);
    out.set(kind, now < first ? "hidden" : now < first + newSeconds ? "new" : "shown");
  }
  return out;
}

/** Marker kinds whose event is due within `soonSeconds` (they're drawn brighter). */
export function soonKinds(points: MapPoint[], events: EventDef[], now: number, soonSeconds: number): Set<string> {
  const out = new Set<string>();
  for (const kind of new Set(points.map((p) => p.kind))) {
    const ev = events.find((e) => e.id === kind && e.enabled !== false);
    if (!ev) continue;
    const at = nextOccurrence(ev, now);
    if (at !== null && at - now <= soonSeconds) out.add(kind);
  }
  return out;
}

/** Throws a readable error for config mistakes. Run at build time. */
export function validateMinimap(cfg: MinimapConfig | undefined): void {
  if (!cfg) return;
  for (const key of ["scaleTarget", "minimap", "mapLayer"] as const) {
    const list = cfg.find?.[key];
    if (!Array.isArray(list) || list.length === 0) throw new Error(`minimap.find.${key} needs at least one selector`);
    for (const sel of list) {
      if (!/^[#.][A-Za-z_][\w-]*$/.test(sel)) throw new Error(`minimap.find.${key}: "${sel}" must be "#PanelId" or ".ClassName"`);
    }
  }
  const s = cfg.scale;
  if (!(s.min > 0 && s.max >= s.min && s.step > 0)) throw new Error("minimap.scale needs min > 0, max >= min and step > 0");
  if (s.default < s.min || s.default > s.max) throw new Error("minimap.scale.default must be between min and max");
  if (cfg.quickSizes) {
    const q = cfg.quickSizes;
    if (q.key && !/^key_\w+$/.test(q.key)) throw new Error(`minimap.quickSizes.key "${q.key}" should look like "key_F8"`);
    if (!Array.isArray(q.sizes) || q.sizes.length !== 2 || q.sizes.some((v) => !(v >= s.min && v <= s.max))) {
      throw new Error("minimap.quickSizes.sizes must be two sizes between scale.min and scale.max");
    }
  }
  if (!["minimap", "after", "inside"].includes(cfg.markers.insert)) throw new Error('minimap.markers.insert must be "minimap", "after" or "inside"');
  if (!["auto", "on", "off"].includes(cfg.flip?.mode)) throw new Error('minimap.flip.mode must be "auto", "on" or "off"');
  for (const sel of cfg.flip.whenFound ?? []) {
    if (!/^[#.][A-Za-z_][\w-]*$/.test(sel)) throw new Error(`minimap.flip.whenFound: "${sel}" must be "#PanelId" or ".ClassName"`);
  }
  for (const t of cfg.markers.showTypes ?? []) {
    if (!MARKER_TYPES.includes(t)) throw new Error(`minimap.markers.showTypes: "${t}" must be one of ${MARKER_TYPES.join(", ")}`);
  }
  for (const p of cfg.markers.points) {
    if (!(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)) throw new Error(`minimap marker ${JSON.stringify(p)}: x and y must be 0-100`);
    if (!p.kind) throw new Error(`minimap marker ${JSON.stringify(p)} needs a kind`);
  }
}
