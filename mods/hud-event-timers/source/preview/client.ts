// Preview page: a fake match clock driving the real mod script (src/main.ts).
// Import order matters: the fake `$` must exist before main.ts runs.
import { advance, runtime } from "./fake-panorama.ts";
import { EXAMPLE_QUEUE, renderFakeShop } from "./fake-shop.ts";
import "./fake-minimap.ts";
import "../src/main.ts";
import rawConfig from "../events.json";
import { type Config, formatSeconds, nextOccurrence, validateConfig } from "../src/schedule.ts";

const config = rawConfig as unknown as Config;
const MAX_CLOCK = 45 * 60;
const STEP = 0.25; // same tick size as the mod
const STORE = "event-timers-preview";

const $id = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clockLabel = $id<HTMLElement>("PreviewGameTime");
const banner = $id<HTMLElement>("DATimersBanner");
const playBtn = $id<HTMLButtonElement>("play");
const slider = $id<HTMLInputElement>("slider");
const clockText = $id<HTMLElement>("clock");
const jumpInput = $id<HTMLInputElement>("jump");
const pauseOnBanner = $id<HTMLInputElement>("pauseOnBanner");
const nextWarn = $id<HTMLButtonElement>("nextWarn");
const speedBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-speed]"));

// --- Config errors (e.g. a typo in events.json) show on the page -------------
try {
  validateConfig(config);
} catch (e) {
  $id("error").textContent = `events.json problem: ${(e as Error).message}`;
  $id("error").hidden = false;
}

// --- State (kept across live reloads) -----------------------------------------
type State = { clock: number; speed: number; playing: boolean; pauseOnBanner: boolean; souls: number; queueIndex: number; inMatch: boolean };
let state: State = { clock: 4 * 60 + 20, speed: 1, playing: false, pauseOnBanner: true, souls: 450, queueIndex: 0, inMatch: true };
/** Fake farming rate while the clock plays, so "READY" shows up on its own. */
const SOULS_PER_SECOND = 12;
try {
  const saved = sessionStorage.getItem(STORE);
  if (saved) state = { ...state, ...JSON.parse(saved) };
} catch { /* storage unavailable: use defaults */ }

// --- Capture mode (for screenshots): ?capture=1&t=4:29&until=4:31&souls=2000&options=1 ----
// Shows only the HUD at its real 1920x1080 size, plays from t to `until` so banners fire for
// real, then pauses. Nothing is saved. Used by tools to take GameBanana screenshots.
const params = new URLSearchParams(location.search);
const capture = params.get("capture") === "1";
const captureUntil = (() => { const u = params.get("until"); const m = u && /^(\d+):(\d{2})$/.exec(u); return m ? Number(m[1]) * 60 + Number(m[2]) : null; })();
if (capture) {
  document.body.classList.add("capture");
  if (params.get("bg") === "0") document.body.classList.add("nobg");
  const t = params.get("t"); const m = t && /^(\d+):(\d{2})$/.exec(t);
  if (m) state.clock = Number(m[1]) * 60 + Number(m[2]);
  if (params.get("souls")) state.souls = Number(params.get("souls"));
  if (params.get("q")) state.queueIndex = Number(params.get("q"));
  state.inMatch = true;
  state.speed = 1;
  state.playing = captureUntil !== null;
  state.pauseOnBanner = false;
}

function save(): void {
  if (capture) return;
  try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignore */ }
}

function parseTime(text: string): number | null {
  const m = /^\s*(\d+):(\d{1,2})\s*$/.exec(text) ?? /^\s*(\d+)\s*$/.exec(text);
  if (!m) return null;
  return m.length === 3 ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) * 60;
}

function showClock(): void {
  const t = Math.floor(state.clock);
  clockLabel.textContent = formatSeconds(t);
  clockText.textContent = formatSeconds(t);
  if (document.activeElement !== slider) slider.value = String(t);
}

function setPlaying(p: boolean): void {
  state.playing = p;
  playBtn.textContent = p ? "Pause" : "Play";
  playBtn.setAttribute("aria-pressed", String(p));
  save();
}

function setSpeed(s: number): void {
  state.speed = s;
  for (const b of speedBtns) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === s));
  save();
}

/** Jumping is like a reconnect: the mod sees a clock jump and doesn't fire old warnings. */
function jumpTo(seconds: number): void {
  state.clock = Math.max(0, Math.min(MAX_CLOCK, seconds));
  showClock();
  save();
}

/** Jump to 3s before the next warning, so you can watch it fire. */
function jumpToNextWarning(): void {
  let best: number | null = null;
  for (const ev of config.events) {
    if (ev.enabled === false) continue;
    for (const warn of config.warnSeconds) {
      let at = nextOccurrence(ev, state.clock);
      while (at !== null && at - warn <= state.clock + 3) at = nextOccurrence(ev, at + 1);
      if (at !== null && (best === null || at - warn < best)) best = at - warn;
    }
  }
  if (best !== null) {
    jumpTo(best - 3);
    setPlaying(true);
  }
}

