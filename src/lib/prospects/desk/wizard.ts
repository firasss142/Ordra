/**
 * « Nouvelle liste », the 3-step guide (prototypes/prospects-manager-v5.html).
 * The manager answers plain questions; this file turns the answers into the
 * audience conditions the existing engine already counts and runs
 * (lib/prospects/audience.ts → campaign_audience_rows). One definition of
 * « who is in the list », whatever screen built it.
 */
import type { Condition } from "../audience";

export type Start = "old" | "rej" | "ret" | "csv";
export type Preset = "7" | "30" | "90" | "month" | "last" | "custom";
export interface Range { preset: Preset; from: string; to: string }
export type WaTemplate = "new_book" | "changed" | "returned" | "free";

export interface Draft {
  step: 1 | 2 | 3;
  start: Start;
  /** Empty = every product. `own` = this product's own window instead of `range`. */
  products: { id: string; own: Range | null }[];
  range: Range;
  subreasons: string[];
  noReorder: boolean;
  refine: { cities: string[] | null; orderCountMin: number | null; basketMin: number | null };
  /** What the agent (or the message) proposes. One or several products (owner, 2026-10-06). */
  offerProductIds: string[];
  offer: string;
  name: string;
  how: "call" | "wa";
  wa: { tpl: WaTemplate | null; lang: "ar" | "fr"; message: string; image: boolean; buttons: { yes: boolean; call: boolean; no: boolean } };
  /** `text` is what /api/leads/import receives; `rows` the preview of it. */
  csv: { fileName: string; rows: { name: string; phone: string; city: string | null }[]; text?: string } | null;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function presetRange(preset: Exclude<Preset, "custom">, now: number = Date.now()): Range {
  const d = new Date(now);
  if (preset === "month") return { preset, from: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to: iso(now) };
  if (preset === "last") {
    return { preset, from: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), to: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)) };
  }
  return { preset, from: iso(now - Number(preset) * DAY), to: iso(now) };
}

export const DEFAULT_SUBREASONS = ["changement_avis", "prix_eleve", "pas_de_reponse"];

export function newDraft(start: Start, now: number = Date.now(), lang: "ar" | "fr" = "ar"): Draft {
  const range: Range = start === "old"
    ? { preset: "custom", from: iso(now - 180 * DAY), to: iso(now - 30 * DAY) }
    : presetRange(start === "ret" ? "90" : "30", now);
  return {
    step: 1, start, products: [], range,
    subreasons: start === "rej" ? [...DEFAULT_SUBREASONS] : [],
    noReorder: start === "old" || start === "ret",
    refine: { cities: null, orderCountMin: null, basketMin: null },
    offerProductIds: [], offer: "", name: "", how: "call",
    wa: { tpl: null, lang, message: "", image: true, buttons: { yes: true, call: true, no: true } },
    csv: null,
  };
}

const STATUSES: Record<Exclude<Start, "csv">, Extract<Condition, { kind: "outcome" }>["statuses"]> = {
  old: ["delivered"],
  rej: ["rejected"],
  ret: ["returning", "to_be_returned", "returned"],
};

const spanDays = (r: Range) => Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / DAY));

export function toConditions(d: Draft): Condition[] {
  if (d.start === "csv") return [];
  const cs: Condition[] = [
    { kind: "outcome", statuses: STATUSES[d.start] },
    { kind: "period", mode: "custom", days: spanDays(d.range), from: d.range.from, to: d.range.to },
  ];
  if (d.products.length) {
    const windows = d.products.filter((p) => p.own).map((p) => ({ productId: p.id, from: p.own!.from, to: p.own!.to }));
    cs.push(windows.length ? { kind: "product", productIds: d.products.map((p) => p.id), windows } : { kind: "product", productIds: d.products.map((p) => p.id) });
  }
  if (d.start === "rej" && d.subreasons.length) cs.push({ kind: "subreason", subreasons: d.subreasons });
  if (d.refine.cities?.length) cs.push({ kind: "city", cities: d.refine.cities });
  if (d.refine.orderCountMin) cs.push({ kind: "orderCount", op: "gte", n: d.refine.orderCountMin });
  if (d.refine.basketMin) cs.push({ kind: "basket", min: d.refine.basketMin });
  if (d.noReorder && d.start !== "rej") cs.push({ kind: "noOrderAfterOutcome" });
  return cs;
}

const ordered = (r: Range) => r.from <= r.to;

export function canContinue(d: Draft): boolean {
  if (d.step === 1) {
    if (d.start === "csv") return Boolean(d.csv && d.csv.rows.length);
    if (!ordered(d.range) || d.products.some((p) => p.own && !ordered(p.own))) return false;
    if (d.start === "rej" && d.subreasons.length === 0) return false;
    return true;
  }
  if (d.step === 3 && d.how === "wa") return d.wa.message.trim().length > 0;
  return true;
}
