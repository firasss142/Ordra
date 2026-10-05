"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AgentStatement, LostReason, StatementCredit, StatementStage } from "@/lib/commissions/types";
import { fmtCommission } from "@/lib/commissions/view-models";
import { formatMoneyParts } from "@/lib/format";
import { Ic, Thumb, useTip, useAgentPhone, type AgentHue } from "@/components/agent/shared";
import { AutoMore } from "@/components/agent/useAutoPage";

/**
 * « Mes commissions » in the agent shell « Aurore » — prototypes/agent-shell-v2.html § 5
 * (`comPage`, `comList`, `comRow`, `comPhone`). What we owe you, what is on the road, how
 * often it arrives. Every figure comes from get_my_commission_statement (plus
 * `way.likely_each`, attached server-side by /api/agent/commissions): this page only
 * formats. Read-only — the manager records payments.
 *
 * Returns the CHILDREN of the shell's `.page`. On a phone the shell titles the page, so
 * the `.ph` header is not drawn (`comPhone` = `comPage(true)`).
 */

type Tab = "unpaid" | "road" | "paid" | "none";
const PAGE = 30;
const LATE_DAYS = 7;

/** prototype `STAGE` */
const STAGE_HUE: Record<StatementStage, AgentHue> = {
  awaiting_scan: "neutral",
  with_carrier: "teal",
  out: "teal",
  delayed: "amber",
  returning: "red",
};
const STAGE_ORDER: StatementStage[] = ["awaiting_scan", "with_carrier", "out", "delayed", "returning"];

/** prototype `NONE_WHY`, plus the live reasons the dummy market never produced */
const NONE_HUE: Record<LostReason, AgentHue> = {
  returned: "red",
  carrier_cancelled: "neutral",
  rejected: "red",
  cancelled: "neutral",
  before_activation: "neutral",
  commission_off: "neutral",
  corrected: "neutral",
};
const NONE_ORDER: LostReason[] = ["returned", "carrier_cancelled", "rejected", "cancelled", "before_activation", "commission_off", "corrected"];

interface Props {
  me: AgentStatement;
  marketCode: string;
  locale: string;
  tz: string;
  /** widen the window (older payouts and orders without commission) */
  onMore: () => void;
}

