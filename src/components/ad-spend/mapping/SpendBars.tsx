"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addDays, eachDay, fmtDay, fmtMoney, fmtMonth } from "./format";

/**
 * Daily spend, one bar per day. Enough to recognise a campaign ("the one that
 * ran all August"), not an analysis chart — the page has those.
 *
 * Without `cut`: a slim strip over the whole history, months on the axis.
 * With `cut`: the editor's view of the campaign's own span, where a dated
 * change cuts it — grey is left as it is, black follows the new choice.
 */
export function SpendBars({
  daily,
  from,
  to,
  currency,
  label,
  cut,
}: {
  daily: [string, number][];
  from: string;
  to: string;
  currency: string;
  label: string;
  /** The editor's mode: `from` = the cut, null = the whole span follows the change. */
  cut?: { from: string | null };
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();

  const framed = !!cut;
  const { days, max, byDay } = useMemo(() => {
    const byDay = new Map(daily);
    // The editor frames the campaign's own span, with two quiet days each side.
    const span = framed && daily.length > 0 ? [addDays(daily[0][0], -2), addDays(daily[daily.length - 1][0], 2)] : [from, to];
    return { days: eachDay(span[0], span[1]), max: Math.max(1, ...daily.map(([, v]) => v)), byDay };
  }, [daily, from, to, framed]);

  if (days.length === 0) return null;

  const cutFrom = cut?.from ?? null;
  const at = cutFrom ? days.indexOf(cutFrom) : -1;

  const bars = days.map((d) => {
    const amount = byDay.get(d) ?? 0;
    if (amount <= 0) return <i key={d} className={cut ? "flex-1 min-w-0" : "flex-1 min-w-0 h-[2px] bg-line-subtle"} />;
    const old = cutFrom !== null && d < cutFrom;
    return (
      <i
        key={d}
        title={`${fmtDay(d, locale)} · ${fmtMoney(amount)} ${currency}`}
        className={`flex-1 min-w-0 rounded-t-[1.5px] ${cut ? (old ? "bg-line-strong" : "bg-ink-primary") : "bg-ink-primary/80"}`}
        style={{ height: `${Math.max(8, (amount / max) * 100)}%` }}
      />
    );
  });

  if (!cut) {
    // Month names centred under their month.
    const starts = days.map((d, i) => [d, i] as const).filter(([d, i]) => i === 0 || d.endsWith("-01"));
    return (
      <div>
        <div className="flex items-end gap-px h-10 mt-[18px]" role="img" aria-label={label}>
          {bars}
        </div>
        <div className="relative h-[18px] border-t border-line text-[11px] text-ink-muted" aria-hidden>
          {starts.map(([d, i], j) => {
            const end = j + 1 < starts.length ? starts[j + 1][1] : days.length;
            // A month with less than a week on the axis ("oct." on 1 October) would overflow the edge.
            if (end - i < 7) return null;
            return (
              <span
                key={d}
                className="absolute top-[3px] whitespace-nowrap -translate-x-1/2 rtl:translate-x-1/2"
                style={{ insetInlineStart: `${((i + end) / 2 / days.length) * 100}%` }}
              >
                {fmtMonth(d, locale)}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="px-3.5 pt-3.5 pb-2.5 rounded-[12px] border border-line-subtle bg-surface-sunken">
      <div className="relative flex items-end gap-px h-[46px] mt-3" role="img" aria-label={label}>
        {bars}
        {at > 0 && cutFrom && (
          <span
            aria-hidden
            className="absolute -top-2 bottom-0 border-s-[1.5px] border-dashed border-ink-primary"
            style={{ insetInlineStart: `${(at / days.length) * 100}%` }}
          >
            <span className="absolute -top-3 start-[5px] px-[3px] bg-surface-sunken text-[11px] font-semibold whitespace-nowrap">
              {fmtDay(cutFrom, locale)}
            </span>
          </span>
        )}
      </div>
      <div className="flex justify-between mt-1.5 pt-1 border-t border-line text-[11px] text-ink-muted">
        <span>{fmtDay(days[0], locale)}</span>
        <span>{fmtDay(days[days.length - 1], locale)}</span>
      </div>
      <div className="flex gap-4 flex-wrap mt-2 text-[12px] text-ink-secondary">
        {cutFrom ? (
          <>
            <Swatch className="bg-line-strong" label={t("legendOld")} />
            <Swatch className="bg-ink-primary" label={t("legendNew")} />
          </>
        ) : (
          <Swatch className="bg-ink-primary" label={t("legendAll")} />
        )}
      </div>
    </div>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className={`inline-block w-2.5 h-2.5 rounded-[3px] ${className}`} />
      {label}
    </span>
  );
}
