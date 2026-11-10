// A fake minimap for the preview, shaped like the game's (checked in the F6 debugger) and built
// from the selectors in events.json, so the mod's real code finds, scales and marks it the same:
//   frame (bottom-right, clips) > #minimap_persp (scale target) > #hud_minimap (zoom resizes it,
//   mirrored for team 2) > #MinimapBackgroundTest (map picture), [mod's markers], hero icons
// Also the marker placement tool: click the map to add a crate marker, right-click to remove
// one, then copy the list into events.json. Imported before src/main.ts.
import rawConfig from "../events.json";
import type { Config } from "../src/schedule.ts";
import type { MapPoint } from "../src/minimap.ts";

const config = rawConfig as unknown as Config;
const mm = config.minimap;
const DRAFT_KEY = "event-timers-preview.markers";
const VIEW_KEY = "event-timers-preview.map";

/** Marker points being placed in the preview (until copied into events.json). */
export function draftPoints(): MapPoint[] | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as MapPoint[]) : null;
  } catch {
    return null;
  }
}

function saveDraft(points: MapPoint[] | null): void {
  try {
    if (points) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(points));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

// The mod reads its markers from the config at startup, so a draft replaces them before it loads.
const draft = draftPoints();
if (mm && draft) mm.markers.points = draft;

type View = { otherTeam: boolean; zoom: boolean; placing: boolean; kind: string };
let view: View = { otherTeam: false, zoom: false, placing: false, kind: "crates" };
try { view = { ...view, ...JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "{}") }; } catch { /* defaults */ }
const saveView = () => { try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* ignore */ } };

function make(selector: string | undefined, extra: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `Panel ${extra}`;
  if (selector?.startsWith("#")) el.id = selector.slice(1);
  else if (selector?.startsWith(".")) el.classList.add(selector.slice(1));
  return el;
}

const hud = document.getElementById("hud") as HTMLElement;
const frame = document.createElement("div");
frame.className = "PreviewMinimapFrame";
const scaleTarget = make(mm?.find.scaleTarget[0], "PreviewMinimapZoom");
const host = make(mm?.find.minimap[0], "PreviewMinimapHost");
const mapLayer = make(mm?.find.mapLayer[0], "PreviewMapLayer");
const pips = make(undefined, "PreviewPips");
// Example hero icons: enemies red, allies green. They must draw over the crate markers.
for (const [x, y, team] of [[30, 62, "enemy"], [55, 40, "enemy"], [72, 24, "ally"], [20, 80, "ally"], [48, 50, "enemy"]] as const) {
  const pip = document.createElement("div");
  pip.className = `PreviewPip ${team}`;
  pip.style.left = `${x}%`;
  pip.style.top = `${y}%`;
  pips.append(pip);
}
host.append(mapLayer, pips);
scaleTarget.append(host);
frame.append(scaleTarget);
hud.append(frame);

/** Simulates the game: zoom resizes #hud_minimap, the other team gets .invert_map + a mirror. */
function applyView(): void {
  host.style.width = view.zoom ? "150%" : "100%";
  host.style.height = view.zoom ? "150%" : "100%";
  host.style.left = view.zoom ? "-25%" : "0";
  host.style.top = view.zoom ? "-25%" : "0";
  host.classList.toggle("invert_map", view.otherTeam);
  host.style.transform = view.otherTeam ? "scaleY(-1) scaleX(-1)" : "";
  frame.classList.toggle("Placing", view.placing);
}
applyView();

// --- Controls ---------------------------------------------------------------------
const $id = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const otherTeam = $id<HTMLInputElement>("mapOtherTeam");
const zoom = $id<HTMLInputElement>("mapZoom");
const placing = $id<HTMLInputElement>("mapPlace");
const kind = $id<HTMLSelectElement>("mapKind");
const status = $id<HTMLElement>("mapStatus");

for (const ev of config.events) {
  const opt = document.createElement("option");
  opt.value = ev.id;
  opt.textContent = ev.id;
  kind.append(opt);
}
otherTeam.checked = view.otherTeam;
zoom.checked = view.zoom;
placing.checked = view.placing;
kind.value = view.kind;

const points = (): MapPoint[] => mm?.markers.points ?? [];
function showStatus(extra = ""): void {
  const n = points().length;
  status.textContent = `${n} marker${n === 1 ? "" : "s"}${draft ? " (unsaved draft)" : ""}${extra ? ` · ${extra}` : ""}`;
}
showStatus();

otherTeam.addEventListener("change", () => { view.otherTeam = otherTeam.checked; saveView(); applyView(); });
zoom.addEventListener("change", () => { view.zoom = zoom.checked; saveView(); applyView(); });
placing.addEventListener("change", () => { view.placing = placing.checked; saveView(); applyView(); });
kind.addEventListener("change", () => { view.kind = kind.value; saveView(); });

/** Click position as % of the map, undoing the preview's zoom and the other team's mirror. */
function pointAt(e: MouseEvent): { x: number; y: number } {
  const r = host.getBoundingClientRect();
  let x = ((e.clientX - r.left) / r.width) * 100;
  let y = ((e.clientY - r.top) / r.height) * 100;
  if (view.otherTeam) { x = 100 - x; y = 100 - y; }
  const round = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  return { x: round(x), y: round(y) };
}

function editPoints(next: MapPoint[]): void {
  saveDraft(next);
  location.reload(); // the mod builds markers at startup
}

mapLayer.addEventListener("click", (e) => {
  if (!view.placing) return;
  editPoints([...points(), { ...pointAt(e), kind: view.kind }]);
});
mapLayer.addEventListener("contextmenu", (e) => {
  if (!view.placing) return;
  e.preventDefault();
  const at = pointAt(e);
  let best = -1, bestD = 4; // within 4% of the map
  points().forEach((p, i) => { const d = Math.hypot(p.x - at.x, p.y - at.y); if (d < bestD) { best = i; bestD = d; } });
  if (best >= 0) editPoints(points().filter((_, i) => i !== best));
});

$id("mapCopy").addEventListener("click", async () => {
  const json = JSON.stringify(points());
  try {
    await navigator.clipboard.writeText(json);
    showStatus('copied: paste over "points": [] under minimap.markers in events.json');
  } catch {
    window.prompt("Copy this into events.json (minimap.markers.points):", json);
  }
});
$id("mapClear").addEventListener("click", () => {
  if (draft) { saveDraft(null); location.reload(); } // back to events.json's markers
  else if (points().length && confirm("Start a new empty marker draft?")) editPoints([]);
});
