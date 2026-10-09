"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Copy, Inbox, Lightbulb, List, ScanLine } from "lucide-react";
import type { CSSProperties } from "react";
import { cityLabel } from "@/lib/carriers/scorecard/city-names";
import { fmtDays, fmtInt, fmtPct } from "@/lib/carriers/scorecard/format";
import {
  accentFor, carrierTitle, lateTone, periodRate, rateStatus, reasonsView, returnsView, share, trimLeadingEmptyWeeks, weekRows,
  type ReasonGroup,
} from "@/lib/carriers/scorecard/view-model";
import type { Scorecard, ScorecardCarrier, ScorecardPeriodDays } from "@/lib/carriers/scorecard/types";
import { WeeklyBars } from "./charts";
import { carrierShort, carrierSubtitle } from "./labels";
import { BackLink, PeriodSegment } from "./ScorecardHeader";
import { btnSm, btnSmGhost, btnSmPri, CarrierLogo, Card, CardHead, Num, Pill, RATE_TONE, StatusLine, TrendChip } from "./ui";

export type DrawerKind = "late" | "returns" | "cities" | "dormant";

export interface CarrierViewProps {
  scorecard: Scorecard;
  carrierId: string;
  locale: string;
  marketCode: string;
  period: ScorecardPeriodDays;
  onPeriodChange: (p: ScorecardPeriodDays) => void;
  onOpenDrawer: (kind: Exclude<DrawerKind, "dormant">) => void;
  onCopyLate: () => void;
  overviewHref: string;
  compareHref: string;
  returnsBenchHref: string;
}

/** One carrier: the band, then five cards — each answers one question. */
export function CarrierView(props: CarrierViewProps) {
  const { scorecard, carrierId, locale, marketCode, period, onPeriodChange, overviewHref, compareHref } = props;
  const t = useTranslations("carrierScorecard");
  const index = scorecard.carriers.findIndex((c) => c.id === carrierId);
  const card = scorecard.carriers[index];
  if (!card) return null;
  const color = accentFor(card, index);
  const title = carrierTitle(card, locale);
  const other = scorecard.carriers.find((c) => c.id !== carrierId);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-[14px]">
        <BackLink href={overviewHref} />
        <PeriodSegment period={period} onChange={onPeriodChange} />
      </div>

      <section aria-labelledby="carrier-title" style={{ "--c": color } as CSSProperties}
        className="tsc-band is-hero flex flex-wrap items-center gap-[16px] px-[26px] py-[24px]">
        <CarrierLogo logoUrl={card.logo_url} code={card.code} name={title} size={58} radius={15} />
        <div>
          <h1 id="carrier-title" className="text-[28px] font-[800] leading-[1.15] tracking-[-.028em]">{title}</h1>
          <div className="mt-[3px] text-[13px] opacity-90">
            {t("heroMeta", { sub: carrierSubtitle(card, marketCode, t), n: fmtInt(locale, card.period.sent), period: t(`periodLong.${period}`) })}
          </div>
        </div>
        {other ? (
          <div className="ms-auto flex flex-wrap gap-[8px]">
            <Link href={compareHref}
              className="inline-flex h-[36px] items-center gap-[7px] whitespace-nowrap rounded-[11px] border border-white/40 bg-white/[.16] px-[14px] text-[13px] font-bold text-white backdrop-blur-[6px] hover:bg-white/[.26]">
              <ArrowLeftRight size={15} aria-hidden />
              {t("compareWith", { name: carrierTitle(other, locale) })}
            </Link>
          </div>
        ) : null}
      </section>

      <div style={{ "--c": color } as CSSProperties} className="grid grid-cols-1 gap-[16px] min-[900px]:grid-cols-2 min-[1180px]:grid-cols-3">
        <DeliveryCard card={card} locale={locale} target={scorecard.settings.target_pct} period={period} color={color} title={title} />
        <WhyCard card={card} locale={locale} color={color} title={title} />
        <LateCard card={card} locale={locale} marketCode={marketCode} stuckDays={scorecard.settings.stuck_days}
          onOpen={() => props.onOpenDrawer("late")} onCopy={props.onCopyLate} />
        <ReturnsCard card={card} locale={locale} color={color} benchHref={props.returnsBenchHref} onOpen={() => props.onOpenDrawer("returns")} />
        <CitiesCard card={card} locale={locale} target={scorecard.settings.target_pct} onOpen={() => props.onOpenDrawer("cities")} />
      </div>
    </div>
  );
}

