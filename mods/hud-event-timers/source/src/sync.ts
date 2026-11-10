// Keeping the mod in step with the game. The timers never count on their own: every tick they
// re-read the game's clock. These helpers decide WHICH clock to trust and when to start over.

import { parseClock } from "./schedule.ts";

export interface ClockReading {
  text: string | null;
  /** When this label's text last changed (script time, seconds). */
  changedAt: number;
}

/**
 * Index of the clock label to trust, or -1 if none is readable. The HUD has more than one
 * GameTime label; a live one changes every second, a stale one never does. So: the most
 * recently changed readable clock wins, and on a tie (e.g. game paused) we keep the previous
 * choice so it doesn't flip back and forth.
 */
export function chooseClock(readings: ClockReading[], previous: number): number {
  let best = -1;
  for (let i = 0; i < readings.length; i++) {
    if (parseClock(readings[i].text) === null) continue;
    if (best < 0) { best = i; continue; }
    const a = readings[i].changedAt, b = readings[best].changedAt;
    if (a > b || (a === b && i === previous)) best = i;
  }
  return best;
}

/**
 * True when the clock went back by more than `tolerance` seconds: a new match started, or we
 * were looking at a replay/spectated game. Small steps back (lag correction) don't count.
 */
export function clockRestarted(prev: number | null, now: number | null, tolerance = 30): boolean {
  return prev !== null && now !== null && now < prev - tolerance;
}
