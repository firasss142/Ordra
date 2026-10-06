"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Archive, ArrowRight, Truck } from "lucide-react";
import { fmtDate, fmtInt, fmtMonth, fmtPct } from "@/lib/carriers/scorecard/format";
import {
  accentFor, carrierTitle, deliveryRate, isProvisional, lateTone, periodRate, rateStatus, rateTrend, returnsView, weekRows,
} from "@/lib/carriers/scorecard/view-model";
import type { Scorecard, ScorecardCarrier, ScorecardPeriodDays } from "@/lib/carriers/scorecard/types";
import { WeeklyBars } from "./charts";
import { carrierShort, carrierSubtitle } from "./labels";
import { CompareLink, PeriodSegment, ScorecardCrumb, ScorecardSub } from "./ScorecardHeader";
import { btn, btnSmGhost, CarrierLogo, Card, Num, NowTag, RATE_TONE, SectionLabel, StatusLine, TrendChip } from "./ui";
import type { CSSProperties } from "react";

export interface OverviewViewProps {
  scorecard: Scorecard;
  locale: string;
  marketCode: string;
  period: ScorecardPeriodDays;
  now: Date;
  onPeriodChange: (p: ScorecardPeriodDays) => void;
  onOpenDormant: (carrierId: string) => void;
  carrierHref: (carrierId: string) => string;
  compareHref: string;
}