export function AgentCommissionsView({ me, marketCode, locale, tz, onMore }: Props) {
  const t = useTranslations("agentCommissions");
  const phone = useAgentPhone();
  const tip = useTip();
  const [tab, setTab] = useState<Tab>("unpaid");
  const [fil, setFil] = useState<LostReason | "all">("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [shown, setShown] = useState(PAGE);

  const f = useMemo(() => {
    const loc = locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
    const dayFmt = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: tz });
    const timeFmt = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
    const keyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz });
    const localDayFmt = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" });
    const pctFmt = new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 0 });
    return {
      at: (iso: string) => dayFmt.format(new Date(iso)),
      time: (iso: string) => timeFmt.format(new Date(iso)),
      key: (iso: string | Date) => keyFmt.format(typeof iso === "string" ? new Date(iso) : iso),
      /** a market-local calendar date ("2026-09-12") */
      day: (d: string) => localDayFmt.format(new Date(`${d}T12:00:00Z`)),
      pct: (r: number) => pctFmt.format(r),
    };
  }, [locale, tz]);

  const money = (n: number, signed = false) => fmtCommission(n, marketCode, { signed });
  /** the figure alone and the currency apart — `fnum(x)<small>CCY</small>` */
  const parts = (n: number) => formatMoneyParts(n, marketCode, Number.isInteger(n) ? 0 : 3);
  const ccy = parts(0).symbol;
  const b = (c: ReactNode) => <b>{c}</b>;
  const today = f.key(new Date());

  const lostRows = useMemo(
    () => (fil === "all" ? me.lost.rows : me.lost.rows.filter((r) => r.reason === fil)),
    [me.lost.rows, fil],
  );

  const never =
    !me.enabled && !me.activated_on && me.owed === 0 &&
    me.unpaid.rows.length === 0 && me.paid_orders.payouts.length === 0;
  if (never) {
    return (
      <section className="list">
        <div className="empty">
          <Ic n="coins" />
          <b>{t("disabledTitle")}</b>
          <span>{t("disabledHint")}</span>
        </div>
      </section>
    );
  }

  const neg = me.owed < 0;
  const delivered = me.paid_orders.count + me.unpaid.count;
  const perTen = me.delivery_rate === null ? null : Math.round(me.delivery_rate * 10);
  const oldestUnpaid = me.unpaid.rows[me.unpaid.rows.length - 1];
  const newestUnpaid = me.unpaid.rows[0];
  const canWiden = me.paid_orders.payouts.some((p) => p.rows_omitted) || (me.activated_on !== null && me.since > me.activated_on);
  const switchTab = (next: Tab) => { setTab(next); setShown(PAGE); };
  const lp = me.last_payout;
  const rate = me.rate.amount;

  /* ── header: the rule as a stat pill ─────────────────────────────────────── */
  const rateTip = [
    me.rate.effective_from && me.rate.previous_amount !== null
      ? me.rate.effective_from === today ? t("rateToday") : t("rateSince", { date: f.day(me.rate.effective_from) })
      : null,
    !me.enabled && me.rate.off_since ? t("rateOff", { date: f.day(me.rate.off_since) }) : null,
  ].filter(Boolean).join(" · ");
  const sinceDay = me.activated_on ?? me.rate.effective_from;

  const header = phone ? null : (
    <header className="ph">
      <div>
        <h1>{t("title")}</h1>
        {rate !== null && (
          <div className="sub">
            <span className="statp" data-tip={rateTip || undefined}>
              <Ic n="coins" />
              <span>
                {sinceDay ? t.rich("statp", { amount: money(rate), date: f.day(sinceDay), b }) : t.rich("statpNoDate", { amount: money(rate), b })}
                {me.rate.previous_amount !== null && ` · ${t("ratePrevious", { amount: money(me.rate.previous_amount) })}`}
              </span>
            </span>
          </div>
        )}
      </div>
    </header>
  );

  /* ── the hero: what we owe you, and the equation that proves it ─────────── */
  const heroSub = neg
    ? t.rich("negative", { amount: money(-me.owed), b })
    : me.unpaid.count > 0
      ? (
        <>
          {t.rich("heroFor", { n: me.unpaid.count, b })}
          {oldestUnpaid && newestUnpaid && ` · ${t("owedRange", { from: f.at(oldestUnpaid.at), to: f.at(newestUnpaid.at) })}`}
        </>
      )
      : delivered > 0 ? t("owedNone") : t("empty.first");

  const owedP = parts(me.owed);
  const pctOf = (n: number) => (me.earned > 0 ? `${Math.round((Math.max(0, n) / me.earned) * 100)}%` : "0%");

  const hero = (
    <section className="hero2">
      <small>{t("owedNow")}</small>
      <div className="big2 num">{neg ? "−" : ""}{owedP.value}<span>{owedP.symbol}</span></div>
      <p>{heroSub}</p>
      <div className="pbar3" role="img" aria-label={t("pbarLabel", { paid: money(me.paid), owed: money(me.owed) })}>
        <i style={{ width: pctOf(Math.min(me.paid, me.earned)) }} />
        <b style={{ width: pctOf(me.owed) }} />
      </div>
      <div className="eq">
        <span data-tip={t("eq.earnedSub", { n: delivered, date: f.day(me.activated_on ?? me.since) })}>
          <small>{t("eq.earned")}</small><b className="num">{parts(me.earned).value}</b>
        </span>
        <em>−</em>
        <span data-tip={t("eq.paidSub", { n: me.paid_orders.count, k: me.paid_orders.payouts.length })}>
          <small>{t("eq.paid")}</small><b className="num">{parts(me.paid).value}</b>
        </span>
        <em>=</em>
        <span className={`ow${neg ? " neg" : ""}`} data-tip={t("eq.leftSub", { n: me.unpaid.count })}>
          <small>{neg ? t("eq.over") : t("eq.left")}</small><b>{money(Math.abs(me.owed))}</b>
        </span>
      </div>
      <p className="last">
        <Ic n="check" />
        {lp ? t("last", { date: f.at(lp.at), amount: money(lp.amount), method: lp.method ? t(`method.${lp.method}`) : "" }) : t("noPayout")}
      </p>
    </section>
  );

  /* ── two cards: on the road, and the delivery rate ───────────────────────── */
  const stages = STAGE_ORDER.filter((s) => me.way.stages[s] > 0);
  const usual = me.enabled && perTen !== null && me.way.est_likely !== null && me.way.count > 0;
  const funnel: [AgentHue, string, number][] = [
    ["green", t("rateCard.delivered"), me.funnel.delivered],
    ["teal", t("rateCard.way"), me.funnel.way],
    ["red", t("rateCard.lost"), me.funnel.lost],
    ["violet", t("rateCard.awaitingUpload"), me.funnel.awaiting_upload],
    ["neutral", t("rateCard.backInQueue"), me.funnel.back_in_queue],
  ];
  const lostTip = (["carrier_cancelled", "cancelled", "rejected", "returned"] as LostReason[])
    .filter((r) => me.lost[r] > 0)
    .map((r) => `${t(`lost.${r}`)} ${me.lost[r]}`)
    .join(" · ");

  const cards = (
    <div className="twoc">
      <section className="card2">
        <h3><Ic n="truck" />{t("way.title")}</h3>
        <div className="kv"><b className="num">{me.way.count}</b><span>{t("way.unit", { n: me.way.count })}</span></div>
        <p data-tip={me.enabled && rate !== null ? t("way.fine", { rate: money(rate) }) : undefined}>
          {!me.enabled
            ? t("way.off")
            : usual
              ? t.rich("way.estUsual", { all: money(me.way.est), k: perTen ?? 0, likely: money(me.way.est_likely ?? 0), b })
              : t("way.estAll", { all: money(me.way.est) })}
        </p>
        {stages.length > 0 && (
          <div className="stg">
            {stages.map((s) => (
              <span key={s} className={`chipm h-${STAGE_HUE[s]}`}>{t(`way.stages.${s}`)} · <b>{me.way.stages[s]}</b></span>
            ))}
          </div>
        )}
        <Link className="lnk" href={`/${locale}/delivery`}>
          {t("way.lateCta")}
          <Ic n="right" className="flip" />
        </Link>
      </section>
      <section className="card2">
        <h3><Ic n="pct" />{t("rateCard.title")}</h3>
        <div className="kv"><b>{me.delivery_rate === null ? "—" : f.pct(me.delivery_rate)}</b></div>
        <p>{perTen === null ? t("rateCard.empty") : t("rateCard.say", { k: perTen })}</p>
        <div
          className="fun"
          role="img"
          aria-label={funnel.map(([, l, n]) => `${l} ${n}`).join(", ")}
          data-tip={t("rateCard.funnel", { n: me.funnel.confirmed, date: f.day(me.since) })}
        >
          {funnel.map(([h, l, n]) => (n ? <i key={h} className={`h-${h}`} style={{ flex: n }} title={`${l} ${n}`} /> : null))}
        </div>
        <div className="leg">
          {funnel.map(([h, l, n]) => (
            <span key={h} data-tip={h === "red" && lostTip ? lostTip : undefined}><i className={`h-${h}`} />{l} <b>{n}</b></span>
          ))}
        </div>
      </section>
    </div>
  );

  /* ── the four lists ──────────────────────────────────────────────────────── */
  const tabs: [Tab, number][] = [
    ["unpaid", me.unpaid.count],
    ["road", me.way.count],
    ["paid", me.paid_orders.payouts.length],
    ["none", me.lost.count],
  ];
  const tabWord: Record<Tab, string> = { unpaid: "unpaid", road: "way", paid: "paid", none: "lost" };

  const segRow = (
    <div className="seg-row">
      <div className="seg" role="tablist" aria-label={t("tabs.label")}>
        {tabs.map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => switchTab(k)}>
            {t(`tabs.${tabWord[k]}`)}<em>{n}</em>
          </button>
        ))}
      </div>
    </div>
  );

  const more = (left: number) =>
    left > 0 ? (
      <AutoMore watch={shown} onMore={() => setShown((s) => s + PAGE)}>{t("more", { n: Math.min(PAGE, left) })}</AutoMore>
    ) : null;
  const widen = canWiden ? (
    <div className="more"><button type="button" className="btn2" onClick={onMore}>{t("older")}</button></div>
  ) : null;
  const plus = (n: number, cls = "", sign = "+") => (
    <span className={`plus${cls ? ` ${cls}` : ""}`}>{sign}{parts(n).value}<small>{ccy}</small></span>
  );
  const creditName = (r: StatementCredit) => (r.kind === "adjustment" ? t("adjustment") : r.customer_name ?? r.external_id ?? "—");
  const creditSub = (r: StatementCredit, extra?: string | null) =>
    r.kind === "adjustment" ? <>{r.note ?? ""}</> : <Place product={r.product_name} city={r.city} extra={extra} />;

  let list: ReactNode;
  if (tab === "unpaid") {
    const yesterday = f.key(new Date(Date.now() - 86_400_000));
    const days = new Map<string, StatementCredit[]>();
    for (const r of me.unpaid.rows) {
      const k = f.key(r.at);
      days.set(k, [...(days.get(k) ?? []), r]);
    }
    const out: ReactNode[] = [];
    let left = shown;
    for (const [k, all] of Array.from(days.entries())) {
      if (left <= 0) break;
      const os = all.slice(0, left);
      left -= os.length;
      const sum = all.reduce((s, r) => s + r.amount, 0);
      out.push(
        <div key={`d-${k}`} className="dayh">
          <b>{k === today ? t("day.today") : k === yesterday ? t("day.yesterday") : f.at(all[0].at)}</b>
          <span>{money(sum, true)}</span>
        </div>,
      );
      for (const r of os) {
        out.push(
          <CRow key={`${r.order_id}-${r.at}`} image={r.image_url} seed={r.product_name ?? r.order_id ?? "?"} name={creditName(r)}
            sub={creditSub(r, r.partial ? t("partial", { amount: money(r.amount), full: money(r.full_amount) }) : null)}>
            <span className="tm num">{f.time(r.at)}</span>
            {plus(r.amount)}
          </CRow>,
        );
      }
    }
    list = me.unpaid.rows.length === 0
      ? <div className="empty">{delivered > 0 ? t("empty.unpaid") : t("empty.first")}</div>
      : <div className="rows">{out}{more(me.unpaid.rows.length - shown)}</div>;
  } else if (tab === "road") {
    list = me.way.rows.length === 0 ? <div className="empty">{t("empty.way")}</div> : (
      <div className="rows">
        {me.way.rows.slice(0, shown).map((r) => {
          const d = r.uploaded_at ? Math.max(0, daysBetween(f.key(r.uploaded_at), today)) : null;
          const atCarrier = r.stage === "with_carrier" || r.stage === "out" || r.stage === "delayed";
          const each = me.way.likely_each ?? rate;
          return (
            <CRow key={r.order_id ?? r.external_id} image={r.image_url} seed={r.product_name ?? r.order_id ?? "?"}
              name={r.customer_name ?? r.external_id ?? "—"} sub={<Place product={r.product_name} city={r.city} />}>
              <span className={`pl h-${STAGE_HUE[r.stage]}`}>{t(`way.stages.${r.stage}`)}</span>
              <span className={`tm${d !== null && d > LATE_DAYS ? " warn" : ""}`}>
                {d === null ? "" : atCarrier && d > 1 ? t("stuck", { n: d }) : t("upAgo", { n: d })}
              </span>
              {me.enabled && r.stage !== "returning" && each !== null ? plus(each, "soft", "≈ ") : <span className="plus soft">—</span>}
            </CRow>
          );
        })}
        {more(me.way.rows.length - shown)}
      </div>
    );
  } else if (tab === "paid") {
    list = me.paid_orders.payouts.length === 0 ? <div className="empty">{t("empty.paid")}</div> : (
      <div className="rows">
        {me.paid_orders.payouts.map((p, i) => {
          const isOpen = !!open[i];
          return (
            <div key={`${p.at}-${i}`} className="com-pay">
              <button type="button" className="payout" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                <span className="hold h-green"><Ic n="coins" /></span>
                <span className="st">
                  <b>{t("payout.head", { date: f.at(p.at) })}</b>
                  <small>
                    {t("payout.sub", { method: p.method ? t(`method.${p.method}`) : "", n: p.count, from: p.from ? f.at(p.from) : "", to: p.to ? f.at(p.to) : "" })}
                    {p.has_split ? ` · ${t("payout.split")}` : ""}
                  </small>
                </span>
                {plus(p.amount, "", "")}
                <Ic n={isOpen ? "down" : "right"} className={isOpen ? "" : "flip"} />
              </button>
              {isOpen && (p.rows_omitted
                ? <div className="empty">{t("payout.omitted")}</div>
                : p.rows.map((r) => (
                  <CRow key={`${r.order_id}-${r.at}`} image={r.image_url} seed={r.product_name ?? r.order_id ?? "?"} name={creditName(r)}
                    sub={creditSub(r, r.split ? t("payout.splitRow") : null)}>
                    <span className="tm">{f.at(r.at)}</span>
                    {plus(r.amount)}
                  </CRow>
                )))}
            </div>
          );
        })}
        {widen}
      </div>
    );
  } else {
    const fils = (["all", ...NONE_ORDER.filter((r) => me.lost[r] > 0)] as (LostReason | "all")[]);
    list = (
      <>
        {me.lost.count > 0 && (
          <div className="cfil">
            {fils.map((k) => (
              <button key={k} type="button" aria-pressed={fil === k} className={`rc${fil === k ? " on" : ""}`}
                onClick={() => { setFil(k); setShown(PAGE); }}>
                {k === "all" ? t("lost.all") : t(`lost.${k}`)}
              </button>
            ))}
          </div>
        )}
        {lostRows.length === 0 ? <div className="empty">{t("empty.lost")}</div> : (
          <div className="rows">
            {lostRows.slice(0, shown).map((r) => {
              const would = r.was_amount ?? rate;
              const detail = [
                t(`lost.detail.${r.reason}`, { up: r.uploaded_at ? f.at(r.uploaded_at) : "—", at: r.at ? f.at(r.at) : "—" }),
                r.was_amount !== null ? t("lost.wasCounted") : null,
              ].filter(Boolean).join(" · ");
              return (
                <CRow key={`${r.order_id}-${r.reason}`} image={r.image_url} seed={r.product_name ?? r.order_id ?? "?"}
                  name={r.customer_name ?? r.external_id ?? "—"} sub={<Place product={r.product_name} city={r.city} extra={detail} />}>
                  <span className={`pl h-${NONE_HUE[r.reason]}`}>{t(`lost.${r.reason}`)}</span>
                  {would !== null ? plus(would, "strike", "") : <span />}
                  <span className="plus">0</span>
                </CRow>
              );
            })}
            {more(lostRows.length - shown)}
          </div>
        )}
        {widen}
      </>
    );
  }

  return (
    <div className="com-root" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      {header}
      {!me.enabled && me.rate.off_since && (
        <div role="status" className="note h-amber">
          <Ic n="alert" />
          <span>{t("offBanner", { date: f.day(me.rate.off_since) })}</span>
        </div>
      )}
      {hero}
      {cards}
      {segRow}
      <section className="list">{list}</section>
      <p className="rule2">
        <Ic n="info" />
        <span>{t("rule2", { amount: rate !== null ? money(rate) : "—" })} {t("rule2More")}</span>
      </p>
      <div ref={tip.ref} className="tip" />
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

/** prototype `comRow`: thumb · name over « product · city » · whatever the tab puts on the right */
function CRow({ image, seed, name, sub, children }: { image: string | null; seed: string; name: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="crow">
      <Thumb src={image} seed={seed} />
      <div className="oc-t">
        <span className="nm" dir="auto">{name}</span>
        <div className="l2">{sub}</div>
      </div>
      {children}
    </div>
  );
}

function Place({ product, city, extra }: { product: string | null; city: string | null; extra?: string | null }) {
  return (
    <>
      {product && <b dir="auto">{product}</b>}
      {product && city ? " · " : ""}
      {city ?? ""}
      {extra ? ` · ${extra}` : ""}
    </>
  );
}

/** Whole days between two market-local calendar dates ("YYYY-MM-DD"). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
