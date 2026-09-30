"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, ChevronDown, Package, Target, Truck, Wallet } from "lucide-react";
import type {
  AgentStatement,
  LostReason,
  StatementCredit,
  StatementStage,
} from "@/lib/commissions/types";
import { LOST_REASONS } from "@/lib/commissions/types";
import { fmtCommission } from "@/lib/commissions/view-models";

/**
 * « Mes commissions » v2 — from prototypes/agent-commissions-v2.html (approved 2026-09-30,
 * plans/agent-commissions-v2.md). One rule: every number at the top is a tab below whose
 * rows add up to it. Owed = earned − received, said as an equation; the unpaid tab sums
 * to the owed figure; paid orders sit under the payout that settled them (FIFO, computed
 * in get_my_commission_statement). Read-only — the manager records payments.
 */

type Tab = "unpaid" | "way" | "paid" | "lost";
const PAGE = 30;
const STUCK_DAYS = 7;

/** Flat tint + ink + dot, one hue per meaning (agent-shell tag rule, 2026-09-18). */
const STAGE_TONE: Record<StatementStage, { tag: string; dot: string }> = {
  delayed: { tag: "bg-hue-amber-fill-soft text-hue-amber-ink", dot: "bg-hue-amber-edge" },
  out: { tag: "bg-hue-green-fill-soft text-hue-green-ink", dot: "bg-hue-green-edge" },
  with_carrier: { tag: "bg-hue-teal-fill-soft text-hue-teal-ink", dot: "bg-hue-teal-edge" },
  awaiting_scan: { tag: "bg-hue-neutral-fill-soft text-hue-neutral-ink", dot: "bg-hue-neutral-edge" },
  returning: { tag: "bg-hue-violet-fill-soft text-hue-violet-ink", dot: "bg-hue-violet-edge" },
};
const LOST_TONE: Record<LostReason, { tag: string; dot: string }> = {
  carrier_cancelled: { tag: "bg-hue-red-fill-soft text-hue-red-ink", dot: "bg-hue-red-edge" },
  returned: { tag: "bg-hue-red-fill-soft text-hue-red-ink", dot: "bg-hue-red-edge" },
  rejected: { tag: "bg-hue-violet-fill-soft text-hue-violet-ink", dot: "bg-hue-violet-edge" },
  cancelled: { tag: "bg-hue-neutral-fill-soft text-hue-neutral-ink", dot: "bg-hue-neutral-edge" },
  before_activation: { tag: "bg-hue-neutral-fill-soft text-hue-neutral-ink", dot: "bg-hue-neutral-edge" },
  commission_off: { tag: "bg-hue-neutral-fill-soft text-hue-neutral-ink", dot: "bg-hue-neutral-edge" },
  corrected: { tag: "bg-hue-neutral-fill-soft text-hue-neutral-ink", dot: "bg-hue-neutral-edge" },
};
const ROAD_STAGES: StatementStage[] = ["awaiting_scan", "with_carrier", "out", "delayed"];

interface Props {
  me: AgentStatement;
  marketCode: string;
  locale: string;
  tz: string;
  /** widen the window (older payouts and not-counted orders) */
  onMore: () => void;
}

