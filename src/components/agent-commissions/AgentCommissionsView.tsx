"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, RotateCcw, Wallet, PenLine } from "lucide-react";
import type { AgentCommissions, AgentHistoryItem, AgentHistoryOrder } from "@/lib/commissions/types";
import { fmtCommission } from "@/lib/commissions/view-models";

/**
 * Which kind of ledger entry a history row is. `get_my_commissions` groups
 * accruals and reversals into one "day" item, so a day that only ever took
 * money back reads as a correction rather than a delivery.
 */
export type EntryKind = "accrual" | "reversal" | "payout" | "adjustment";

export function entryKindOf(item: AgentHistoryItem): EntryKind {
  if (item.type === "payout") return "payout";
  if (item.type === "adjustment") return "adjustment";
  return item.delivered === 0 && item.corrections > 0 ? "reversal" : "accrual";
}

/**
 * Flat tint + ink per entry kind, and a glyph, so the type reads without the
 * colour. Same idea as the queue's status tag — one hue per meaning.
 */
const ENTRY_TONE: Record<EntryKind, { tag: string; dot: string; Icon: typeof CircleCheck }> = {
  accrual: { tag: "bg-hue-green-fill-soft text-hue-green-ink", dot: "bg-hue-green-edge", Icon: CircleCheck },
  reversal: { tag: "bg-hue-red-fill-soft text-hue-red-ink", dot: "bg-hue-red-edge", Icon: RotateCcw },
  payout: { tag: "bg-hue-neutral-fill-soft text-hue-neutral-ink", dot: "bg-hue-neutral-edge", Icon: Wallet },
  adjustment: { tag: "bg-hue-violet-fill-soft text-hue-violet-ink", dot: "bg-hue-violet-edge", Icon: PenLine },
};

const ENTRY_ORDER: EntryKind[] = ["accrual", "reversal", "payout", "adjustment"];

interface Props {
  me: AgentCommissions;
  marketCode: string;
  locale: string;
  tz: string;
  onMore: () => void;
}

/**
 * "Mes commissions" — deliberately minimal: one number (À recevoir), three
 * facts (ce mois · en cours · dernier paiement), one history grouped by day
 * that opens to the orders. Read-only; the manager records payments.
 */
