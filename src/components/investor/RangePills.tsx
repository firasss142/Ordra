"use client";
import { useTranslations } from "next-intl";

export type Range = "1w" | "1m" | "3m" | "period" | "all";
export const RANGES: Range[] = ["1w", "1m", "3m", "period", "all"];

export function RangePills({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = useTranslations("investor.range");
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {RANGES.map((r) => (
        <button key={r} type="button" role="tab" aria-selected={value === r} onClick={() => onChange(r)}
          className={`h-[26px] rounded-lg border px-2.5 text-[12px] font-semibold ${value === r ? "border-oms-border-strong bg-oms-sunken text-oms-ink-1" : "border-oms-border bg-oms-surface text-oms-ink-2"}`}>
          {t(r)}
        </button>
      ))}
    </div>
  );
}

export function rangeStartISO(range: Range, todayISO: string, dealStart: string, lastStatementEnd: string | null): string {
  const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (range === "all") return dealStart;
  if (range === "period") return lastStatementEnd ? addDays(lastStatementEnd, 1) : dealStart;
  const s = addDays(todayISO, range === "1w" ? -6 : range === "1m" ? -30 : -91);
  return s < dealStart ? dealStart : s;
}
