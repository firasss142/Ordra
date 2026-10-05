"use client";

// The period pills of the prototype (periodSeg) — Aujourd'hui · 7 jours ·
// 30 jours · Ce mois · Personnalisé — CONTROLLED by the period they show: the lit
// pill is read from the dates (presetOf), never remembered. The old
// PeriodSelector kept « Aujourd'hui » in useState and lit it over 30 days of data.

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DayPicker, type DateRange } from "react-day-picker";
import { Calendar, Info } from "lucide-react";
import { ar, fr } from "date-fns/locale";
import { Popover } from "@/components/ui/Popover";
import { presetOf, presetPeriod, type DayRange, type PeriodPreset } from "@/lib/products/period";
import { rangeLabel } from "@/lib/products/format";
import { useUiLocale } from "./atoms";
import "@/components/ui/datepicker.css";

const PILLS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: "per_today" },
  { key: "7d", label: "per_7" },
  { key: "30d", label: "per_30" },
  { key: "month", label: "per_month" },
];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PeriodSeg({
  period,
  tz,
  onChange,
}: {
  period: DayRange;
  tz: string;
  onChange: (range: DayRange) => void;
}) {
  const t = useTranslations("products.v6");
  const tPicker = useTranslations("datePicker");
  const locale = useUiLocale();
  const active = presetOf(period, tz);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  return (
    <div className="seg" role="group" aria-label={t("per_custom")}>
      {PILLS.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={active === p.key}
          className={active === p.key ? "on" : undefined}
          onClick={() => onChange(presetPeriod(p.key, tz))}
        >
          {t(p.label)}
        </button>
      ))}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setDraft(undefined);
        }}
        align="end"
        panelClassName="overflow-hidden"
        trigger={
          <button type="button" aria-pressed={active === "custom"} className={active === "custom" ? "on" : undefined}>
            {t("per_custom")}
          </button>
        }
      >
        <div className="p-2" dir={locale === "ar" ? "rtl" : "ltr"}>
          <DayPicker
            className="oms-rdp"
            mode="range"
            selected={draft ?? { from: new Date(`${period.from}T00:00:00`), to: new Date(`${period.to}T00:00:00`) }}
            onSelect={(range) => {
              setDraft(range);
              if (range?.from && range.to) {
                onChange({ from: iso(range.from), to: iso(range.to) });
                setDraft(undefined);
                setOpen(false);
              }
            }}
            numberOfMonths={2}
            locale={locale === "ar" ? ar : fr}
            dir={locale === "ar" ? "rtl" : "ltr"}
            weekStartsOn={locale === "ar" ? 6 : 1}
            disabled={[{ after: new Date() }]}
            labels={{
              labelPrevious: () => tPicker("prevMonth"),
              labelNext: () => tPicker("nextMonth"),
            }}
          />
        </div>
      </Popover>
    </div>
  );
}

/**
 * The period row of every products screen: the pills, the dates, and the basis
 * chip — what a figure here counts (orders RECEIVED in the period, followed to
 * today), which is not what the P&L counts. `extra` sits at the end (the sheet
 * puts « Résultat définitif » there).
 */
export function PeriodRow({
  period,
  tz,
  onChange,
  extra,
}: {
  period: DayRange;
  tz: string;
  onChange: (range: DayRange) => void;
  extra?: ReactNode;
}) {
  const t = useTranslations("products.v6");
  const locale = useUiLocale();
  return (
    <div className="prow rise" style={{ ["--d" as string]: 1 }}>
      <PeriodSeg period={period} tz={tz} onChange={onChange} />
      <span className="chip lg">
        <Calendar className="ic" aria-hidden />
        {rangeLabel(period.from, period.to, locale)}
      </span>
      <span className="chip lg basis" data-tip={t("basis_tip")}>
        <Info className="ic" aria-hidden />
        {t("basis")}
      </span>
      {extra}
    </div>
  );
}
