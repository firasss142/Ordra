"use client";

import { useTranslations } from "next-intl";
import type { Period } from "@/components/dashboard/FilterBar";

export type PeriodPreset = "yesterday" | "7d" | "30d" | "custom";

interface Props {
  period: Period;
  preset: PeriodPreset;
  onChange: (period: Period, preset: PeriodPreset) => void;
  /** ISO day "today" in the market's timezone */
  todayISO: string;
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Segmented Hier / 7 jours / 30 jours / Personnalisé — market-local days. */
export function PeriodControls({ period, preset, onChange, todayISO }: Props) {
  const t = useTranslations("team.perf.periods");
  const select = (p: PeriodPreset) => {
    if (p === "yesterday") onChange({ from_date: shift(todayISO, -1), to_date: shift(todayISO, -1) }, p);
    else if (p === "7d") onChange({ from_date: shift(todayISO, -6), to_date: todayISO }, p);
    else if (p === "30d") onChange({ from_date: shift(todayISO, -29), to_date: todayISO }, p);
    else onChange(period, p);
  };
  const inputCls = "h-[38px] rounded-lg border border-line bg-surface-card px-2.5 text-[13px] text-ink-primary";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-line bg-surface-card" role="group" aria-label={t("label")}>
        {(["yesterday", "7d", "30d", "custom"] as PeriodPreset[]).map((p, i) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            onClick={() => select(p)}
            className={`px-4 py-[9px] text-[13.5px] font-medium text-ink-primary hover:bg-surface-hover ${i < 3 ? "border-e border-line" : ""} ${preset === p ? "bg-surface-selected font-semibold" : ""}`}
          >
            {t(p)}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <label>{t("from")}</label>
          <input type="date" className={inputCls} value={period.from_date} max={period.to_date} onChange={(e) => onChange({ ...period, from_date: e.target.value }, "custom")} />
          <label>{t("to")}</label>
          <input type="date" className={inputCls} value={period.to_date} min={period.from_date} max={todayISO} onChange={(e) => onChange({ ...period, to_date: e.target.value }, "custom")} />
        </div>
      )}
    </div>
  );
}