/** Vue d'ensemble → En bref: the market in four numbers, then one card per carrier account. */
export function OverviewView(props: OverviewViewProps) {
  const { scorecard, locale, marketCode, period, now, onPeriodChange, onOpenDormant, carrierHref, compareHref } = props;
  const t = useTranslations("carrierScorecard");
  const cards = scorecard.carriers;
  const nothingSent = cards.every((c) => c.period.sent === 0);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="mb-[6px] flex min-h-[44px] flex-wrap items-end justify-between gap-[14px]">
        <div>
          <ScorecardCrumb />
          <h1 className="tsc-h1">{t("title")}</h1>
          <ScorecardSub marketCode={marketCode} locale={locale} generatedAt={scorecard.generated_at} days={scorecard.days}
            lastSyncAt={scorecard.last_sync_at} now={now} withSync />
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <PeriodSegment period={period} onChange={onPeriodChange} />
          <CompareLink href={compareHref} />
        </div>
      </div>

      {cards.length === 0 || nothingSent ? (
        <EmptyState marketCode={marketCode} period={period} onPeriodChange={onPeriodChange} cards={cards} locale={locale} noCarrier={cards.length === 0} />
      ) : (
        <>
          <SectionLabel>{t("secOverview")}</SectionLabel>
          <OverviewStrip scorecard={scorecard} locale={locale} />
          <SectionLabel>{t("secBrief")}</SectionLabel>
          <div className="grid grid-cols-1 gap-[16px] min-[900px]:grid-cols-2">
            {cards.map((c, i) => (
              <BriefCard key={c.id} card={c} index={i} locale={locale} marketCode={marketCode} target={scorecard.settings.target_pct}
                period={period} href={carrierHref(c.id)} />
            ))}
          </div>
        </>
      )}

      {scorecard.dormant.length ? (
        <div role="region" aria-label={t("dormantLabel")} className="flex flex-col gap-[8px]">
          {scorecard.dormant.map((d) => (
            <div key={d.id} className="tsc-dormant flex items-center gap-[10px] px-[16px] py-[12px] text-[13px] text-tr-ink-2">
              <Archive size={16} aria-hidden className="text-tr-ink-3" />
              <span>
                {t("dormant", { name: d.name, month: d.last_upload_at ? fmtMonth(locale, d.last_upload_at) : "—", n: d.open })}
              </span>
              <button type="button" className={`${btnSmGhost} ms-auto`} onClick={() => onOpenDormant(d.id)}>
                {t("dormantBtn")}
                <ArrowRight size={15} aria-hidden className="rtl:-scale-x-100" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OverviewStrip({ scorecard, locale }: { scorecard: Scorecard; locale: string }) {
  const t = useTranslations("carrierScorecard");
  const cs = scorecard.carriers;
  const sum = (f: (c: ScorecardCarrier) => number) => cs.reduce((a, c) => a + f(c), 0);
  const sent = sum((c) => c.period.sent), inFlight = sum((c) => c.period.in_flight);
  const rate = deliveryRate(sum((c) => c.period.delivered), sum((c) => c.period.failed));
  const st = rateStatus(rate, isProvisional(sent, inFlight), scorecard.settings.target_pct);
  const late = sum((c) => c.open.late), stuck = sum((c) => c.open.stuck), flight = sum((c) => c.open.total);
  const rv = cs.map((c) => returnsView(c.returns));
  const unscanned = rv.reduce((a, r) => a + r.unscanned, 0), older = rv.reduce((a, r) => a + r.olderThan7, 0);
  const target = fmtPct(locale, scorecard.settings.target_pct);

  const cell = "flex min-w-0 flex-col gap-[6px] border-tr-line-2 px-[22px] py-[20px]";
  const lb = "flex items-center text-[13px] font-semibold text-tr-ink-2";
  const v = "tsc-fig text-[32px] leading-[1.1]";
  const sb = "flex flex-wrap items-center gap-[6px] text-[12.5px] text-tr-ink-3";
  return (
    <Card label={t("secOverview")}>
      <div className="grid grid-cols-1 min-[560px]:grid-cols-2 min-[900px]:grid-cols-4 [&>*+*]:max-[559px]:border-t min-[560px]:max-[899px]:[&>*:nth-child(even)]:border-s min-[560px]:max-[899px]:[&>*:nth-child(n+3)]:border-t min-[900px]:[&>*+*]:border-s">
        <div className={cell}>
          <span className={lb}>{t("kSent")}</span>
          <span className={v}><Num>{fmtInt(locale, sent)}</Num></span>
          <span className={sb}>{t("kSentSub", { n: fmtInt(locale, inFlight) })}</span>
        </div>
        <div className={cell}>
          <span className={lb}>{t("kRate")}</span>
          <span className={v}><Num>{fmtPct(locale, rate)}</Num></span>
          <span className={sb}><StatusLine tone={RATE_TONE[st]}>{t(`status.${st}`, { target })}</StatusLine></span>
        </div>
        <div className={cell}>
          <span className={lb}>{t("kLate")}<NowTag /></span>
          <span className={v}><Num>{fmtInt(locale, late)}</Num></span>
          <span className={sb}>
            <StatusLine tone={lateTone({ late, stuck })}>{late || stuck ? t("stuck", { n: stuck }) : t("noLate")}</StatusLine>
            {t("onRoad", { n: fmtInt(locale, flight) })}
          </span>
        </div>
        <div className={cell}>
          <span className={lb}>{t("kRet")}<NowTag /></span>
          <span className={v}><Num>{fmtInt(locale, unscanned)}</Num></span>
          <span className={sb}>
            <StatusLine tone={older > 20 ? "bad" : older > 0 ? "warn" : "ok"} title={t("older7Tip")}>{t("older7", { n: older })}</StatusLine>
          </span>
        </div>
      </div>
    </Card>
  );
}

function BriefCard({
  card, index, locale, marketCode, target, period, href,
}: { card: ScorecardCarrier; index: number; locale: string; marketCode: string; target: number; period: ScorecardPeriodDays; href: string }) {
  const t = useTranslations("carrierScorecard");
  const color = accentFor(card, index);
  const title = carrierTitle(card, locale);
  const { rate, provisional } = periodRate(card.period);
  const st = rateStatus(rate, provisional, target);
  const rv = returnsView(card.returns);
  const weeks = weekRows(card.weeks).slice(-8);
  const trend = <TrendChip period={card.period} locale={locale} periodLong={t(`periodLong.${period}`)} />;
  const opened = card.first_upload_at && Date.parse(card.first_upload_at) > Date.parse(card.weeks[card.weeks.length - 8]?.week ?? "1970-01-01")
    ? t("opened", { date: fmtDate(locale, card.first_upload_at) }) : "";

  const pl = "flex min-w-0 flex-col gap-[5px] border-[color-mix(in_srgb,var(--c)_14%,transparent)] px-[18px] py-[16px]";
  const lb = "flex items-center text-[12.5px] font-semibold text-tr-ink-2";
  const v = "tsc-fig text-[32px] leading-[1.1]";
  const cx = "flex flex-wrap items-center gap-[5px] text-[12px] text-tr-ink-3";
  return (
    <Link href={href} className="group block rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <article
        aria-labelledby={`brief-${card.id}`}
        style={{ "--c": color } as CSSProperties}
        className="tsc-entity flex flex-col"
      >
        <div className="tsc-band flex min-h-[80px] items-center gap-[13px] px-[20px] py-[16px]">
          <CarrierLogo logoUrl={card.logo_url} code={card.code} name={title} />
          <div className="flex min-w-0 flex-col">
            <b id={`brief-${card.id}`} className="text-[20px] font-[800] leading-[1.2] tracking-[-.02em]">{title}</b>
            <span className="text-[12.5px] opacity-[.86]">{carrierSubtitle(card, marketCode, t)}</span>
          </div>
          <div className="ms-auto hidden text-end leading-[1.2] min-[560px]:block">
            <b className="block text-[20px] font-[800] tracking-[-.02em]"><Num>{fmtInt(locale, card.period.sent)}</Num></b>
            <span className="text-[12px] opacity-[.86]">{t("colisPeriod", { period: t(`periods.${period}`) })}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 min-[560px]:grid-cols-3 [&>*+*]:max-[559px]:border-t min-[560px]:[&>*+*]:border-s">
          <div className={pl}>
            <span className={lb}>{t("pDel")}</span>
            <span className={v}><Num>{fmtPct(locale, rate)}</Num></span>
            <div className="relative mb-[2px] mt-[4px] h-[7px] rounded-full bg-[color-mix(in_srgb,var(--c)_12%,transparent)]">
              <b className="tsc-fill absolute inset-y-0 start-0 rounded-full" style={{ width: `${Math.min(100, rate ?? 0)}%` }} />
              <span className="absolute -bottom-[4px] -top-[4px] w-[2px] rounded-[2px] bg-tr-ink-1" style={{ insetInlineStart: `calc(${target}% - 1px)` }}
                title={t("targetIs", { target: fmtPct(locale, target) })} />
            </div>
            <StatusLine tone={RATE_TONE[st]} className="text-[12px]">{t(`statusShort.${st}`)}</StatusLine>
            <span className={cx}>{t("targetIs", { target: fmtPct(locale, target) })}{rateTrend(card.period) ? <>{" · "}{trend}</> : null}</span>
          </div>
          <div className={pl}>
            <span className={lb}>{t("pLate")}</span>
            <span className={v}><Num>{fmtInt(locale, card.open.late)}</Num></span>
            <StatusLine tone={lateTone(card.open)} className="text-[12px]">
              {card.open.late || card.open.stuck ? t("stuck", { n: card.open.stuck }) : t("noLate")}
            </StatusLine>
            <span className={cx}>{t("onRoad", { n: fmtInt(locale, card.open.total) })}</span>
          </div>
          <div className={pl}>
            <span className={lb}>{t("pRet")}</span>
            <span className={v}><Num>{fmtInt(locale, rv.unscanned)}</Num></span>
            <StatusLine tone={rv.tone} className="text-[12px]" title={t("older7Tip")}>{t("older7", { n: rv.olderThan7 })}</StatusLine>
            <span className={cx}>{t("retBy", { carrier: carrierShort(card, locale, t) })}</span>
          </div>
        </div>

        <div className="border-t border-[color-mix(in_srgb,var(--c)_14%,transparent)] px-[20px] pb-[6px] pt-[14px]">
          <div className="mb-[2px] text-[12px] font-semibold text-tr-ink-3">{t("weeks8")}</div>
          <WeeklyBars rows={weeks} color={color} target={target} locale={locale} carrierName={title} />
        </div>

        <div className="flex items-center justify-between gap-[10px] border-t border-[color-mix(in_srgb,var(--c)_14%,transparent)] px-[20px] py-[12px] text-[12.5px] text-tr-ink-3">
          <span>{opened}</span>
          <span className="tsc-open inline-flex items-center gap-[5px] text-[13px] font-bold">
            {t("open")}
            <ArrowRight size={15} aria-hidden className="rtl:-scale-x-100" />
          </span>
        </div>
      </article>
    </Link>
  );
}

function EmptyState({
  marketCode, period, onPeriodChange, cards, locale, noCarrier,
}: { marketCode: string; period: ScorecardPeriodDays; onPeriodChange: (p: ScorecardPeriodDays) => void; cards: ScorecardCarrier[]; locale: string; noCarrier: boolean }) {
  const t = useTranslations("carrierScorecard");
  return (
    <>
      <Card>
        <div className="flex flex-col items-center gap-[8px] px-[24px] py-[44px] text-center text-tr-ink-2">
          <span className="mb-[4px] grid h-[44px] w-[44px] place-items-center rounded-[13px] bg-tr-well text-tr-ink-3"><Truck size={20} aria-hidden /></span>
          <h3 className="text-[17px] font-[800] tracking-[-.015em] text-tr-ink-1">{t("empty.title")}</h3>
          <p className="max-w-[460px] text-[13.5px]">
            {noCarrier ? t("empty.noCarrier") : marketCode === "ly" || marketCode === "tn" ? t(`empty.${marketCode}`) : t("empty.other")}
          </p>
          {period !== 90 && !noCarrier ? (
            <button type="button" className={`${btn} mt-[4px]`} onClick={() => onPeriodChange(90)}>
              {t("empty.see90")}
            </button>
          ) : null}
        </div>
      </Card>
      {cards.length ? (
        <div className="grid grid-cols-1 gap-[16px] min-[900px]:grid-cols-2">
          {cards.map((c, i) => (
            <article key={c.id} style={{ "--c": accentFor(c, i) } as CSSProperties} className="tsc-entity is-idle">
              <div className="tsc-band flex min-h-[80px] items-center gap-[13px] px-[20px] py-[16px]">
                <CarrierLogo logoUrl={c.logo_url} code={c.code} name={carrierTitle(c, locale)} />
                <div className="flex min-w-0 flex-col">
                  <b className="text-[20px] font-[650] leading-[1.2]">{carrierTitle(c, locale)}</b>
                  <span className="text-[12.5px] opacity-[.86]">{carrierSubtitle(c, marketCode, t)}</span>
                </div>
              </div>
              <p className="px-[24px] py-[26px] text-center text-[13.5px] text-tr-ink-2">{t("empty.card")}</p>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}
