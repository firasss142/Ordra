export function toCents(n: number): number {
  return Math.round(n * 100);
}

export function fromCents(n: number): number {
  return n / 100;
}
