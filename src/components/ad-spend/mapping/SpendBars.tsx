"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { fmtDay, fmtMoney } from "./format";

/**
 * Daily spend over the page's window, one bar per day. Enough to recognise a
 * campaign ("the one that ran all August") and to see when a dated remap would
 * bite; not an analysis chart — the page has those.
 */
export function SpendBars({
  daily,
  from,
  to,
  currency,
}: {
  daily: [string, number][];
  from: string;
  to: string;
  currency: string;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();

  const { days, max } = useMemo(() => {
    const byDay = new Map(daily);
    const out: { day: string; amount: number }[] = [];
    const d = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (d <= end && out.length < 400) {
      const iso = d.toISOString().slice(0, 10);
      out.push({ day: iso, amount: byDay.get(iso) ?? 0 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return { days: out, max: Math.max(0, ...out.map((x) => x.amount)) };
  }, [daily, from, to]);

  // First day, each month start, last day.
  const monthStarts = days.filter((d) => d.day.endsWith("-01")).map((d) => d.day);
  const labels = [days[0]?.day, ...monthStarts, days[days.length - 1]?.day].filter(
    (d, i, a): d is string => !!d && a.indexOf(d) === i,
  );

  return (
    <div className="rounded-[10px] border border-line-subtle px-3.5 pt-3 pb-2">
      <div className="flex justify-between text-[11.5px] text-ink-secondary mb-2">
        <span>{t("chartTitle")}</span>
        {max > 0 && <span className="tabular-nums">{t("chartMax", { amount: `${fmtMoney(max)} ${currency}` })}</span>}
      </div>
      {max > 0 ? (
        <div className="flex items-end gap-px h-16" role="img" aria-label={t("chartTitle")}>
          {days.map((d) =>
            d.amount > 0 ? (
              <i
                key={d.day}
                title={`${fmtDay(d.day, locale)} · ${fmtMoney(d.amount)} ${currency}`}
                className="flex-1 min-w-0 rounded-t-[1px] bg-ink-primary/80"
                style={{ height: `${Math.max(4, (d.amount / max) * 100)}%` }}
              />
            ) : (
              <i key={d.day} className="flex-1 min-w-0 h-[2px] bg-line-subtle" />
            ),
          )}
        </div>
      ) : (
        <div className="h-16 grid place-items-center rounded-[6px] bg-surface-sunken text-[12.5px] text-ink-muted">
          {t("noSpendPeriod")}
        </div>
      )}
      <div className="flex justify-between text-[10.5px] text-ink-muted mt-1.5 pt-1 border-t border-line">
        {labels.map((d) => (
          <span key={d}>{fmtDay(d, locale)}</span>
        ))}
      </div>
    </div>
  );
}
