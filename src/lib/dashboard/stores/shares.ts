// Accueil v9 — each store's share of the orders, by largest remainder: the column always
// adds up to exactly 100 (round 1's pain was « numbers I don't trust »; 33 + 33 + 33 is one).
// Pure; tested in __tests__/shares.test.ts.

export function shareRound(ns: readonly number[]): number[] {
  const tot = ns.reduce((a, b) => a + b, 0);
  if (!tot) return ns.map(() => 0);
  const raw = ns.map((v) => (v / tot) * 100);
  const fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => [r - fl[i], i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0 && ns[i] > 0) {
        fl[i] += 1;
        left -= 1;
      }
    });
  return fl;
}