export function AgentCommissionsView({ me, marketCode, locale, tz, onMore }: Props) {
  const t = useTranslations("agentCommissions");
  const tm = useTranslations("team.commissions.method");
  const fmtD = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  const fmtDay = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));
  const money = (n: number, signed = false) => fmtCommission(n, marketCode, { signed });

  if (!me.enabled && me.balance === 0 && me.history.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-10 text-center">
        <p className="text-[15px] font-semibold text-agent-on-surface">{t("disabledTitle")}</p>
        <p className="mt-1 text-[13px] text-agent-ink-3">{t("disabledHint")}</p>
      </div>
    );
  }

  const negative = me.balance < 0;
  const [bucket, setBucket] = useState<EntryKind | "all">("all");
  const counts = useMemo(() => {
    const c: Record<EntryKind, number> = { accrual: 0, reversal: 0, payout: 0, adjustment: 0 };
    me.history.forEach((item) => { c[entryKindOf(item)] += 1; });
    return c;
  }, [me.history]);
  const visible = useMemo(
    () => (bucket === "all" ? me.history : me.history.filter((i) => entryKindOf(i) === bucket)),
    [me.history, bucket],
  );

  return (
    <div className="mx-auto max-w-[640px] px-5 pb-16 pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-[20px] font-bold text-agent-on-surface">{t("title")}</h1>
        {me.rate !== null && me.enabled && (
          <span className="text-[12.5px] text-agent-ink-3">
            {t.rich("rate", { rate: money(me.rate), b: (c) => <b className="text-agent-on-surface">{c}</b> })}
          </span>
        )}
      </div>

      <section className="rounded-xl border border-agent-outline-variant bg-agent-surface">
        <div className="px-[22px] pb-[18px] pt-[22px]">
          <div className="text-[12.5px] tracking-[.02em] text-agent-on-surface-variant">{t("toReceive")}</div>
          <div className={`mt-1 text-[40px] font-extrabold leading-[1.05] tabular-nums ${negative ? "text-agent-error" : "text-agent-on-surface"}`}>{money(me.balance)}</div>
          <div className="mt-2 text-[13px] text-agent-on-surface-variant">
            {negative
              ? t("negative", { amount: money(-me.balance) })
              : me.last_payout
                ? t.rich("sinceLastPayout", { date: fmtD(me.last_payout.at), delivered: me.since_last_payout.delivered, corrections: me.since_last_payout.corrections, b: (c) => <b className="text-agent-on-surface">{c}</b> })
                : t("sinceStart", { delivered: me.since_last_payout.delivered })}
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-agent-outline-variant">
          <div className="border-e border-agent-outline-variant px-[18px] py-3.5">
            <div className="text-[12px] text-agent-ink-3">{t("month")}</div>
            <div className="mt-0.5 text-[18px] font-bold text-agent-on-surface">{t("monthDelivered", { n: me.month.delivered })}</div>
            <div className="text-[12.5px] tabular-nums text-agent-on-surface-variant">{money(me.month.earned, true)}</div>
          </div>
          <div className="border-e border-agent-outline-variant px-[18px] py-3.5">
            <div className="text-[12px] text-agent-ink-3">{t("inflight")}</div>
            <div className="mt-0.5 text-[18px] font-bold text-agent-on-surface-variant">{t("inflightCount", { n: me.inflight.count })}</div>
            <div className="text-[12.5px] tabular-nums text-agent-ink-3">{t("inflightEst", { amount: money(me.inflight.est) })}</div>
          </div>
          <div className="px-[18px] py-3.5">
            <div className="text-[12px] text-agent-ink-3">{t("lastPayout")}</div>
            <div className="mt-0.5 text-[18px] font-bold text-agent-on-surface">{me.last_payout ? fmtD(me.last_payout.at) : t("noPayout")}</div>
            {me.last_payout && (
              <div className="text-[12.5px] tabular-nums text-agent-on-surface-variant">{money(me.last_payout.amount)}{me.last_payout.method ? ` · ${tm(me.last_payout.method)}` : ""}</div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-3.5 rounded-xl border border-agent-outline-variant bg-agent-surface">
        <div className="flex items-baseline justify-between border-b border-agent-outline-variant px-[18px] py-3.5">
          <b className="text-[15px] text-agent-on-surface">{t("history")}</b>
          <small className="text-[12.5px] text-agent-ink-3">{t("historyHint")}</small>
        </div>

        {/* One segment per entry type. The ledger is four different events and
            they used to be told apart only by which way the number leaned. */}
        <div
          role="tablist"
          aria-label={t("buckets.all")}
          className="flex gap-1 overflow-x-auto border-b border-agent-outline-variant bg-agent-surface-low p-1.5 [scrollbar-width:none]"
        >
          {(["all", ...ENTRY_ORDER] as const).map((key) => {
            const on = bucket === key;
            const count = key === "all" ? me.history.length : counts[key];
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setBucket(key)}
                className={[
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold",
                  "transition-colors duration-fast",
                  on
                    ? "bg-agent-surface text-agent-on-surface shadow-[inset_0_0_0_1px_var(--agent-outline-variant)]"
                    : count === 0
                      ? "text-agent-ink-3 hover:bg-agent-surface"
                      : "text-agent-on-surface-variant hover:bg-agent-surface",
                ].join(" ")}
              >
                {key !== "all" && (
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${ENTRY_TONE[key].dot}`} />
                )}
                <span>{t(`buckets.${key}`)}</span>
                <span
                  aria-hidden="true"
                  className={[
                    "grid h-[18px] min-w-[20px] place-items-center rounded-pill px-1 text-[11px] font-bold tabular-nums",
                    on ? "bg-brand-bg text-brand" : "bg-agent-surface-high text-agent-ink-3",
                  ].join(" ")}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Column heads: four columns is one too many to leave unlabelled. */}
        <div
          aria-hidden="true"
          className="grid grid-cols-[120px_minmax(0,1fr)_92px_100px] gap-3 border-b border-agent-outline-variant px-[18px] py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-agent-ink-3"
        >
          <span>{t("cols.type")}</span>
          <span>{t("cols.detail")}</span>
          <span>{t("cols.date")}</span>
          <span className="text-end">{t("cols.amount")}</span>
        </div>

        {visible.length === 0 && <p className="px-[18px] py-6 text-[13.5px] text-agent-ink-3">{t("empty")}</p>}
        {visible.map((item, i) => <HistoryRow key={i} item={item} money={money} fmtD={fmtD} fmtDay={fmtDay} />)}
        <div className="flex items-center justify-between gap-3 px-[18px] py-2.5 text-[12.5px] text-agent-ink-3">
          {me.has_more ? <button type="button" onClick={onMore} className="inline-flex h-11 items-center text-agent-primary hover:underline">{t("more")}</button> : <span />}
          <span>{t("rule")}</span>
        </div>
      </section>
    </div>
  );
}

function HistoryRow({ item, money, fmtD, fmtDay }: { item: AgentHistoryItem; money: (n: number, s?: boolean) => string; fmtD: (iso: string) => string; fmtDay: (d: string) => string }) {
  const t = useTranslations("agentCommissions");
  const tm = useTranslations("team.commissions.method");
  const [open, setOpen] = useState(false);
  const rowCls = "grid grid-cols-[120px_minmax(0,1fr)_92px_100px] items-center gap-3 px-[18px] py-[11px] text-[13.5px] border-b border-agent-outline-variant last:border-b-0";
  const dCls = "text-[12.5px] text-agent-ink-3";
  const mCls = "text-end font-bold tabular-nums";
  const kind = entryKindOf(item);
  const tone = ENTRY_TONE[kind];
  const EntryIcon = tone.Icon;
  const entryTag = (
    <span
      data-testid="commission-entry"
      data-entry={kind}
      className={`inline-flex h-[26px] items-center gap-1.5 rounded-pill ps-2 pe-2.5 text-[12px] font-semibold ${tone.tag}`}
    >
      <EntryIcon size={13} strokeWidth={2} aria-hidden="true" />
      <span className="truncate">{t(`buckets.${kind}`)}</span>
    </span>
  );

  if (item.type === "payout") {
    return (
      <div className={`${rowCls} bg-agent-surface-low`}>
        {entryTag}
        <span className="min-w-0"><b>{t("paymentReceived")}</b><small className="block truncate text-[12px] text-agent-ink-3">{item.method ? tm(item.method) : ""}{item.reference ? ` · ${item.reference}` : ""}</small></span>
        <span className={dCls}>{fmtD(item.at)}</span>
        <span className={`${mCls} text-agent-on-surface`}>{money(item.amount, true)}</span>
      </div>
    );
  }
  if (item.type === "adjustment") {
    return (
      <div className={rowCls}>
        {entryTag}
        <span className="min-w-0"><b>{t("adjustment")}</b>{item.note && <small className="block truncate text-[12px] text-agent-ink-3">{item.note}</small>}</span>
        <span className={dCls}>{fmtD(item.at)}</span>
        <span className={`${mCls} ${item.amount < 0 ? "text-agent-error" : "text-agent-on-surface"}`}>{money(item.amount, true)}</span>
      </div>
    );
  }
  const onlyCorrections = item.delivered === 0 && item.corrections > 0;
  const reversals = item.orders.filter((o) => o.entry_type === "reversal");
  const reasonOf = (o: AgentHistoryOrder) => (o.reason === "uploaded_before_activation" ? t("reasonBeforeStart") : t("reasonNotDelivered"));
  // One reason for the whole day is worth saying on the row; mixed reasons stay on the expanded lines.
  const dayReason = reversals.length > 0 && reversals.every((o) => o.reason === reversals[0].reason) ? reasonOf(reversals[0]) : null;
  const firstReversal = reversals[0];
  return (
    <div className="border-b border-agent-outline-variant last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`w-full border-0 bg-transparent text-start ${rowCls} !border-b-0 hover:bg-agent-bg ${open ? "bg-agent-bg" : ""}`}>
        {entryTag}
        <span className="min-w-0">
          {onlyCorrections ? t("dayCorrections", { n: item.corrections }) : t("dayDelivered", { n: item.delivered })}
          {!onlyCorrections && item.corrections > 0 && <small className="block text-[12px] text-agent-ink-3">{t("dayCorrections", { n: item.corrections })}{dayReason ? ` · ${dayReason}` : ""}</small>}
          {onlyCorrections && firstReversal?.external_id && (
            <small className="block truncate text-[12px] text-agent-ink-3">
              {t(firstReversal.reason === "uploaded_before_activation" ? "correctionNoteBeforeStart" : "correctionNote", { id: `#${firstReversal.external_id}` })}
            </small>
          )}
        </span>
        <span className={dCls}>{fmtDay(item.day)}</span>
        <span className={`${mCls} ${item.amount < 0 ? "text-agent-error" : "text-agent-on-surface"}`}>{money(item.amount, true)}</span>
      </button>
      {open && (
        <div className="grid gap-1 bg-agent-bg px-[18px] pb-2.5 ps-[150px] text-[12.5px] text-agent-on-surface-variant">
          {item.orders.map((o, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span dir="auto">{o.external_id ? `#${o.external_id}` : "—"}{o.product_name ? ` · ${o.product_name}` : ""}{o.city ? ` · ${o.city}` : ""}{o.entry_type === "reversal" ? ` · ${reasonOf(o)}` : ""}</span>
              <span className={`font-semibold tabular-nums ${o.amount < 0 ? "text-agent-error" : ""}`}>{money(o.amount, true)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
