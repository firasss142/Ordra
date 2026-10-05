// Accueil — how an arrow words a change. Pure; tested in __tests__/trend.test.ts.

export interface Change {
  dir: -1 | 0 | 1;
  /** Whole percentage of change, unsigned. */
  pct: number;
  /** From +200 %: « ×3 », « ×15 » reads at a glance where « 1 380 % » does not. */
  times: number | null;
}

export function change(now: number, prev: number): Change {
  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100);
  if (!pct) return { dir: 0, pct: 0, times: null };
  const dir = pct > 0 ? 1 : -1;
  return { dir, pct: Math.abs(pct), times: pct >= 200 ? Math.round(now / prev) : null };
}
