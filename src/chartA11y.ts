/**
 * Chart encoding rules that must not depend on colour alone. Pure and
 * webview-safe (types only, no DOM or Chart.js), so the palette, the point
 * markers, and the spoken/accessible description of a plotted point are unit
 * testable and identical everywhere they are used.
 *
 * The palette is a curated colour-blind-safe qualitative set built on the
 * Okabe–Ito hues, keeping each entry's own lightness and shifting it per theme:
 * one flat set cannot stay legible on both a white and a `#181b22` background,
 * and a free-running hashed hue — what this replaced — could put two models a
 * few degrees apart, which collapse for deuteranopia and protanopia. Two
 * entries count as distinct when they differ by 8+ lightness points, 40+ degrees
 * of hue, or a large saturation gap (a neutral grey is the standard
 * colour-vision-safe "other" slot, separable by chroma alone); that invariant is
 * asserted in the tests. Assignment stays stable per base model, and two models
 * in the same view never share an exact colour while the palette has room;
 * beyond that a deterministic hashed hue takes over, which is documented as a
 * limitation rather than pretended to be unique.
 */

export type ThemeName = "light" | "dark";

export interface PaletteEntry {
  /** Hue in degrees. */
  h: number;
  s: string;
  /** Lightness as authored, before the per-theme shift. */
  l: number;
  name: string;
}

/**
 * Okabe–Ito's eight hues, each keeping its own lightness, because that set is
 * validated for colour-vision deficiency *as light/contrast pairs* — flattening
 * every entry to one lightness would put the two orange-family hues a few
 * degrees apart at identical contrast, which is exactly the failure mode this
 * replaces. The pairwise invariant (any two entries differ by at least 8
 * lightness points or 40° of hue) is asserted in the tests.
 */
export const cvdSafePalette: readonly PaletteEntry[] = [
  { h: 199, s: "77%", l: 63, name: "sky blue" },
  { h: 36, s: "100%", l: 45, name: "orange" },
  { h: 163, s: "100%", l: 31, name: "bluish green" },
  // Vermillion sits 9° from orange; its lower lightness is what separates them.
  { h: 27, s: "100%", l: 33, name: "vermillion" },
  { h: 203, s: "100%", l: 35, name: "blue" },
  { h: 327, s: "44%", l: 64, name: "reddish purple" },
  { h: 54, s: "86%", l: 60, name: "yellow" },
  { h: 0, s: "0%", l: 50, name: "neutral" },
];

/** Per-theme shift and clamp, so the same set stays legible on both themes. */
const themeLightness = {
  light: (l: number) => Math.min(62, Math.max(30, l - 12)),
  dark: (l: number) => Math.min(80, Math.max(45, l + 16)),
} as const;

/** The documented fallback for views larger than the palette: a hashed hue. */
export function hashedColor(key: string, theme: ThemeName): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% ${theme === "light" ? "38%" : "68%"})`;
}

const paletteColor = (entry: PaletteEntry, theme: ThemeName) =>
  `hsl(${entry.h} ${entry.s} ${themeLightness[theme](entry.l)}%)`;

/**
 * One colour per base model id for this view. Ids are hashed into the palette
 * and collisions are resolved by probing, so the assignment is stable for a
 * given view and never hands the same colour to two models while the palette
 * has an unused entry.
 */
export function assignPointColors(
  baseModelIds: string[],
  theme: ThemeName,
): Map<string, string> {
  const ids = [...new Set(baseModelIds)].sort();
  const used = new Set<number>();
  const out = new Map<string, string>();
  for (const id of ids) {
    const start = hashKey(id) % cvdSafePalette.length;
    let slot = -1;
    for (let probe = 0; probe < cvdSafePalette.length; probe++) {
      const candidate = (start + probe) % cvdSafePalette.length;
      if (!used.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    if (slot === -1) {
      out.set(id, hashedColor(id, theme));
      continue;
    }
    used.add(slot);
    out.set(id, paletteColor(cvdSafePalette[slot], theme));
  }
  return out;
}

/** Chart.js point style for a row: shape carries meaning, not colour. */
export type PointMarker = "star" | "circle";

/**
 * The non-colour encoding. A recommendation is a star and a frontier row is a
 * ring (drawn by the chart's marker plugin, sized here); nothing about a row's
 * status may be conveyed by its colour alone.
 */
export function pointMarker(row: {
  frontier: boolean;
  recommended?: boolean;
}): PointMarker {
  return row.recommended ? "star" : "circle";
}

/** Radius per marker, so the two encodings also differ in size. */
export function pointRadius(row: {
  frontier: boolean;
  recommended?: boolean;
  used?: boolean;
}): number {
  if (row.recommended) return 11;
  if (row.frontier) return 7;
  return row.used ? 6 : 5;
}

/** Whether the frontier ring is drawn around a row's point. */
export function hasFrontierRing(row: { frontier: boolean }): boolean {
  return row.frontier;
}

export interface QuadrantMedians {
  cost: number;
  score: number;
}

/**
 * The most-attractive quadrant: above-median score at or below median cost.
 * `undefined` medians mean the shaded region is not being drawn, so no row may
 * claim membership — the table and the chart stay in agreement.
 */
export function inAttractiveQuadrant(
  row: { cost: number | null; score: number | null },
  medians: QuadrantMedians | undefined,
): boolean {
  if (!medians) return false;
  if (row.cost === null || row.score === null) return false;
  return row.score >= medians.score && row.cost <= medians.cost;
}

export interface PointSummaryInput {
  index: number;
  total: number;
  name: string;
  score: number | null;
  cost: number | null;
  unit: string;
  frontier: boolean;
  recommended: boolean;
  dominatedBy?: string[];
  medians?: QuadrantMedians;
}

/** Stable, process-independent hash; the same id always starts at the same hue. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

const num = (n: number | null) =>
  n === null
    ? "no value"
    : new Intl.NumberFormat("en", { maximumSignificantDigits: 5 }).format(n);

/**
 * One sentence describing everything the chart encodes for a point: position,
 * frontier membership, recommendation, and quadrant membership. Used both for
 * the live keyboard announcement and for the screen-reader description of the
 * chart, so the spoken text and the accessible text cannot drift apart.
 */
export function chartPointSummary(input: PointSummaryInput): string {
  const parts = [
    `${input.name}: ${num(input.score)} index points at ${num(input.cost)} ${input.unit}.`,
  ];
  if (input.frontier) parts.push("On the Pareto frontier.");
  if (input.recommended) parts.push("Recommended.");
  if (input.dominatedBy?.length)
    parts.push(`Dominated by ${input.dominatedBy.join(", ")}.`);
  if (inAttractiveQuadrant(input, input.medians))
    parts.push("In the most attractive quadrant.");
  if (input.cost === null) parts.push("No cost estimate for this row.");
  if (input.score === null) parts.push("No score for this row.");
  return parts.join(" ");
}

/** Screen-reader description of a whole chart, one sentence per point. */
export function chartDescription(
  heading: string,
  points: string[],
): string {
  return points.length
    ? `${heading} ${points.length} plotted models. ${points.join(" ")}`
    : `${heading} No comparable models to plot.`;
}
