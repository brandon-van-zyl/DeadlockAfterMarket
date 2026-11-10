// Pure timing logic: no Panorama APIs here, so it can be unit-tested in Node.

import { type NextItemConfig, validateNextItem } from "./shop.ts";
import { type MinimapConfig, validateMinimap } from "./minimap.ts";
import { type MatchConfig, validateMatch } from "./match.ts";

export interface EventDef {
  id: string;
  label: string;
  /** First spawn as match-clock "m:ss". */
  first: string;
  /** Repeat interval in seconds. Omit for a one-off (e.g. first spawn of a camp). */
  every?: number;
  /** Stop repeating after this match-clock time ("m:ss"). */
  until?: string;
  /** Timing is only roughly known (shown with a "~"). */
  approx?: boolean;
  /** Set false to hide this event without deleting it. */
  enabled?: boolean;
}

export interface Config {
  /** Show a banner when an event is this many seconds away. */
  warnSeconds: number[];
  /** How many upcoming events the panel lists (max 4). */
  showUpcoming: number;
  /** Only list events happening within this many seconds. */
  lookaheadSeconds: number;
  /** How long a warning banner stays up, in seconds. */
  bannerSeconds: number;
  /** Trooper wave countdown (a small line, never a banner). */
  waves?: WaveConfig;
  /** Souls needed for the next Quickbuy item (a small line, never a banner). */
  nextItem?: NextItemConfig;
  /** Hiding the mod's HUD: a key, plus an optional automatic hide later in the match. */
  hide?: HideConfig;
  /** Minimap size setting and crate markers. */
  minimap?: MinimapConfig;
  /** Which HUD states count as a real match (the hideout runs a clock too). */
  match?: MatchConfig;
  events: EventDef[];
}

export interface HideConfig {
  /** Panorama key name that toggles the mod's HUD, e.g. "key_F9". Empty to disable. */
  key: string;
  /** Hide automatically once the match clock reaches this "m:ss" (null = never). */
  autoHideAt: string | null;
}

export interface WavePhase {
  /** Phase start as match-clock "m:ss". A wave spawns at the start, then every `every` seconds. */
  from: string;
  every: number;
}

export interface WaveConfig {
  enabled?: boolean;
  label: string;
  /** Highlight the countdown in the last few seconds. */
  soonSeconds: number;
  /** When the first wave spawns at base, match-clock "m:ss" (default "0:00"). */
  firstWave?: string;
  /** Spawn intervals by match time, in time order: from `from` on, waves come every `every`s. */
  phases: WavePhase[];
}

export interface Occurrence {
  id: string;
  label: string;
  at: number;
  remaining: number;
  approx: boolean;
}

export interface Warning extends Occurrence {
  warn: number;
}

