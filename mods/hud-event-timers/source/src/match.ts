// Is this a real match? The game puts its state on the HUD root as classes, e.g.
// "connectedToGame ... gamemode_standard GameStateInProgress" in a match, and
// "connectedToHideout" / "InHideout" in the hideout (where a clock runs too).

export interface MatchConfig {
  /** All of these must be on a HUD ancestor. */
  requireClasses: string[];
  /** None of these may be on a HUD ancestor. */
  blockClasses: string[];
}

/** `hasClass` asks whether a HUD ancestor has the class. Without a config, always true. */
export function matchActive(cfg: MatchConfig | undefined, hasClass: (cls: string) => boolean): boolean {
  if (!cfg) return true;
  return cfg.requireClasses.every((c) => hasClass(c)) && !cfg.blockClasses.some((c) => hasClass(c));
}

export function validateMatch(cfg: MatchConfig | undefined): void {
  if (!cfg) return;
  for (const key of ["requireClasses", "blockClasses"] as const) {
    if (!Array.isArray(cfg[key])) throw new Error(`match.${key} must be a list of class names`);
    for (const c of cfg[key]) if (!/^[A-Za-z_][\w-]*$/.test(c)) throw new Error(`match.${key}: "${c}" must be a bare class name (no . or #)`);
  }
}
