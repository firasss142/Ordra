export function computeTTFCMinutes(
  assignedAt: string | null,
  firstAttemptAt: string | null
): number | null {
  if (!assignedAt || !firstAttemptAt) return null;
  const a = new Date(assignedAt).getTime();
  const f = new Date(firstAttemptAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(f)) return null;
  if (f < a) return null;
  return Math.round((f - a) / 60_000);
}

export function medianMinutes(values: Array<number | null>): number | null {
  const clean = values.filter((v): v is number => typeof v === "number");
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentileMinutes(
  values: Array<number | null>,
  p: number
): number | null {
  const clean = values.filter((v): v is number => typeof v === "number");
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return Math.round(sorted[lo] + frac * (sorted[hi] - sorted[lo]));
}
