/**
 * Canvas grid color resolver.
 * Constructs CSS color-mix() strings that match the DOM grid's Tailwind classes.
 */

export interface GridColors {
  primary: string;
  background: string;
  muted: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  /** Dirty cell — matches bg-yellow-500/10 */
  dirty: string;
  /** Hover row — matches hover:bg-accent/50 */
  hover: string;
  /** Search match — matches bg-yellow-200/60 or similar */
  searchMatch: string;
  /** Current search match — ring-2 + bg-yellow-300/60 */
  searchMatchCurrent: string;
  /** New row — matches bg-primary/5 */
  newRow: string;
  /** Deleted row — matches bg-destructive/5 */
  deletedRow: string;
  headerBg: string;
  headerFg: string;
  rowNumBg: string;
}

function fallbackColor(isDark: boolean, varName: string): string {
  const lightFallbacks: Record<string, string> = {
    "--primary": "oklch(0.55 0.2 250)",
    "--background": "#fff",
    "--foreground": "oklch(0.15 0 0)",
    "--muted": "oklch(0.965 0 0)",
    "--muted-foreground": "oklch(0.5 0 0)",
    "--border": "oklch(0.9 0 0)",
    "--destructive": "oklch(0.55 0.2 20)",
    "--accent": "oklch(0.95 0 0)",
    "--row-number-bg": "#fff",
  };
  const darkFallbacks: Record<string, string> = {
    "--primary": "oklch(0.65 0.2 250)",
    "--background": "rgb(15,15,15)",
    "--foreground": "oklch(0.95 0 0)",
    "--muted": "oklch(0.25 0 0)",
    "--muted-foreground": "oklch(0.6 0 0)",
    "--border": "oklch(0.28 0 0)",
    "--destructive": "oklch(0.6 0.2 20)",
    "--accent": "oklch(0.28 0 0)",
    "--row-number-bg": "rgb(15,15,15)",
  };
  return isDark ? (darkFallbacks[varName] ?? "#000") : (lightFallbacks[varName] ?? "#fff");
}

function readVar(style: CSSStyleDeclaration, name: string, isDark: boolean): string {
  const raw = style.getPropertyValue(name).trim();
  return raw || fallbackColor(isDark, name);
}

/**
 * Return a color-mix() string matching the given color + opacity.
 * e.g. mixColor("oklch(0.55 0.2 250)", 5) → "color-mix(in oklab, oklch(0.55 0.2 250) 5%, transparent)"
 */
function mixColor(color: string, pct: number): string {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

export function resolveGridColors(isDark: boolean): GridColors {
  if (typeof document === "undefined") {
    // SSR / no document — return hardcoded dark defaults
    isDark = true;
  }

  const style = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;

  const read = (name: string) => (style ? readVar(style, name, isDark) : fallbackColor(isDark, name));

  const destructive = read("--destructive");
  const primary = read("--primary");
  const muted = read("--muted");
  const accent = read("--accent");
  const background = read("--background");

  return {
    primary,
    background,
    muted: mixColor(muted, 30), // matches bg-muted/30
    foreground: read("--foreground"),
    mutedForeground: read("--muted-foreground"),
    border: read("--border"),
    dirty: "color-mix(in oklab, oklch(0.8 0.15 85) 10%, transparent)", // bg-yellow-500/10
    hover: mixColor(accent, 50), // matches hover:bg-accent/50
    searchMatch: "rgba(250,204,21,0.3)", // bg-yellow-200/60-ish
    searchMatchCurrent: "rgba(250,204,21,0.55)", // current match — more solid
    newRow: mixColor(primary, 5), // matches bg-primary/5
    deletedRow: mixColor(destructive, 5), // matches bg-destructive/5
    headerBg: read("--muted"),
    headerFg: read("--muted-foreground"),
    rowNumBg: background,
  };
}
