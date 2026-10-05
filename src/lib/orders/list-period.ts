import { addMonths, lastDayOfMonth, shiftDays } from "@/lib/performance/orders/period";

/**
 * The date button of Commandes and Archivées (prototype `PRESETS` / `range`):
 * the same popover as Accueil and Performance, with « Toutes les dates » first,
 * because a working list is not a report and opens on everything.
 * Dates are market-local days; the list route turns them into UTC instants.
 */
export const LIST_PRESETS = ["all", "today", "yday", "7d", "30d", "month"] as const;
export type ListPreset = (typeof LIST_PRESETS)[number];
export type ListPeriod = ListPreset | `m:${string}` | "custom";

export interface MaybeRange {
  from: string | null;
  to: string | null;
}

export function presetDates(key: ListPreset | `m:${string}`, today: string): MaybeRange {
  switch (key) {
    case "all": return { from: null, to: null };
    case "today": return { from: today, to: today };
    case "yday": {
      const d = shiftDays(today, -1);
      return { from: d, to: d };
    }
    case "7d": return { from: shiftDays(today, -6), to: today };
    case "30d": return { from: shiftDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
    default: {
      const m = key.slice(2);
      return { from: `${m}-01`, to: lastDayOfMonth(m) };
    }
  }
}

/** The two whole months before the current one, newest first. */
export function wholeMonthsBack(today: string): string[] {
  const m = today.slice(0, 7);
  return [addMonths(m, -1), addMonths(m, -2)];
}

/** Which preset produced these dates — « custom » when none did. */
export function periodOf(from: string | null, to: string | null, today: string): ListPeriod {
  if (!from && !to) return "all";
  for (const k of LIST_PRESETS) {
    const r = presetDates(k, today);
    if (r.from === from && r.to === to) return k;
  }
  for (const m of wholeMonthsBack(today)) {
    const r = presetDates(`m:${m}`, today);
    if (r.from === from && r.to === to) return `m:${m}`;
  }
  return "custom";
}