const big = "tsc-fig text-[36px] leading-[1.05]";
const body = "flex flex-1 flex-col gap-[10px] px-[22px] pb-[20px] pt-[12px]";
const foot = "flex flex-wrap items-center gap-[8px] border-t border-tr-line-2 px-[22px] py-[12px]";
const ttl = "mt-[4px] text-[12px] font-semibold text-tr-ink-3";

function DeliveryCard({ card, locale, target, period, color, title }: { card: ScorecardCarrier; locale: string; target: number; period: ScorecardPeriodDays; color: string; title: string }) {
  const t = useTranslations("carrierScorecard");
  const { rate, provisional } = periodRate(card.period);
  const st = rateStatus(rate, provisional, target);
  const rows = trimLeadingEmptyWeeks(weekRows(card.weeks), 6);
  return (
    <Card className="flex flex-col min-[900px]:col-span-2">
      <div className="flex flex-1 flex-col">
        <CardHead title={t("del.title")} pill={<Pill>{t(`periods.${period}`)}</Pill>} />
        <div className={body}>
          <div className="flex flex-wrap items-baseline gap-[10px]">
            <span className={big}><Num>{fmtPct(locale, rate)}</Num></span>
            <StatusLine tone={RATE_TONE[st]}>{t(`status.${st}`, { target: fmtPct(locale, target) })}</StatusLine>
            <span className="text-[12.5px]"><TrendChip period={card.period} locale={locale} periodLong={t(`periodLong.${period}`)} /></span>
          </div>
          <div className="text-[12.5px] text-tr-ink-3">
            {t("del.sub", { d: fmtInt(locale, card.period.delivered), f: fmtInt(locale, card.period.failed), m: fmtInt(locale, card.period.in_flight) })}
          </div>
          <div className={ttl}>{t("del.byWeek")}</div>
          <WeeklyBars rows={rows} color={color} target={target} big locale={locale} carrierName={title} />
        </div>
      </div>
    </Card>
  );
}

const GROUP_ORDER: ReasonGroup[] = ["client", "carrier", "us"];

