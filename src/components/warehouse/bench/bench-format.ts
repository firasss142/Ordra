import type { PrepRow } from "@/components/warehouse/console/PrepCard";

/**
 * Small shared readings of a bench parcel, as the v3 prototype prints them.
 */

/**
 * Age on the BENCH (since upload), in the prototype's words: « à l'instant »,
 * « il y a 5 h », « il y a 3 j ». Days are rounded, as `age()` does there.
 * Past 48 hours the row wears a warning chip.
 */
export function benchAge(row: Pick<PrepRow, "uploaded_at" | "created_at">, now = Date.now()) {
  const since = row.uploaded_at ?? row.created_at;
  const hours = Math.max(0, Math.floor((now - new Date(since).getTime()) / 3_600_000));
  if (hours === 0) return { key: "ageNow" as const, n: 0, hours, warn: false };
  if (hours < 24) return { key: "ageHours" as const, n: hours, hours, warn: false };
  return { key: "ageDays" as const, n: Math.round(hours / 24), hours, warn: hours > 48 };
}

/** « Sara », not « Sara Ben Ali »: the bench names the customer the way the floor does. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The scan run on a roll (« Commencer »). */
export function rollHref(locale: string, hex: string): string {
  return `/${locale}/warehouse/scan?roll=${encodeURIComponent(hex)}`;
}

/** The scan run opened on ONE parcel — its roll when it has one. */
export function runHref(locale: string, row: Pick<PrepRow, "id" | "zone">): string {
  const hex = row.zone.colorHex;
  return hex
    ? `${rollHref(locale, hex)}&order=${encodeURIComponent(row.id)}`
    : `/${locale}/warehouse/scan?order=${encodeURIComponent(row.id)}`;
}