/** Parses the HUD clock ("12:34", "1:02:03", "-0:15") into seconds. Returns null if unreadable. */
export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(-)?(\d+):(\d{2})(?::(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const [, neg, a, b, c] = m;
  const secs = c !== undefined
    ? Number(a) * 3600 + Number(b) * 60 + Number(c)
    : Number(a) * 60 + Number(b);
  return neg ? -secs : secs;
}

/** Converts a config time ("m:ss") to seconds; throws on bad input so config mistakes fail the build. */
export function toSeconds(mmss: string): number {
  const s = parseClock(mmss);
  if (s === null) throw new Error(`Bad time "${mmss}", expected m:ss`);
  return s;
}

/** Formats seconds as "m:ss". */
export function formatSeconds(total: number): string {
  const t = Math.max(0, Math.ceil(total));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** The next time (>= now) this event happens, or null if it never happens again. */
export function nextOccurrence(ev: EventDef, now: number): number | null {
  const first = toSeconds(ev.first);
  if (now <= first) return first;
  if (!ev.every || ev.every <= 0) return null;
  const n = Math.ceil((now - first) / ev.every);
  const at = first + n * ev.every;
  if (ev.until !== undefined && at > toSeconds(ev.until)) return null;
  return at;
}

function activeEvents(cfg: Config): EventDef[] {
  return cfg.events.filter((e) => e.enabled !== false);
}

/** The next few events within the lookahead window, soonest first. */
export function upcoming(cfg: Config, now: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of activeEvents(cfg)) {
    const at = nextOccurrence(ev, now);
    if (at === null) continue;
    const remaining = at - now;
    if (remaining > cfg.lookaheadSeconds) continue;
    out.push({ id: ev.id, label: ev.label, at, remaining, approx: !!ev.approx });
  }
  // Plain comparison, not localeCompare: Panorama's JS may not have locale support, and the
  // tie-break only runs when two events share a time (e.g. 5:00), which froze the panel at 3:00.
  out.sort((a, b) => a.at - b.at || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return out.slice(0, Math.min(cfg.showUpcoming, 4));
}

/**
 * Warnings whose threshold was crossed between the previous clock reading and now.
 * Skips everything if the clock jumped (pause/reconnect/spectating) to avoid a burst of banners.
 */
export function crossedWarnings(cfg: Config, prev: number | null, now: number): Warning[] {
  if (prev === null || now <= prev || now - prev > 5) return [];
  const out: Warning[] = [];
  for (const ev of activeEvents(cfg)) {
    const at = nextOccurrence(ev, prev);
    if (at === null) continue;
    for (const warn of cfg.warnSeconds) {
      const trigger = at - warn;
      if (trigger > prev && trigger <= now) {
        out.push({ id: ev.id, label: ev.label, at, remaining: at - now, approx: !!ev.approx, warn });
      }
    }
  }
  return out;
}

export interface Banner {
  /** Event names, e.g. "Bridge buffs + Tunnel crates". */
  title: string;
  /** Countdown line, e.g. "in 30 seconds" or "in ~10 seconds". */
  time: string;
  urgent: boolean;
}

/**
 * One banner for everything that warned this tick.
 * Uses the most urgent threshold if several fired at once.
 */
export function bannerText(warnings: Warning[]): Banner | null {
  if (warnings.length === 0) return null;
  const warn = Math.min(...warnings.map((w) => w.warn));
  const group = warnings.filter((w) => w.warn === warn);
  // Several events at once: drop the trailing "spawn"/"drops" so the banner stays short
  // ("Bridge buffs + Medium camps + Tunnel crates").
  const short = (label: string) => (group.length > 1 ? label.replace(/\s+(spawns?|drops?)$/i, "") : label);
  const title = group.map((w) => short(w.label)).join(" + ");
  const approx = group.every((w) => w.approx) ? "~" : "";
  return { title, time: `in ${approx}${warn} seconds`, urgent: warn <= 10 };
}

/**
 * Seconds until the next trooper wave (0 on the spawn second), or null if waves are off.
 * Before the first phase it counts down to that phase's start.
 */
export function nextWave(waves: WaveConfig | undefined, now: number): number | null {
  if (!waves || waves.enabled === false || waves.phases.length === 0) return null;
  // Walk the spawns on the game clock: the first wave, then each next wave is the previous one
  // plus the interval in force at that moment. So the 20:00/35:00 changes keep the rhythm
  // instead of adding an extra wave at the change. At most ~150 steps for a 45-minute match.
  const starts = waves.phases.map((p) => toSeconds(p.from));
  const intervalAt = (t: number): number => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= t) i++;
    return waves.phases[i].every;
  };
  let t = toSeconds(waves.firstWave ?? "0:00");
  while (t < now) t += intervalAt(t);
  return t - now;
}

/** Throws a readable error for config mistakes. Run at build time. */
export function validateConfig(cfg: Config): void {
  const ids = new Set<string>();
  for (const ev of cfg.events) {
    if (!ev.id || !ev.label) throw new Error(`Every event needs an id and label: ${JSON.stringify(ev)}`);
    if (ids.has(ev.id)) throw new Error(`Duplicate event id "${ev.id}"`);
    ids.add(ev.id);
    toSeconds(ev.first);
    if (ev.until !== undefined) toSeconds(ev.until);
    if (ev.every !== undefined && !(ev.every > 0)) throw new Error(`"${ev.id}": every must be > 0 seconds`);
  }
  if (cfg.showUpcoming < 1 || cfg.showUpcoming > 4) throw new Error("showUpcoming must be 1 to 4");
  if (cfg.waves) {
    let prev = -Infinity;
    for (const p of cfg.waves.phases) {
      const from = toSeconds(p.from);
      if (from <= prev) throw new Error(`waves: phases must be in time order ("${p.from}")`);
      if (!(p.every > 0)) throw new Error(`waves: every must be > 0 seconds ("${p.from}")`);
      prev = from;
    }
    if (cfg.waves.firstWave !== undefined) toSeconds(cfg.waves.firstWave);
  }
  validateNextItem(cfg.nextItem);
  validateMinimap(cfg.minimap);
  validateMatch(cfg.match);
  if (cfg.hide) {
    if (cfg.hide.key && !/^key_\w+$/.test(cfg.hide.key)) throw new Error(`hide.key "${cfg.hide.key}" should look like "key_F9"`);
    if (cfg.hide.autoHideAt !== null && cfg.hide.autoHideAt !== undefined) toSeconds(cfg.hide.autoHideAt);
  }
}