export function AgentCommissionsView({ me, marketCode, locale, tz, onMore }: Props) {
  const t = useTranslations("agentCommissions");
  const [tab, setTab] = useState<Tab>("unpaid");
  const [lostFilter, setLostFilter] = useState<LostReason | "all">("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [shown, setShown] = useState(PAGE);

  const f = useMemo(() => {
    const dayFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: tz });
    const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz });
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
    const keyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz });
    const localDayFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    return {
      at: (iso: string) => dayFmt.format(new Date(iso)),
      weekday: (iso: string) => weekdayFmt.format(new Date(iso)),
      time: (iso: string) => timeFmt.format(new Date(iso)),
      key: (iso: string | Date) => keyFmt.format(typeof iso === "string" ? new Date(iso) : iso),
      /** a market-local calendar date ("2026-09-12") */
      day: (d: string) => localDayFmt.format(new Date(`${d}T12:00:00Z`)),
      pct: (r: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(r),
    };
  }, [locale, tz]);

  const money = (n: number, signed = false) => fmtCommission(n, marketCode, { signed });
  const b = (c: ReactNode) => <b className="font-bold text-agent-on-surface">{c}</b>;
  const today = f.key(new Date());

  const lostRows = useMemo(
    () => (lostFilter === "all" ? me.lost.rows : me.lost.rows.filter((r) => r.reason === lostFilter)),
    [me.lost.rows, lostFilter],
  );

  const never =
    !me.enabled && !me.activated_on && me.owed === 0 &&
    me.unpaid.rows.length === 0 && me.paid_orders.payouts.length === 0;
  if (never) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-10 text-center">
        <p className="text-[15px] font-semibold text-agent-on-surface">{t("disabledTitle")}</p>
        <p className="mt-1 text-[13px] text-agent-ink-3">{t("disabledHint")}</p>
      </div>
    );
  }

  const neg = me.owed < 0;
  const delivered = me.paid_orders.count + me.unpaid.count;
  const perTen = me.delivery_rate === null ? null : Math.round(me.delivery_rate * 10);
  const oldestUnpaid = me.unpaid.rows[me.unpaid.rows.length - 1];
  const newestUnpaid = me.unpaid.rows[0];
  const canWiden = me.paid_orders.payouts.some((p) => p.rows_omitted) || (me.activated_on !== null && me.since > me.activated_on);
  const switchTab = (next: Tab) => { setTab(next); setShown(PAGE); };

  /* ── rate line ─────────────────────────────────────────────────────────── */
  let rateNote: ReactNode = null;
  if (!me.enabled && me.rate.off_since) rateNote = t("rateOff", { date: f.day(me.rate.off_since) });
  else if (me.rate.previous_amount !== null && me.rate.effective_from) {
    rateNote = (
      <>
        <span className="me-1.5 inline-flex rounded-pill bg-hue-green-fill-soft px-2 text-[11.5px] font-semibold text-hue-green-ink">
          {me.rate.effective_from === today ? t("rateToday") : t("rateSince", { date: f.day(me.rate.effective_from) })}
        </span>
        {t("ratePrevious", { amount: money(me.rate.previous_amount) })}
      </>
    );
  }

  /* ── the hero sentence ─────────────────────────────────────────────────── */
  const heroSub = neg
    ? t.rich("negative", { amount: money(-me.owed), b })
    : me.unpaid.count > 0
      ? (
        <>
          {t.rich("owedFor", { n: me.unpaid.count, b })}
          {oldestUnpaid && newestUnpaid && ` · ${t("owedRange", { from: f.at(oldestUnpaid.at), to: f.at(newestUnpaid.at) })}`}
        </>
      )
      : delivered > 0 ? t("owedNone") : t("empty.first");

  const paidFlex = Math.min(me.paid, me.earned);
  const lp = me.last_payout;

  return (
    <div className="mx-auto max-w-[800px] px-5 pb-16 pt-5 max-sm:px-3.5 max-sm:pt-4">
      <div className="mb-3.5 flex items-end justify-between gap-3">
        <h1 className="m-0 text-[22px] font-extrabold text-agent-on-surface">{t("title")}</h1>
        {me.rate.amount !== null && (
          <div data-testid="commission-rate" className="text-end text-[13px] leading-snug text-agent-on-surface-variant">
            <div>{t.rich("rate", { amount: money(me.rate.amount), b })}</div>
            {rateNote && <small className="block text-[12px] text-agent-ink-3">{rateNote}</small>}
          </div>
        )}
      </div>

      {!me.enabled && me.rate.off_since && (
        <div role="status" className="mb-3 flex items-start gap-2.5 rounded-xl bg-hue-amber-fill-soft px-3.5 py-3 text-[13px] text-hue-amber-ink">
          <AlertTriangle size={17} aria-hidden="true" className="mt-px shrink-0" />
          <span>{t("offBanner", { date: f.day(me.rate.off_since) })}</span>
        </div>
      )}

      {/* ── The one number, and the equation that proves it ─────────────── */}
      <section data-testid="commission-hero" className="rounded-2xl border border-agent-outline-variant bg-agent-surface">
        <div className="px-[22px] pt-5 max-sm:px-4">
          <div className="text-[13px] text-agent-on-surface-variant">{t("owedNow")}</div>
          <div className={`mt-0.5 text-[46px] font-extrabold leading-[1.05] tabular-nums max-sm:text-[40px] ${neg ? "text-agent-error" : "text-agent-on-surface"}`}>
            {money(me.owed)}
          </div>
          <p className="m-0 mt-1.5 text-[13.5px] text-agent-on-surface-variant">{heroSub}</p>
          <div className="mt-4 flex h-3 gap-[3px]" aria-hidden="true">
            {me.earned === 0 && me.paid === 0 ? (
              <i className="h-full flex-1 rounded-pill bg-agent-surface-low" />
            ) : (
              <>
                {paidFlex > 0 && <i className="h-full min-w-1 rounded-pill bg-hue-green-edge-soft" style={{ flex: paidFlex }} />}
                {me.owed > 0 && <i className="h-full min-w-1 rounded-pill bg-agent-primary" style={{ flex: me.owed }} />}
              </>
            )}
          </div>
        </div>
        <div data-testid="commission-equation" className="mt-4 grid grid-cols-[1fr_24px_1fr_24px_1fr] border-t border-agent-outline-variant max-sm:grid-cols-[1fr_14px_1fr_14px_1fr]">
          <EqCell label={t("eq.earned")} value={money(me.earned)} sub={t("eq.earnedSub", { n: delivered, date: f.day(me.activated_on ?? me.since) })} />
          <EqOp>−</EqOp>
          <EqCell dot="bg-hue-green-edge-soft" label={t("eq.paid")} value={money(me.paid)} sub={t("eq.paidSub", { n: me.paid_orders.count, k: me.paid_orders.payouts.length })} />
          <EqOp>=</EqOp>
          <EqCell
            tone={neg ? "neg" : "pos"}
            dot={neg ? "bg-agent-error" : "bg-agent-primary"}
            label={neg ? t("eq.over") : t("eq.left")}
            value={money(Math.abs(me.owed))}
            sub={t("eq.leftSub", { n: me.unpaid.count })}
          />
        </div>
        <div className="flex items-center gap-2 border-t border-agent-outline-variant px-[22px] py-2.5 text-[12.5px] text-agent-on-surface-variant max-sm:px-4">
          <Wallet size={16} aria-hidden="true" className="shrink-0 text-agent-ink-3" />
          <span>
            {lp
              ? t.rich("lastPayout", { date: f.at(lp.at), amount: money(lp.amount), method: lp.method ? t(`method.${lp.method}`) : "", b })
              : t("noPayout")}
          </span>
        </div>
      </section>

      {/* ── What is coming, and how much of it usually arrives ──────────── */}
      <div className="mt-3.5 grid grid-cols-2 gap-3.5 max-sm:grid-cols-1">
        <section data-testid="commission-way" className="rounded-2xl border border-agent-outline-variant bg-agent-surface px-[18px] py-4">
          <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-agent-on-surface-variant">
            <Truck size={16} aria-hidden="true" className="text-agent-ink-3" />{t("way.title")}
          </h2>
          <div className="mt-1 text-[26px] font-extrabold leading-tight text-agent-on-surface">{t("way.count", { n: me.way.count })}</div>
          <div className="text-[13px] text-agent-on-surface-variant">
            {me.enabled ? t.rich("way.est", { amount: money(me.way.est), b }) : t("way.off")}
          </div>
          {me.enabled && perTen !== null && me.way.est_likely !== null && me.way.count > 0 && (
            <div className="mt-0.5 text-[12px] text-agent-ink-3">{t("way.likely", { k: perTen, amount: money(me.way.est_likely) })}</div>
          )}
          <div className="mt-3 grid gap-0.5">
            {[...ROAD_STAGES, ...(me.way.stages.returning > 0 ? (["returning"] as StatementStage[]) : [])].map((s) => {
              const late = s === "delayed" && me.way.stages.delayed > 0;
              return (
                <div key={s} className={`flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13px] ${late ? "bg-hue-amber-fill-soft text-hue-amber-ink" : "text-agent-on-surface-variant"}`}>
                  <i aria-hidden="true" className={`h-2 w-2 rounded-full ${STAGE_TONE[s].dot}`} />
                  <span>{t(`way.stages.${s}`)}</span>
                  <span className={`ms-auto font-bold tabular-nums ${late ? "" : "text-agent-on-surface"}`}>{me.way.stages[s]}</span>
                </div>
              );
            })}
          </div>
          {me.way.stages.delayed > 0 && (
            <Link href={`/${locale}/delivery`} className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-lg border border-agent-outline px-3 text-[13px] font-semibold text-agent-on-surface hover:bg-agent-surface-low">
              {t("way.lateCta")}
              <ArrowRight size={15} aria-hidden="true" className="rtl:-scale-x-100" />
            </Link>
          )}
          {me.enabled && me.way.count > 0 && me.rate.amount !== null && (
            <div className="mt-2.5 text-[12px] text-agent-ink-3">{t("way.fine", { rate: money(me.rate.amount) })}</div>
          )}
        </section>

        <section data-testid="commission-delivery-rate" className="rounded-2xl border border-agent-outline-variant bg-agent-surface px-[18px] py-4">
          <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-agent-on-surface-variant">
            <Target size={16} aria-hidden="true" className="text-agent-ink-3" />{t("rateCard.title")}
          </h2>
          {me.delivery_rate === null || perTen === null ? (
            <p className="m-0 mt-2 text-[12.5px] text-agent-ink-3">{t("rateCard.empty")}</p>
          ) : (
            <>
              <div className="mt-1 text-[30px] font-extrabold leading-tight tabular-nums text-agent-on-surface">{f.pct(me.delivery_rate)}</div>
              <div className="text-[13px] text-agent-on-surface-variant">{t("rateCard.say", { k: perTen })}</div>
              <div className="mt-3.5 text-[12px] text-agent-ink-3">
                {t("rateCard.funnel", { n: me.funnel.confirmed, date: f.day(me.since) })}
              </div>
              <div className="mt-2 flex h-2.5 gap-[3px]" aria-hidden="true">
                {[
                  [me.funnel.delivered, "bg-agent-primary"],
                  [me.funnel.way, "bg-hue-teal-edge"],
                  [me.funnel.lost, "bg-hue-red-edge-mid"],
                  [me.funnel.awaiting_upload + me.funnel.back_in_queue, "bg-hue-neutral-edge"],
                ].map(([n, cls]) => (Number(n) > 0 ? <i key={String(cls)} className={`h-full min-w-1 rounded-pill ${cls}`} style={{ flex: Number(n) }} /> : null))}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] text-agent-on-surface-variant">
                <Legend dot="bg-agent-primary" label={t("rateCard.delivered")} n={me.funnel.delivered} />
                <Legend dot="bg-hue-teal-edge" label={t("rateCard.way")} n={me.funnel.way} />
                <Legend dot="bg-hue-red-edge-mid" label={t("rateCard.lost")} n={me.funnel.lost} />
                {me.funnel.awaiting_upload > 0 && <Legend dot="bg-hue-neutral-edge" label={t("rateCard.awaitingUpload")} n={me.funnel.awaiting_upload} />}
                {me.funnel.back_in_queue > 0 && <Legend dot="bg-hue-neutral-edge" label={t("rateCard.backInQueue")} n={me.funnel.back_in_queue} />}
              </div>
              {me.funnel.lost > 0 && (
                <div className="mt-2.5 text-[12px] text-agent-ink-3">
                  {(["carrier_cancelled", "cancelled", "rejected", "returned"] as LostReason[])
                    .filter((r) => me.lost[r] > 0)
                    .map((r) => `${t(`lost.${r}`)} ${me.lost[r]}`)
                    .join(" · ")}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── The four lists ──────────────────────────────────────────────── */}
      <section data-testid="commission-list" className="mt-3.5 rounded-2xl border border-agent-outline-variant bg-agent-surface">
        <div role="tablist" aria-label={t("tabs.label")} className="mx-3 mt-3 flex gap-0.5 overflow-x-auto rounded-xl bg-agent-surface-low p-1 [scrollbar-width:none]">
          {([
            ["unpaid", me.unpaid.count],
            ["way", me.way.count],
            ["paid", me.paid_orders.count],
            ["lost", me.lost.count],
          ] as [Tab, number][]).map(([key, n]) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => switchTab(key)}
                className={`inline-flex h-10 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13.5px] font-semibold transition-colors ${
                  on ? "bg-agent-surface text-agent-on-surface shadow-[inset_0_0_0_1px_var(--agent-outline-variant)]" : "text-agent-on-surface-variant hover:bg-agent-surface/60"
                }`}
              >
                <span>{t(`tabs.${key}`)}</span>
                <span className={`grid h-5 min-w-[22px] place-items-center rounded-pill px-1.5 text-[11.5px] font-bold tabular-nums ${on ? "bg-hue-green-fill-soft text-agent-primary" : "bg-agent-surface-high text-agent-ink-3"}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {tab === "unpaid" && (
          <>
            <ListHead say={t("head.unpaidSay")}>{t.rich("head.unpaid", { n: me.unpaid.count, amount: money(me.unpaid.amount), b })}</ListHead>
            {me.unpaid.rows.length === 0 ? (
              <Empty>{delivered > 0 ? t("empty.unpaid") : t("empty.first")}</Empty>
            ) : (
              <ByDay
                rows={me.unpaid.rows.slice(0, shown)}
                all={me.unpaid.rows}
                dayKey={f.key}
                dayLabel={f.weekday}
                total={(rows) => `${t("eq.leftSub", { n: rows.length })} · ${money(rows.reduce((s, r) => s + r.amount, 0))}`}
                renderRow={(r) => (
                  <Row
                    key={`${r.order_id}-${r.at}`}
                    image={r.image_url}
                    name={r.kind === "adjustment" ? t("adjustment") : r.customer_name ?? r.external_id ?? "—"}
                    sub={r.kind === "adjustment" ? r.note ?? "" : place(r.product_name, r.city)}
                    detail={r.partial ? t("partial", { amount: money(r.amount), full: money(r.full_amount) }) : undefined}
                    when={f.time(r.at)}
                    amount={money(r.amount, true)}
                  />
                )}
              />
            )}
            <More left={me.unpaid.rows.length - shown} onClick={() => setShown((s) => s + PAGE)} label={(n) => t("more", { n })} />
          </>
        )}

        {tab === "way" && (
          <>
            <ListHead say={t("head.waySay")}>{t.rich("head.way", { n: me.way.count, amount: money(me.way.est), b })}</ListHead>
            {me.way.rows.length === 0 && <Empty>{t("empty.way")}</Empty>}
            {me.way.rows.slice(0, shown).map((r) => {
              const age = r.uploaded_at ? daysBetween(f.key(r.uploaded_at), today) : null;
              const stuck = r.stage === "with_carrier" && age !== null && age > STUCK_DAYS;
              return (
                <Row
                  key={r.order_id ?? r.external_id}
                  image={r.image_url}
                  name={r.customer_name ?? r.external_id ?? "—"}
                  tag={<Tag tone={STAGE_TONE[r.stage]}>{t(`way.stages.${r.stage}`)}</Tag>}
                  sub={place(r.product_name, r.city)}
                  when={age === null ? "" : stuck ? t("stuck", { n: age }) : t("upAgo", { n: age })}
                  whenTone={stuck ? "warn" : undefined}
                  amount={me.enabled && r.stage !== "returning" && me.rate.amount !== null ? `≈ ${money(me.rate.amount)}` : "—"}
                  amountTone="muted"
                />
              );
            })}
            <More left={me.way.rows.length - shown} onClick={() => setShown((s) => s + PAGE)} label={(n) => t("more", { n })} />
          </>
        )}

        {tab === "paid" && (
          <>
            <ListHead say={t("head.paidSay", { k: me.paid_orders.payouts.length })}>
              {t.rich("head.paid", { n: me.paid_orders.count, amount: money(me.paid), b })}
            </ListHead>
            {me.paid_orders.payouts.length === 0 && <Empty>{t("empty.paid")}</Empty>}
            {me.paid_orders.payouts.map((p, i) => {
              const isOpen = !!open[i];
              return (
                <div key={`${p.at}-${i}`} className="border-b border-agent-outline-variant last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                    className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto_18px] items-center gap-3 bg-agent-bg px-[18px] py-3 text-start max-sm:grid-cols-[36px_minmax(0,1fr)_auto_18px] max-sm:px-3.5"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-hue-green-fill-soft text-agent-primary max-sm:h-9 max-sm:w-9">
                      <Wallet size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <b className="block text-[14px] text-agent-on-surface">{t("payout.head", { date: f.at(p.at) })}</b>
                      <small className="block text-[12.5px] text-agent-ink-3">
                        {t("payout.sub", {
                          method: p.method ? t(`method.${p.method}`) : "",
                          n: p.count,
                          from: p.from ? f.at(p.from) : "",
                          to: p.to ? f.at(p.to) : "",
                        })}
                        {p.has_split ? ` · ${t("payout.split")}` : ""}
                      </small>
                    </span>
                    <span className="text-[15px] font-extrabold tabular-nums text-agent-on-surface">{money(p.amount)}</span>
                    <ChevronDown size={18} aria-hidden="true" className={`text-agent-ink-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-agent-outline-variant">
                      {p.rows_omitted ? (
                        <Empty>{t("payout.omitted")}</Empty>
                      ) : (
                        p.rows.map((r) => (
                          <Row
                            key={`${r.order_id}-${r.at}`}
                            image={r.image_url}
                            name={r.kind === "adjustment" ? t("adjustment") : r.customer_name ?? r.external_id ?? "—"}
                            sub={r.kind === "adjustment" ? r.note ?? "" : place(r.product_name, r.city)}
                            detail={r.split ? t("payout.splitRow") : undefined}
                            when={f.at(r.at)}
                            amount={money(r.amount)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {canWiden && <Widen onClick={onMore}>{t("older")}</Widen>}
          </>
        )}

        {tab === "lost" && (
          <>
            <ListHead>{t.rich("head.lost", { n: me.lost.count, b })}</ListHead>
            {me.lost.count > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-agent-outline-variant px-[18px] py-2.5 max-sm:px-3.5">
                {(["all", ...LOST_REASONS.filter((r) => me.lost[r] > 0)] as (LostReason | "all")[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={lostFilter === k}
                    onClick={() => { setLostFilter(k); setShown(PAGE); }}
                    className={`h-[30px] rounded-pill border px-3 text-[12.5px] font-semibold ${
                      lostFilter === k ? "border-agent-on-surface bg-agent-surface-low text-agent-on-surface" : "border-agent-outline-variant bg-agent-surface text-agent-on-surface-variant"
                    }`}
                  >
                    {k === "all" ? t("lost.all") : t(`lost.${k}`)} <span className="tabular-nums">{k === "all" ? me.lost.count : me.lost[k]}</span>
                  </button>
                ))}
              </div>
            )}
            {lostRows.length === 0 && <Empty>{t("empty.lost")}</Empty>}
            {lostRows.slice(0, shown).map((r) => (
              <Row
                key={`${r.order_id}-${r.reason}`}
                image={r.image_url}
                name={r.customer_name ?? r.external_id ?? "—"}
                tag={<Tag tone={LOST_TONE[r.reason]}>{t(`lost.${r.reason}`)}</Tag>}
                sub={place(r.product_name, r.city)}
                detail={[
                  t(`lost.detail.${r.reason}`, { up: r.uploaded_at ? f.at(r.uploaded_at) : "—", at: r.at ? f.at(r.at) : "—" }),
                  r.was_amount !== null ? t("lost.wasCounted") : null,
                ].filter(Boolean).join(" · ")}
                when=""
                amount={
                  r.was_amount !== null ? (
                    <><s className="me-1 font-medium text-agent-ink-3">{money(r.was_amount)}</s>{money(0)}</>
                  ) : money(0)
                }
                amountTone={r.was_amount !== null ? undefined : "muted"}
              />
            ))}
            <More left={lostRows.length - shown} onClick={() => setShown((s) => s + PAGE)} label={(n) => t("more", { n })} />
            {canWiden && <Widen onClick={onMore}>{t("older")}</Widen>}
          </>
        )}
      </section>

      <p className="mx-1 mt-3 text-[12.5px] leading-relaxed text-agent-ink-3">{t.rich("rule", { b: (c) => <b className="text-agent-on-surface-variant">{c}</b> })}</p>
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function place(product: string | null, city: string | null): string {
  return [product, city].filter(Boolean).join(" · ");
}

/** Whole days between two market-local calendar dates ("YYYY-MM-DD"). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function EqCell({ label, value, sub, dot, tone }: { label: string; value: string; sub: string; dot?: string; tone?: "pos" | "neg" }) {
  const bg = tone === "pos" ? "bg-hue-green-fill-soft" : tone === "neg" ? "bg-hue-red-fill-soft" : "";
  const ink = tone === "pos" ? "text-agent-primary" : tone === "neg" ? "text-agent-error" : "text-agent-on-surface";
  return (
    <div className={`min-w-0 px-4 py-3 max-sm:px-2.5 ${bg}`}>
      <small className="flex items-center gap-1.5 text-[12px] text-agent-ink-3">
        {dot && <i aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${dot}`} />}
        {label}
      </small>
      <b className={`mt-px block whitespace-nowrap text-[19px] font-extrabold tabular-nums max-sm:text-[16px] ${ink}`}>{value}</b>
      <span className="block text-[12.5px] text-agent-on-surface-variant max-sm:text-[11.5px]">{sub}</span>
    </div>
  );
}

function EqOp({ children }: { children: ReactNode }) {
  return <div aria-hidden="true" className="grid place-items-center text-[20px] font-light text-agent-ink-3">{children}</div>;
}

function Legend({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <i aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {label}
      <b className="ms-auto tabular-nums text-agent-on-surface">{n}</b>
    </span>
  );
}

function Tag({ tone, children }: { tone: { tag: string; dot: string }; children: ReactNode }) {
  return (
    <span className={`ms-1.5 inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 align-[1px] text-[12px] font-semibold ${tone.tag}`}>
      <i aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${tone.dot}`} />
      {children}
    </span>
  );
}

function ListHead({ children, say }: { children: ReactNode; say?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 border-b border-agent-outline-variant px-[18px] pb-2.5 pt-3.5 text-[13px] text-agent-on-surface-variant max-sm:px-3.5">
      <span className="[&_b]:text-[15px]">{children}</span>
      {say && <span className="text-[12.5px] text-agent-ink-3">— {say}</span>}
    </div>
  );
}

function Row({
  image, name, tag, sub, detail, when, whenTone, amount, amountTone,
}: {
  image: string | null;
  name: string;
  tag?: ReactNode;
  sub: string;
  detail?: string;
  when: string;
  whenTone?: "warn";
  amount: ReactNode;
  amountTone?: "muted";
}) {
  return (
    <div
      data-testid="commission-row"
      className="grid grid-cols-[40px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-agent-outline-variant px-[18px] py-2.5 last:border-b-0 max-sm:grid-cols-[36px_minmax(0,1fr)_auto] max-sm:gap-x-2.5 max-sm:px-3.5"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-10 w-10 rounded-lg border border-agent-outline-variant object-cover max-sm:h-9 max-sm:w-9" />
      ) : (
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-agent-surface-low text-agent-ink-3 max-sm:h-9 max-sm:w-9">
          <Package size={17} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <b className="block truncate text-[14px] font-semibold text-agent-on-surface">{name}{tag}</b>
        <small dir="auto" className="block truncate text-[12.5px] text-agent-ink-3">{sub}</small>
        {detail && <small className="block text-[12px] text-agent-ink-3">{detail}</small>}
      </div>
      <span className={`whitespace-nowrap text-end text-[12.5px] tabular-nums max-sm:col-start-2 max-sm:row-start-2 max-sm:text-start ${whenTone === "warn" ? "font-semibold text-hue-amber-ink" : "text-agent-ink-3"}`}>
        {when}
      </span>
      <span className={`min-w-[56px] whitespace-nowrap text-end tabular-nums max-sm:col-start-3 max-sm:row-start-1 ${amountTone === "muted" ? "font-semibold text-agent-ink-3" : "font-bold text-agent-on-surface"}`}>
        {amount}
      </span>
    </div>
  );
}

function ByDay({
  rows, all, dayKey, dayLabel, total, renderRow,
}: {
  rows: StatementCredit[];
  all: StatementCredit[];
  dayKey: (iso: string) => string;
  dayLabel: (iso: string) => string;
  total: (rows: StatementCredit[]) => string;
  renderRow: (r: StatementCredit) => ReactNode;
}) {
  const out: ReactNode[] = [];
  let current: string | null = null;
  for (const r of rows) {
    const k = dayKey(r.at);
    if (k !== current) {
      current = k;
      const same = all.filter((x) => dayKey(x.at) === k);
      out.push(
        <div key={`d-${k}`} className="flex items-center justify-between border-b border-agent-outline-variant bg-agent-bg px-[18px] py-2 text-[12.5px] font-semibold text-agent-on-surface-variant max-sm:px-3.5">
          <span>{dayLabel(r.at)}</span>
          <span className="font-medium text-agent-ink-3">{total(same)}</span>
        </div>,
      );
    }
    out.push(renderRow(r));
  }
  return <>{out}</>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 px-[18px] py-7 text-center text-[13.5px] text-agent-ink-3">{children}</p>;
}

function More({ left, onClick, label }: { left: number; onClick: () => void; label: (n: number) => string }) {
  if (left <= 0) return null;
  return (
    <div className="flex justify-center border-t border-agent-outline-variant p-2.5">
      <button type="button" onClick={onClick} className="h-9 rounded-lg px-3.5 text-[13px] font-semibold text-agent-primary hover:bg-agent-surface-low">
        {label(left)}
      </button>
    </div>
  );
}

function Widen({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-center border-t border-agent-outline-variant p-2.5">
      <button type="button" onClick={onClick} className="h-9 rounded-lg px-3.5 text-[13px] font-semibold text-agent-on-surface-variant hover:bg-agent-surface-low">
        {children}
      </button>
    </div>
  );
}
