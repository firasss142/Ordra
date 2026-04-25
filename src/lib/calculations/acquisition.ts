import { toCents } from "./math";

export function calculateCPA(adSpend: number, confirmedCount: number): number | null {
  if (confirmedCount === 0) return null;
  const cents = toCents(adSpend);
  return Math.round((cents / confirmedCount)) / 100;
}

export function calculateCPL(adSpend: number, leadsCount: number): number | null {
  if (leadsCount === 0) return null;
  const cents = toCents(adSpend);
  return Math.round((cents / leadsCount)) / 100;
}