function WhyCard({ card, locale, color, title }: { card: ScorecardCarrier; locale: string; color: string; title: string }) {
  const t = useTranslations("carrierScorecard");
  const groupColor: Record<ReasonGroup, string> = { client: "#475467", carrier: color, us: "#98A2B3" };
  const head = <CardHead title={t("why.title")} pill={<Pill>{t("periods.90")}</Pill>} />;
  if (!card.has_reasons) {
    return (
      <Card className="flex flex-col">
        <div className="flex flex-1 flex-col">
          {head}
          <div className={body}>
            <div className="tsc-quiet flex flex-col items-start gap-[6px] p-[14px] text-[13px] text-tr-ink-2">
              <Inbox size={18} aria-hidden className="text-tr-ink-3" />
              <b className="font-semibold text-tr-ink-1">{t("why.none", { carrier: title })}</b>
              <span>{t("why.noneSub")}</span>
            </div>
          </div>
        </div>
      </Card>
    );
  }
  const v = reasonsView(card.reasons);
  const top = v.rows.slice(0, 8);
  const max = top[0]?.n ?? 1;
  const pct = (g: ReasonGroup) => share(v.groups[g], v.total) ?? 0;
  return (
    <Card className="flex flex-col">
      <div className="flex flex-1 flex-col">
        {head}
        <div className={body}>
          {v.total === 0 ? (
            <p className="text-[13px] text-tr-ink-3">{t("why.noFailures")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-[10px]">
                <span className="tsc-fig text-[28px] leading-[1.05]"><Num>{fmtInt(locale, v.total)}</Num></span>
                <span className="text-[13px] text-tr-ink-2">{t("why.failures")}</span>
              </div>
              <div className="flex h-[10px] gap-[2px] overflow-hidden rounded-full">
                {GROUP_ORDER.filter((g) => v.groups[g]).map((g) => (
                  <b key={g} className="block h-full" style={{ width: `${pct(g)}%`, background: groupColor[g] }} title={`${t(`why.groups.${g}`)} · ${fmtPct(locale, pct(g))} — ${t(`why.groupTip.${g}`)}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-[14px] gap-y-[6px] text-[12px] text-tr-ink-2">
                {GROUP_ORDER.map((g) => (
                  <span key={g} className="inline-flex items-center gap-[6px]" title={t(`why.groupTip.${g}`)}>
                    <i className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: groupColor[g] }} />
                    {t(`why.groups.${g}`)} <b className="font-bold text-tr-ink-1"><Num>{fmtPct(locale, pct(g))}</Num></b>
                  </span>
                ))}
              </div>
              <div className="mt-[6px] grid grid-cols-[minmax(0,1fr)_minmax(60px,34%)_30px] items-center gap-x-[10px] gap-y-[7px] text-[12.5px]">
                {top.map((r) => (
                  <div key={r.cls} className="contents">
                    <div className="flex min-w-0 items-center gap-[7px] text-tr-ink-1">
                      <i className="h-[8px] w-[8px] flex-none rounded-[2px]" style={{ background: groupColor[r.group] }} />
                      <span className="truncate">{reasonLabel(r.cls, t)}</span>
                    </div>
                    <div className="relative h-[8px] overflow-hidden rounded-full bg-tr-well">
                      <b className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: groupColor[r.group] }} />
                    </div>
                    <div className="text-end font-semibold tabular-nums text-tr-ink-2"><Num>{fmtInt(locale, r.n)}</Num></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

const KNOWN_REASONS = new Set(["no_answer", "customer_cancelled", "not_needed", "not_serious", "out_of_coverage", "no_cash", "wrong_address",
  "payment_method", "refused", "wrong_item", "duplicate", "store_cancelled", "other", "none", "coordinated", "office_pickup", "in_progress"]);

function reasonLabel(cls: string, t: (k: string) => string): string {
  return t(`why.reasons.${KNOWN_REASONS.has(cls) ? cls : "other"}`);
}

function HBars({ rows, labelWidth = 96 }: { rows: { label: string; n: number; color: string; zero?: boolean }[]; labelWidth?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="grid items-center gap-x-[12px] gap-y-[7px] text-[12.5px]" style={{ gridTemplateColumns: `minmax(${labelWidth}px,auto) minmax(0,1fr) 40px` }}>
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <div className="whitespace-nowrap text-tr-ink-2">{r.label}</div>
          <div className="relative h-[12px] overflow-hidden rounded-full bg-tr-well">
            <b className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />
          </div>
          <div className={`text-end font-bold tabular-nums ${r.zero && r.n === 0 ? "text-tr-bad-ink" : "text-tr-ink-1"}`}><Num>{r.n}</Num></div>
        </div>
      ))}
    </div>
  );
}

function LateCard({
  card, locale, marketCode, stuckDays, onOpen, onCopy,
}: { card: ScorecardCarrier; locale: string; marketCode: string; stuckDays: number; onOpen: () => void; onCopy: () => void }) {
  const t = useTranslations("carrierScorecard");
  const o = card.open;
  const p = card.period;
  const rows = [
    { label: t("late.buckets.notPicked"), n: o.not_picked, color: o.not_picked ? "var(--tr-warn)" : "var(--tr-bar)" },
    { label: t("late.buckets.b0_2"), n: o.b0_2, color: "var(--tr-bar)" },
    { label: t("late.buckets.b3_4"), n: o.b3_4, color: "var(--tr-warn)" },
    { label: t("late.buckets.b5_9"), n: o.b5_9, color: "var(--tr-bad)" },
    { label: t("late.buckets.b10p"), n: o.b10p, color: "var(--tr-bad)" },
  ];
  const pickKey = marketCode === "tn" ? "tn" : "ly";
  return (
    <Card className="flex flex-col">
      <div className="flex flex-1 flex-col">
        <CardHead title={t("late.title")} pill={<Pill live>{t("now")}</Pill>} />
        <div className={body}>
          <div className="flex flex-wrap items-baseline gap-[10px]">
            <span className={big}><Num>{fmtInt(locale, o.late)}</Num></span>
            <span className="text-[13px] text-tr-ink-2">{t("onRoad", { n: fmtInt(locale, o.total) })}</span>
          </div>
          <StatusLine tone={lateTone(o)} title={t("late.stuckDef", { days: stuckDays })}>
            {o.late || o.stuck ? t("stuck", { n: o.stuck }) : t("noLate")}
          </StatusLine>
          <div className={ttl}>{t("late.sincePick")}</div>
          <HBars rows={rows} />
          {marketCode === "ly" ? (
            <div className="tsc-note flex items-start gap-[8px] px-[12px] py-[10px] text-[12.5px] font-medium text-tr-ink-2">
              <Lightbulb size={15} aria-hidden className="mt-[1px] flex-none text-tr-warn-ink" />
              <span>{t("late.drag")}</span>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 border-t border-tr-line-2 min-[560px]:grid-cols-3 [&>*+*]:max-[559px]:border-t min-[560px]:[&>*+*]:border-s">
          <Kv label={t("late.deliveredIn")} value={p.median_days == null ? "—" : t("late.days", { n: fmtDays(locale, p.median_days) })} />
          <Kv label={t(`late.pickFast.${pickKey}`)} value={fmtPct(locale, share(p.picked_fast, p.picked))} />
          <Kv label={t("late.firstAttempt")}
            value={p.first_attempt == null ? <span className="text-[12.5px] font-normal text-tr-ink-3">{t("cmp.na")}</span> : fmtPct(locale, share(p.first_attempt, p.delivered))} />
        </div>
        <div className={foot}>
          <button type="button" className={btnSm} onClick={onOpen} disabled={o.late === 0}>
            <List size={15} aria-hidden />{t("late.seeN", { n: o.late })}
          </button>
          <button type="button" className={btnSmGhost} onClick={onCopy} disabled={o.late === 0}>
            <Copy size={15} aria-hidden />{t("late.copyFor", { carrier: carrierShort(card, locale, t) })}
          </button>
        </div>
      </div>
    </Card>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px] border-tr-line-2 px-[16px] py-[12px]">
      <span className="text-[11.5px] leading-[1.3] text-tr-ink-3">{label}</span>
      <b className="text-[17px] font-[800] tracking-[-.02em] text-tr-ink-1">{typeof value === "string" ? <Num>{value}</Num> : value}</b>
    </div>
  );
}

function ReturnsCard({ card, locale, color, benchHref, onOpen }: { card: ScorecardCarrier; locale: string; color: string; benchHref: string; onOpen: () => void }) {
  const t = useTranslations("carrierScorecard");
  const r = card.returns;
  const v = returnsView(r);
  const who = carrierShort(card, locale, t);
  const AGE_COLORS = ["var(--tr-bar)", "var(--tr-warn)", "var(--tr-bad)"];
  const AGE_KEYS = ["lt7", "d7_30", "d30p"] as const;
  return (
    <Card className="flex flex-col">
      <div className="flex flex-1 flex-col">
        <CardHead title={t("ret.title")} pill={<Pill live>{t("now")}</Pill>} />
        <div className={body}>
          <div className="flex flex-wrap items-baseline gap-[10px]">
            <span className={big}><Num>{fmtInt(locale, v.unscanned)}</Num></span>
            <span className="text-[13px] text-tr-ink-2">{t("ret.toScan")}</span>
          </div>
          <StatusLine tone={v.tone} title={t("older7Tip")}>{t("older7", { n: v.olderThan7 })}</StatusLine>
          <HBars labelWidth={108} rows={[
            { label: t("ret.failed"), n: r.failed, color: "var(--tr-bar)" },
            { label: t("ret.handedBack", { carrier: who }), n: r.handed_back, color },
            { label: t("ret.scanned"), n: r.scanned, color: "var(--tr-ok)", zero: true },
          ]} />
          {v.unscanned ? (
            <>
              <div className={ttl}>{t("ret.age")}</div>
              <div className="flex h-[10px] gap-[2px] overflow-hidden rounded-full">
                {v.ages.map((n, i) => (n ? <b key={i} className="block h-full" style={{ width: `${(n / v.unscanned) * 100}%`, background: AGE_COLORS[i] }} title={`${t(`ret.ageBuckets.${AGE_KEYS[i]}`)} · ${n}`} /> : null))}
              </div>
              <div className="flex flex-wrap gap-x-[14px] gap-y-[6px] text-[12px] text-tr-ink-2">
                {v.ages.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-[6px]">
                    <i className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: AGE_COLORS[i] }} />
                    {t(`ret.ageBuckets.${AGE_KEYS[i]}`)} <b className="font-bold text-tr-ink-1"><Num>{fmtInt(locale, n)}</Num></b>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="grid grid-cols-2 border-t border-tr-line-2 [&>*+*]:border-s">
          <Kv label={t("ret.out", { carrier: who })} value={
            <span className="inline-flex flex-wrap items-center gap-[6px]">
              <Num>{fmtInt(locale, r.out)}</Num>
              {r.out_late ? <StatusLine tone="bad" className="text-[11.5px]">{t("ret.outLate", { n: fmtInt(locale, r.out_late) })}</StatusLine> : null}
            </span>
          } />
          <Kv label={t("ret.median")} value={r.median_days == null ? "—" : t("late.days", { n: fmtDays(locale, r.median_days) })} />
        </div>
        <div className={foot}>
          <Link href={benchHref} className={btnSmPri}><ScanLine size={15} aria-hidden />{t("ret.openBench")}</Link>
          <button type="button" className={btnSm} onClick={onOpen} disabled={v.unscanned === 0}><List size={15} aria-hidden />{t("ret.seeList")}</button>
        </div>
      </div>
    </Card>
  );
}

function CitiesCard({ card, locale, target, onOpen }: { card: ScorecardCarrier; locale: string; target: number; onOpen: () => void }) {
  const t = useTranslations("carrierScorecard");
  const rows = card.cities.slice(0, 6).map((c) => {
    const fin = c.delivered + c.failed;
    return { ...c, fin, rate: share(c.delivered, fin) ?? 0, label: cityLabel(c.city, locale) };
  });
  return (
    <Card className="flex flex-col">
      <div className="flex flex-1 flex-col">
        <CardHead title={t("city.title")} pill={<Pill>{t("periods.90")}</Pill>} />
        <div className={body}>
          {rows.length === 0 ? <p className="text-[13px] text-tr-ink-3">{t("city.none")}</p> : (
            <>
              <div className="grid grid-cols-[minmax(70px,104px)_minmax(0,1fr)_40px_64px] items-center gap-x-[10px] gap-y-[9px] text-[12.5px]">
                {rows.map((c) => (
                  <div key={c.city} className="contents">
                    <div className="truncate text-tr-ink-1" title={c.label}>{c.label}</div>
                    <div className="relative h-[10px] rounded-full bg-[color-mix(in_srgb,var(--c)_12%,transparent)]"
                      title={`${c.label} · ${fmtPct(locale, c.rate)} · ${t("city.colis", { n: fmtInt(locale, c.fin) })}${c.median_days != null ? ` · ${t("late.deliveredIn")} ${t("late.days", { n: fmtDays(locale, c.median_days) })}` : ""}`}>
                      <b className="tsc-fill absolute inset-y-0 start-0 rounded-full" style={{ width: `${c.rate}%` }} />
                      <span className="absolute -bottom-[4px] -top-[4px] w-[2px] rounded-[2px] bg-tr-ink-1 opacity-75" style={{ insetInlineStart: `calc(${target}% - 1px)` }} />
                    </div>
                    <div className="text-end font-bold tabular-nums text-tr-ink-1"><Num>{fmtPct(locale, c.rate)}</Num></div>
                    <div className="whitespace-nowrap text-end text-tr-ink-3">{t("city.colis", { n: fmtInt(locale, c.fin) })}</div>
                  </div>
                ))}
              </div>
              <div className="inline-flex items-center gap-[7px] text-[12.5px] text-tr-ink-3">
                <span className="h-[12px] w-[2px] rounded-[2px] bg-tr-ink-1 opacity-75" />
                {t("targetLabel", { target: fmtPct(locale, target) })}
              </div>
            </>
          )}
        </div>
        <div className={foot}>
          <button type="button" className={btnSm} onClick={onOpen} disabled={card.cities.length === 0}>
            <List size={15} aria-hidden />{t("city.seeAll", { n: card.cities.length })}
          </button>
        </div>
      </div>
    </Card>
  );
}
