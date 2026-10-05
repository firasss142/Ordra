"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { cityLabel } from "@/lib/carriers/scorecard/city-names";
import { fmtInt, fmtPct } from "@/lib/carriers/scorecard/format";
import {
  accentFor, carrierTitle, compareWinner, periodRate, share, sharedCities, weekRows,
} from "@/lib/carriers/scorecard/view-model";
import type { Scorecard, ScorecardCarrier, ScorecardPeriodDays } from "@/lib/carriers/scorecard/types";
import { trimSeries, WeeklyLines } from "./charts";
import { carrierSubtitle } from "./labels";
import { BackLink, PeriodSegment, ScorecardSub } from "./ScorecardHeader";
import { CarrierLogo, Card, CardHead, Num, Pill } from "./ui";

export interface CompareViewProps {
  scorecard: Scorecard;
  locale: string;
  marketCode: string;
  period: ScorecardPeriodDays;
  now: Date;
  onPeriodChange: (p: ScorecardPeriodDays) => void;
  overviewHref: string;
}

type Metric = "rate" | "pick" | "fast" | "first" | "ret7";

/** Every comparison is a share where higher is better, so the longer bar always wins. */
function metricValue(m: Metric, c: ScorecardCarrier): number | null {
  const p = c.period;
  switch (m) {
    case "rate": return periodRate(p).rate;
    case "pick": return share(p.picked_fast, p.picked);
    case "fast": return share(p.fast3, p.delivered);
    case "first": return p.first_attempt == null ? null : share(p.first_attempt, p.delivered);
    case "ret7": return share(c.returns.within7, c.returns.handed_back);
  }
}
const METRICS: Metric[] = ["rate", "pick", "fast", "first", "ret7"];