// --- Controls -------------------------------------------------------------------
slider.max = String(MAX_CLOCK);
playBtn.addEventListener("click", () => setPlaying(!state.playing));
for (const b of speedBtns) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
slider.addEventListener("input", () => jumpTo(Number(slider.value)));
$id("jumpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = parseTime(jumpInput.value);
  jumpInput.setCustomValidity(t === null ? "Use m:ss, e.g. 4:28" : "");
  jumpInput.reportValidity();
  if (t !== null) jumpTo(t);
});
// The game marks its state on the HUD root; the mod only runs in a real match.
const inMatchBox = $id<HTMLInputElement>("inMatch");
function applyMatchState(): void {
  const hudEl = $id<HTMLElement>("hud");
  hudEl.classList.toggle("GameStateInProgress", true);
  hudEl.classList.toggle("gamemode_standard", state.inMatch);
  hudEl.classList.toggle("connectedToHideout", !state.inMatch);
  hudEl.classList.toggle("InHideout", !state.inMatch);
}
inMatchBox.checked = state.inMatch;
inMatchBox.addEventListener("change", () => { state.inMatch = inMatchBox.checked; save(); applyMatchState(); });
applyMatchState();

pauseOnBanner.checked = state.pauseOnBanner;
pauseOnBanner.addEventListener("change", () => { state.pauseOnBanner = pauseOnBanner.checked; save(); });
nextWarn.addEventListener("click", jumpToNextWarning);
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") { e.preventDefault(); setPlaying(!state.playing); }
});

// --- Fake shop: souls counter and Quickbuy queue -----------------------------------
const soulsInput = $id<HTMLInputElement>("souls");
const queueInfo = $id<HTMLElement>("queueInfo");
const buyBtn = $id<HTMLButtonElement>("buyNext");
let shownSouls = -1;
function showShop(force = false): void {
  const souls = Math.floor(state.souls);
  if (!force && souls === shownSouls) return;
  shownSouls = souls;
  renderFakeShop(souls, state.queueIndex);
  if (document.activeElement !== soulsInput) soulsInput.value = String(souls);
  const next = EXAMPLE_QUEUE[state.queueIndex];
  queueInfo.textContent = next ? `Example queue: ${EXAMPLE_QUEUE.length - state.queueIndex} left` : "Queue empty";
  buyBtn.textContent = next ? "Buy next" : "Refill queue";
  buyBtn.disabled = !!next && souls < next.cost;
}
soulsInput.addEventListener("change", () => {
  const n = Number(soulsInput.value.replace(/[^\d]/g, ""));
  if (Number.isFinite(n)) { state.souls = n; save(); showShop(true); }
});
$id("addSouls").addEventListener("click", () => { state.souls += 500; save(); showShop(true); });
buyBtn.addEventListener("click", () => {
  const next = EXAMPLE_QUEUE[state.queueIndex];
  if (!next) state.queueIndex = 0;
  else if (state.souls >= next.cost) { state.souls -= next.cost; state.queueIndex++; }
  save();
  showShop(true);
});
showShop(true);

// Fast-forward makes banners flash by; optionally pause when one appears.
new MutationObserver(() => {
  if (banner.classList.contains("Visible") && state.playing && state.pauseOnBanner && state.speed > 1) setPlaying(false);
}).observe(banner, { attributes: true, attributeFilter: ["class"] });

// --- Scale the 1920x1080 HUD to the stage ------------------------------------
const stage = $id<HTMLElement>("stage");
const hud = $id<HTMLElement>("hud");
function fit(): void {
  if (capture) { hud.style.transform = "none"; return; } // real size for screenshots
  const s = Math.min(stage.clientWidth / 1920, stage.clientHeight / 1080);
  hud.style.transform = `scale(${s})`;
}
new ResizeObserver(fit).observe(stage);
fit();

// --- Main loop: game clock + Panorama scheduler in lockstep --------------------
// setInterval (not requestAnimationFrame) so it keeps running when the tab is in the background.
let last = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(1, (now - last) / 1000);
  last = now;
  // Capture mode: once the target time is reached, freeze everything (banners stay up for the shot).
  if (capture && captureUntil !== null && !state.playing && state.clock >= captureUntil) return;
  // While paused the scheduler keeps running at 1x (like the real HUD), the clock doesn't.
  let remaining = state.playing ? dt * state.speed : dt;
  while (remaining > 1e-9) {
    const step = Math.min(STEP, remaining);
    remaining -= step;
    if (state.playing) {
      state.clock = Math.min(MAX_CLOCK, state.clock + step);
      if (captureUntil !== null && state.clock >= captureUntil) setPlaying(false);
      state.souls += step * SOULS_PER_SECOND;
      if (state.clock >= MAX_CLOCK) setPlaying(false);
    }
    showClock();
    showShop();
    advance(step);
  }
}

setSpeed(state.speed);
setPlaying(state.playing);
showClock();
frame();
setInterval(frame, 16);

// --- Live reload ---------------------------------------------------------------
// No live reload while capturing (an open connection would stall a headless screenshot).
if (!capture) {
  const live = new EventSource("/live");
  live.addEventListener("reload", () => { save(); location.reload(); });
}
// Capture mode: open the options panel once the mod has wired up its buttons.
if (capture && params.get("options") === "1") {
  const open = setInterval(() => {
    const b = document.getElementById("DAOptionsButton") as HTMLElement | null;
    if (b?.onclick) { b.click(); clearInterval(open); }
  }, 100);
}

// Surface script errors logged by the mod.
setInterval(() => {
  const err = runtime.logs.find((l) => /error/i.test(l));
  if (err) { $id("error").textContent = `Mod script: ${err}`; $id("error").hidden = false; }
}, 1000);
