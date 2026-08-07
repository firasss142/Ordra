import { calculatePeriodDelta } from "@/lib/calculations/deltas";

// Statistical confidence in a period-over-period comparison, driven purely by
// the denominator behind the current figure.
//
// WHY: the dashboard used to render "-23.3 pp vs mois dernier" on a delivery
// rate computed from six delivered orders. That is noise presented as a precise
// fact, and it trains people to ignore the whole page. Every comparable number
// now carries the `n` it was derived from so the UI can refuse to draw a
// confident delta on thin data.
export type Confidence = "ok" | "low" | "none";

// n >= 30 is the conventional threshold where a proportion starts to behave;
// below 10 a single order moves the rate by >10 pp, so no delta is meaningful.
export const CONFIDENCE_OK_MIN = 30;
export const CONFIDENCE_LOW_MIN = 10;

export interface Metric {
  current: number;
  previous: number;
  /** Absolute change. For rates this is in percentage points. */
  delta: number;
  /** Relative change; null when `previous` is 0 (no baseline to divide by). */
  deltaPct: number | null;
  /** Denominator behind `current` — orders, leads, deliveries. */
  n: number;
  confidence: Confidence;
}

export function classifyConfidence(n: number, previous: number): Confidence {
  // No baseline means there is nothing to compare against, however large n is.
  if (previous === 0) return "none";
  if (n < CONFIDENCE_LOW_MIN) return "none";
  if (n < CONFIDENCE_OK_MIN) return "low";
  return "ok";
}

/**
 * Build a Metric from a current/previous pair.
 *
 * `n` defaults to `current` because for count metrics the value *is* its own
 * denominator. Rate metrics must pass the underlying population explicitly —
 * a 54.5% delivery rate has n = delivered + returned, not n = 54.5.
 */
export function toMetric(current: number, previous: number, n?: number): Metric {
  const { abs, pct } = calculatePeriodDelta(current, previous);
  const denominator = n ?? current;
  return {
    current,
    previous,
    delta: abs,
    deltaPct: pct,
    n: denominator,
    confidence: classifyConfidence(denominator, previous),
  };
}

export interface DeltaLabels {
  /** e.g. "vs 30 j précédents" */
  vsPrevious: string;
  /**
   * The denominator, stated in business words — e.g. n => "sur 18 commandes".
   *
   * This used to render "n=18". The honesty rule was right but the vocabulary
   * was engineering's, not the reader's: a market manager does not know what n
   * is, so the one line whose whole job was to admit uncertainty was the least
   * readable line on the page.
   *
   * A function rather than a template string: the message carries a real ICU
   * placeholder, so next-intl must do the interpolation itself. Substituting
   * "{n}" in JS makes next-intl treat it as an unprovided variable and throw
   * FORMATTING_ERROR, and it would block Arabic from using plural rules.
   */
  basedOn: (n: number) => string;
  /** e.g. n => "6 commandes — trop peu pour comparer" */
  tooFew: (n: number) => string;
  /** e.g. "pas d'historique" */
  noBaseline: string;
}

export type DeltaTone = "positive" | "negative" | "neutral";

export interface DeltaDisplay {
  /** Rendered text. Never contains a percentage when confidence is "none". */
  text: string;
  tone: DeltaTone;
  /** False when the figure is too thin to draw an arrow for. */
  showArrow: boolean;
}

/**
 * Render a Metric's comparison honestly.
 *
 * - ok    → "▾ 12.4% vs 30 j précédents"
 * - low   → "▾ 12.4% · sur 18 commandes"   (shown, but the denominator travels with it)
 * - none  → "6 commandes — trop peu pour comparer"  or  "pas d'historique"
 *
 * `invert` flips the tone for metrics where up is bad (rejection rate).
 * `pp` renders the absolute delta in percentage points instead of a percentage,
 * which is correct for rate metrics — a confirmation rate moving 78→80 is
 * "+2 pp", not "+2.6%".
 */
export function formatDelta(
  metric: Metric,
  labels: DeltaLabels,
  opts: { invert?: boolean; pp?: boolean } = {},
): DeltaDisplay {
  const { invert = false, pp = false } = opts;

  if (metric.confidence === "none") {
    const text = metric.previous === 0 ? labels.noBaseline : labels.tooFew(metric.n);
    return { text, tone: "neutral", showArrow: false };
  }

  const rising = metric.delta > 0;
  const flat = metric.delta === 0;
  const tone: DeltaTone = flat ? "neutral" : rising !== invert ? "positive" : "negative";

  const magnitude = pp
    ? `${Math.abs(metric.delta).toFixed(1)} pp`
    : metric.deltaPct != null
      ? `${Math.abs(metric.deltaPct * 100).toFixed(1)}%`
      : `${Math.abs(metric.delta).toFixed(1)}`;

  const arrow = flat ? "" : rising ? "▲ " : "▼ ";
  const suffix =
    metric.confidence === "low"
      ? ` · ${labels.basedOn(metric.n)}`
      : ` ${labels.vsPrevious}`;

  return { text: `${arrow}${magnitude}${suffix}`, tone, showArrow: !flat };
}