export function CompareView({ scorecard, locale, marketCode, period, now, onPeriodChange, overviewHref }: CompareViewProps) {
  const t = useTranslations("carrierScorecard");
  const cs = scorecard.carriers;

  const header = (
    <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-[14px]">
      <div>
        <BackLink href={overviewHref} />
        <h1 className="mt-[6px] text-[24px] font-[650] leading-[1.2] tracking-[-.02em] text-tr-ink-1">{t("cmp.title")}</h1>
        <ScorecardSub marketCode={marketCode} locale={locale} generatedAt={scorecard.generated_at} days={scorecard.days}
          lastSyncAt={scorecard.last_sync_at} now={now} withSync={false} />
      </div>
      <PeriodSegment period={period} onChange={onPeriodChange} />
    </div>
  );
  if (cs.length < 2) {
    return (
      <div className="flex flex-col gap-[16px]">
        {header}
        <Card><p className="px-[24px] py-[40px] text-center text-[13.5px] text-tr-ink-2">{t("cmp.needTwo")}</p></Card>
      </div>
    );
  }

  const [a, b] = cs;
  const ca = accentFor(a, 0), cb = accentFor(b, 1);
  const na = carrierTitle(a, locale), nb = carrierTitle(b, locale);
  const pickKey = marketCode === "tn" ? "tn" : "ly";

  const chip = (c: ScorecardCarrier, color: string, name: string, side: "a" | "b") => (
    <div style={{ "--c": color } as CSSProperties}
      className={`flex min-w-0 items-center gap-[11px] rounded-[12px] bg-[var(--c)] px-[14px] py-[11px] text-white ${side === "a" ? "min-[900px]:flex-row-reverse min-[900px]:text-end" : ""}`}>
      <CarrierLogo logoUrl={c.logo_url} code={c.code} name={name} size={36} radius={10} />
      <div className="min-w-0">
        <b className="block text-[16px] font-[650] leading-[1.2]">{name}</b>
        <span className="text-[12px] opacity-[.88]">{t("city.colis", { n: fmtInt(locale, c.period.sent) })} · {carrierSubtitle(c, marketCode, t)}</span>
      </div>
    </div>
  );

  const side = (v: number | null, win: boolean, color: string, s: "a" | "b") => (
    <div style={{ "--c": color } as CSSProperties}
      className={`flex min-w-0 items-center gap-[10px] ${s === "a" ? "min-[900px]:flex-row-reverse" : ""}`}>
      <span className="relative h-[14px] min-w-0 flex-1 before:absolute before:inset-0 before:rounded-[4px] before:bg-tr-well">
        <b className={`absolute inset-y-0 rounded-[4px] bg-[var(--c)] ${s === "a" ? "start-0 min-[900px]:end-0 min-[900px]:start-auto" : "start-0"}`}
          style={{ width: `${v ?? 0}%` }} />
      </span>
      <span title={win ? t("cmp.best") : undefined}
        className={`inline-flex min-w-[64px] items-center gap-[4px] text-[15px] tabular-nums ${s === "a" ? "min-[900px]:justify-end" : ""} ${win ? "font-bold text-tr-ink-1" : "font-medium text-tr-ink-2"}`}>
        {v == null ? <span className="text-[12.5px] font-normal text-tr-ink-3">{t("cmp.na")}</span> : <Num>{fmtPct(locale, v)}</Num>}
        {win ? <Check size={15} strokeWidth={2.6} aria-hidden className="text-tr-ok" /> : null}
      </span>
    </div>
  );

  const series = trimSeries([
    { id: a.id, name: na, color: ca, rows: weekRows(a.weeks) },
    { id: b.id, name: nb, color: cb, rows: weekRows(b.weeks) },
  ]);
  const cities = sharedCities(a.cities, b.cities);
  const target = scorecard.settings.target_pct;
  const shape = (i: number, color: string) =>
    i === 0
      ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="5" fill={color} /></svg>
      : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="1" y="1" width="10" height="10" rx="2" fill={color} /></svg>;

  return (
    <div className="flex flex-col gap-[16px]">
      {header}

      <Card>
        <div>
          <CardHead title={t("cmp.global")} pill={<Pill>{t(`periods.${period}`)}</Pill>} />
          <div className="px-[20px] pb-[14px] pt-[6px]">
            <div className="grid grid-cols-1 items-center gap-[14px] py-[10px] pb-[14px] min-[900px]:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]">
              {chip(a, ca, na, "a")}
              <div className="hidden text-center text-[12px] font-bold uppercase tracking-[.08em] text-tr-ink-3 min-[900px]:block rtl:tracking-normal">{t("cmp.vs")}</div>
              {chip(b, cb, nb, "b")}
            </div>
            {METRICS.map((m) => {
              const va = metricValue(m, a), vb = metricValue(m, b);
              if (va == null && vb == null) return null;
              const w = compareWinner(va, vb);
              return (
                <div key={m} role="group" aria-label={m === "pick" ? t(`cmp.metrics.pick.${pickKey}`) : t(`cmp.metrics.${m}`)}
                  className="grid grid-cols-1 items-center gap-[10px] border-t border-tr-line-2 py-[11px] min-[900px]:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] min-[900px]:gap-[14px]">
                  <div className="order-first text-start text-[13px] font-medium leading-[1.3] text-tr-ink-2 min-[900px]:order-none min-[900px]:col-start-2 min-[900px]:row-start-1 min-[900px]:text-center">
                    {m === "pick" ? t(`cmp.metrics.pick.${pickKey}`) : t(`cmp.metrics.${m}`)}
                    {w === "tie" ? <small className="block text-[11px] font-medium text-tr-ink-3">{t("cmp.tie")}</small> : null}
                  </div>
                  <div className="min-[900px]:col-start-1 min-[900px]:row-start-1">{side(va, w === "a", ca, "a")}</div>
                  <div className="min-[900px]:col-start-3 min-[900px]:row-start-1">{side(vb, w === "b", cb, "b")}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-[16px] min-[900px]:grid-cols-2">
        <Card className="flex flex-col">
          <div className="flex flex-1 flex-col">
            <CardHead title={t("cmp.weeks")} pill={<Pill>{t("cmp.nWeeks", { n: series[0].rows.length })}</Pill>} />
            <div className="flex flex-1 flex-col gap-[10px] px-[20px] pb-[18px] pt-[12px]">
              <div className="flex flex-wrap gap-[16px] text-[12.5px] text-tr-ink-2">
                <span className="inline-flex items-center gap-[7px]">{shape(0, ca)}{na}</span>
                <span className="inline-flex items-center gap-[7px]">{shape(1, cb)}{nb}</span>
                <span className="inline-flex items-center gap-[7px]">
                  <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden><line x1="0" y1="2" x2="18" y2="2" stroke="#15171A" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
                  {t("targetLabel", { target: fmtPct(locale, target) })}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4.2" fill="#fff" stroke="#7E848B" strokeWidth="1.8" /></svg>
                  {t("cmp.inProgress")}
                </span>
              </div>
              <WeeklyLines series={series} target={target} locale={locale} />
            </div>
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="flex flex-1 flex-col">
            <CardHead title={t("cmp.city")} pill={<Pill>{t("periods.90")}</Pill>} />
            <div className="flex flex-1 flex-col gap-[10px] px-[20px] pb-[18px] pt-[12px]">
              <div className="text-[12.5px] text-tr-ink-3">{t("cmp.citySub")}</div>
              {cities.length === 0 ? <p className="text-[13px] text-tr-ink-2">{t("cmp.noShared")}</p> : (
                <div role="list" className="grid grid-cols-[minmax(64px,84px)_minmax(0,1fr)] items-center gap-x-[12px] gap-y-[4px] text-[12.5px] min-[560px]:grid-cols-[minmax(74px,110px)_minmax(0,1fr)_84px]">
                  <div aria-hidden />
                  <div aria-hidden className="relative h-[16px] text-[11px] text-tr-ink-3">
                    {[0, 25, 50, 75, 100].map((v) => (
                      <span key={v} className="absolute top-0 -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: `${v}%` }}>{fmtPct(locale, v)}</span>
                    ))}
                  </div>
                  <div aria-hidden className="hidden min-[560px]:block" />
                  {cities.map((r) => {
                    const label = cityLabel(r.city, locale);
                    const lo = Math.min(r.a.rate, r.b.rate), hi = Math.max(r.a.rate, r.b.rate), near = hi - lo < 4;
                    const tip = `${label} · ${na} ${fmtPct(locale, r.a.rate)} (${fmtInt(locale, r.a.finished)}) · ${nb} ${fmtPct(locale, r.b.rate)} (${fmtInt(locale, r.b.finished)})`;
                    return (
                      <div key={r.city} role="listitem" aria-label={label} className="contents">
                        <div className="truncate font-medium text-tr-ink-1">{label}</div>
                        <div className="relative h-[30px]" title={tip}>
                          {[25, 50, 75].map((v) => <span key={v} className="absolute inset-y-0 w-px bg-tr-line-2" style={{ insetInlineStart: `${v}%` }} />)}
                          <span className="absolute -bottom-[2px] -top-[2px] w-0 border-s-[1.5px] border-dashed border-[#6B7177]" style={{ insetInlineStart: `${target}%` }} />
                          <span className="absolute top-1/2 -mt-[2px] h-[4px] rounded-[2px] bg-[#D5D8DC]" style={{ insetInlineStart: `${lo}%`, width: `${hi - lo}%` }} />
                          <span className="absolute top-1/2 h-[15px] w-[15px] -ms-[7.5px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(16,24,40,.12)]"
                            style={{ insetInlineStart: `${r.a.rate}%`, background: ca, marginTop: near ? -12 : -7.5 }} />
                          <span className="absolute top-1/2 h-[15px] w-[15px] -ms-[7.5px] rounded-[3px] border-2 border-white shadow-[0_0_0_1px_rgba(16,24,40,.12)]"
                            style={{ insetInlineStart: `${r.b.rate}%`, background: cb, marginTop: near ? -3 : -7.5 }} />
                        </div>
                        <div className="hidden whitespace-nowrap text-end text-[12px] text-tr-ink-3 min-[560px]:block">
                          <span className="me-[4px] ms-[6px] inline-block h-[8px] w-[8px] rounded-full" style={{ background: ca }} /><Num>{fmtInt(locale, r.a.finished)}</Num>
                          <span className="me-[4px] ms-[6px] inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: cb }} /><Num>{fmtInt(locale, r.b.finished)}</Num>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
