"use client";

// A row of the agent's queue (prototype `qRowHTML`, `mRowHTML`, `marketHTML`): who and what, what was
// done, how long it has waited, how much. The tags say their number in words; the callback time is
// written on the row; a confirmed order shows « Envoyer » (a truck on a phone), never a phone.

import { memo, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ic, APill, type AgentHue } from "@/components/agent/shared";
import { RowTags, StatusPill, marketParts, type When } from "@/components/orders/commandes/ui";
import { ageTone, rowTags, CALLING_STATUSES } from "@/lib/orders/row-signals";
import { useRejectionBadge } from "@/hooks/useRejectionBadge";
import type { MarketSearchRow } from "@/lib/agent-search/market";
import type { QueueOrder } from "@/types/queue";
import { activityOf, type ClosedKey } from "./model";

type T = ReturnType<typeof useTranslations>;

/** « 45 min », « 2 h 15 », « 1 j 4 h » — the live row said « 45mn » and « 1d 4h ». */
export function ageLong(t: T, min: number) {
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return t("age.min", { n: m });
  if (m < 1440) return t("age.h", { h: Math.floor(m / 60), mm: String(m % 60).padStart(2, "0") });
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? t("age.dh", { d, h }) : t("age.d", { d });
}

const minutesSince = (iso: string | null | undefined, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / 60000 : 0);

const TINTS: [string, string][] = [
  ["#F4EDE2", "#8A5A1F"], ["#FDE8E8", "#B42318"], ["#E6F2EC", "#2F6B4F"], ["#EEF1E4", "#566428"], ["#FFF0D9", "#B54708"], ["#EEF2FF", "#3538CD"],
];

/** `thumbQ` — the product's tile with « ×2 » when there are several. */
export function QThumb({ src, seed, qty }: { src: string | null | undefined; seed: string; qty: number }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [bg, ink] = TINTS[h % TINTS.length];
  return (
    <span className="thumb" style={{ "--tb": bg, "--ti": ink } as CSSProperties}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Ic n="bag" />}
      {qty > 1 ? <span className="qx">×{qty}</span> : null}
    </span>
  );
}

export interface RowCtx {
  now: Date;
  marketId: string | null;
  when: When;
  maxAttempts: number;
  sla: number | null;
  /** The order's column is open — the row narrows (the city goes, it is the panel's first fact). */
  narrow: boolean;
  managerOn: (id: string) => string | null;
}

const productOf = (o: QueueOrder) => o.product_display_name || o.product_name;

/** Line 2: a WhatsApp reply, the product and variant, the city (or « ville ? »), the Darb account. */
function Line2({ o, ctx, phone }: { o: QueueOrder; ctx: RowCtx; phone?: boolean }) {
  const t = useTranslations("agentQueue");
  const narrow = phone || ctx.narrow;
  const bits: ReactNode[] = [];
  if (o.wa_unread) bits.push(<span key="wa" className="wa-in"><Ic n="wa" />{t("line.replied")}</span>);
  bits.push(<b key="p" dir="auto">{productOf(o)}{o.variant_label ? ` · ${o.variant_label}` : ""}</b>);
  if (!o.customer_city) bits.push(<span key="c" className="miss">{t("line.city")}</span>);
  else if (!narrow) bits.push(<span key="c" className="city" dir="auto">{o.customer_city}</span>);
  if (o.carrier_account_label && !narrow) {
    bits.push(<span key="car" className="carp" data-tip={o.carrier_name ?? undefined}>{(o.carrier_name ?? "").split(" ")[0]} · {o.carrier_account_label.fr}</span>);
  }
  return <>{bits.flatMap((b, i) => (i ? [" · ", b] : [b]))}</>;
}

/** The small signs of line 1: a manager inside, a changed address, a customer note. */
function Signs({ o, ctx }: { o: QueueOrder; ctx: RowCtx }) {
  const t = useTranslations("agentQueue");
  const mgr = ctx.managerOn(o.id);
  const addrChanged = !!o.last_known_address && !!o.customer_address && o.last_known_address.trim() !== o.customer_address.trim();
  return (
    <>
      {mgr ? <span className="av sm here2" style={{ "--h": "#475467" } as CSSProperties} data-tip={t("signs.manager", { name: mgr })}>{mgr.slice(0, 1).toUpperCase()}</span> : null}
      {addrChanged ? <span className="mini2" data-tip={t("signs.addr", { addr: o.last_known_address! })}><Ic n="pin" /></span> : null}
      {o.customer_note ? <span className="mini2" data-tip={t("signs.note", { note: o.customer_note })}><Ic n="msg" /></span> : null}
    </>
  );
}

/** « 18:30 » today, « demain 11:00 », else « 6 oct. 10:00 » (prototype `cbWhen`). */
function useCbWhen(ctx: RowCtx) {
  const t = useTranslations("agentQueue");
  return (iso: string) => {
    const { day, time } = marketParts(iso, ctx.marketId);
    if (day === marketParts(ctx.now.toISOString(), ctx.marketId).day) return time;
    if (day === marketParts(new Date(ctx.now.getTime() + 86_400_000).toISOString(), ctx.marketId).day) return t("act.tomorrow", { time });
    return ctx.when(iso, { now: ctx.now });
  };
}

/** The activity cell: a chip, and one line under it. */
export function Activity({ o, ctx, chipOnly }: { o: QueueOrder; ctx: RowCtx; chipOnly?: boolean }) {
  const t = useTranslations("agentQueue");
  const rejection = useRejectionBadge(ctx.marketId);
  const cbWhen = useCbWhen(ctx);
  const a = activityOf(o, ctx.now);
  let chip: { hue: AgentHue; icon: string; text: string } | null = null;
  let line: ReactNode = null;
  let no = false;
  let red = false;
  switch (a.kind) {
    case "new":
      line = t("act.never");
      no = true;
      break;
    case "attempt":
      chip = { hue: "amber", icon: "phone", text: `${a.n}/${ctx.maxAttempts}` };
      line = a.since ? t("act.called", { since: t("since", { age: ageLong(t, minutesSince(a.since, ctx.now)) }) }) : null;
      red = a.stale;
      break;
    case "callback":
      chip = a.due ? { hue: "red", icon: "clock", text: t("act.cbDue", { when: cbWhen(a.at) }) } : { hue: "violet", icon: "clock", text: t("act.cb", { when: cbWhen(a.at) }) };
      line = t("act.cbLine", { n: a.n, max: ctx.maxAttempts });
      break;
    case "scheduled":
      chip = { hue: "violet", icon: "cal", text: a.at ? t("act.send", { when: cbWhen(a.at) }) : t("act.sendLine") };
      line = t("act.sendLine");
      break;
    case "confirmed":
      chip = { hue: "violet", icon: "check", text: t("act.confirmed") };
      line = a.since ? t("act.confLine", { since: t("since", { age: ageLong(t, minutesSince(a.since, ctx.now)) }) }) : null;
      break;
    default:
      break;
  }
  if (a.kind === "other") {
    return (
      <div className="actv">
        <span>
          <StatusPill o={{ status: o.status, rejection_reason: o.rejection_reason, rejection_subreason: o.rejection_subreason, rejection_note: o.rejection_note, attempts_count: o.attempt_count }} maxAttempts={ctx.maxAttempts} rejection={rejection} when={ctx.when} now={ctx.now} />
        </span>
        {!chipOnly ? <small>{o.status === "rejected" ? t("act.rejected") : o.tracking_number ? <span className="num">{o.tracking_number}</span> : null}</small> : null}
      </div>
    );
  }
  if (chipOnly) return chip ? <span className={`chipm h-${chip.hue}`}><Ic n={chip.icon} />{chip.text}</span> : <span className="chipm plain">{t("act.never")}</span>;
  return (
    <div className="actv">
      {chip ? <span><APill hue={chip.hue} icon={chip.icon} text={chip.text} /></span> : null}
      <small className={no ? "no" : ""} style={red ? { color: "var(--bad)", fontWeight: 800 } : undefined}>{line}</small>
    </div>
  );
}

/** The age with the gauge the agents know — 0 to 24 h, coloured only when owed and late. */
function AgeCell({ o, ctx, closedAt }: { o: QueueOrder; ctx: RowCtx; closedAt?: string | null }) {
  const t = useTranslations("agentQueue");
  if (closedAt !== undefined) {
    const d = closedAt ? Math.floor(minutesSince(closedAt, ctx.now) / 1440) : 0;
    return <div className="agew"><span className="age">{d === 0 ? t("closedAge.today") : d === 1 ? t("closedAge.yday") : t("closedAge.days", { n: d })}</span></div>;
  }
  const age = minutesSince(o.created_at, ctx.now);
  const cls = ageTone({ status: o.status, created_at: o.created_at, callback_scheduled_at: o.callback_time }, ctx.sla, ctx.now);
  const pct = Math.min(100, Math.round((age / 1440) * 100));
  const tip = t("ageTip", { when: ctx.when(o.created_at, { now: ctx.now }) }) + (cls ? t("ageLate", { h: Math.round((ctx.sla ?? 120) / 60) }) : "");
  return (
    <div className="agew" data-tip={tip}>
      <span className={`age ${cls}`}>{cls ? <Ic n="clock" /> : null}{ageLong(t, age)}</span>
      <span className={`gauge ${cls}`}><i style={{ width: `${Math.max(4, pct)}%` }} /></span>
    </div>
  );
}

const tagInput = (o: QueueOrder) => ({
  status: o.status,
  prior_order_count: o.prior_order_count,
  prior_rejected_count: o.prior_rejected_count,
  prior_delivered_count: o.prior_delivered_count ?? 0,
  is_potential_duplicate: o.is_potential_duplicate,
  duplicate_count: o.duplicate_count,
  has_uploaded_sibling: o.has_uploaded_sibling,
});

export interface DeskRowProps {
  o: QueueOrder;
  ctx: RowCtx;
  open: boolean;
  focused: boolean;
  selected: boolean;
  closedAt?: string | null;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onSend: (id: string) => void;
}

function DeskRowInner({ o, ctx, open, focused, selected, closedAt, onOpen, onToggle, onSend }: DeskRowProps) {
  const t = useTranslations("agentQueue");
  const calling = CALLING_STATUSES.has(o.status);
  return (
    <div
      className={`row qr${selected ? " sel" : ""}${open ? " open" : ""}${focused ? " kf" : ""}`}
      data-open={o.id}
      tabIndex={-1}
      onClick={() => onOpen(o.id)}
    >
      {calling ? (
        <button
          type="button"
          className={`ck${selected ? " on" : ""}`}
          aria-label={t("select", { ref: o.external_id ?? o.id.slice(0, 8) })}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(o.id);
          }}
        >
          {selected ? <Ic n="check" /> : null}
        </button>
      ) : (
        <span />
      )}
      <div className="oc">
        <QThumb src={o.product_image_url} seed={productOf(o)} qty={o.quantity} />
        <div className="oc-t">
          <div className="l1">
            <span className="nm" dir="auto">{o.customer_name}</span>
            <Signs o={o} ctx={ctx} />
            <RowTags tags={rowTags(tagInput(o))} />
          </div>
          <div className="l2"><Line2 o={o} ctx={ctx} /></div>
        </div>
      </div>
      {o.status === "confirmed" && !ctx.narrow ? (
        <div className="actv">
          <span><APill hue="violet" icon="check" text={t("act.confirmed")} /></span>
          <button
            type="button"
            className="sendb"
            onClick={(e) => {
              e.stopPropagation();
              onSend(o.id);
            }}
          >
            <Ic n="truck" />
            {t("act.sendBtn")}
          </button>
        </div>
      ) : (
        <Activity o={o} ctx={ctx} />
      )}
      <AgeCell o={o} ctx={ctx} closedAt={closedAt} />
      <div className="amt">{fmtAmount(o.total_price)}<small>{o.currency}</small></div>
    </div>
  );
}
export const DeskRow = memo(DeskRowInner);

export function fmtAmount(n: number) {
  return <span className="num">{Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/\s/g, " ")}</span>;
}

export interface PhoneRowProps {
  o: QueueOrder;
  ctx: RowCtx;
  closed: boolean;
  onOpen: (id: string) => void;
  onCall: (o: QueueOrder) => void;
  onSend: (o: QueueOrder) => void;
}

/** `mRowHTML` — who and what, then how long and how many calls, the call at the end. */
function PhoneRowInner({ o, ctx, closed, onOpen, onCall, onSend }: PhoneRowProps) {
  const t = useTranslations("agentQueue");
  const age = minutesSince(o.created_at, ctx.now);
  const cls = ageTone({ status: o.status, created_at: o.created_at, callback_scheduled_at: o.callback_time }, ctx.sla, ctx.now);
  const tags = rowTags(tagInput(o)).slice(0, 1);
  const btn =
    closed || o.status === "dispatch_scheduled" ? null : o.status === "confirmed" ? (
      <button type="button" className="callb up" aria-label={t("phone.send")} onClick={(e) => { e.stopPropagation(); onSend(o); }}>
        <Ic n="truck" />
      </button>
    ) : (
      <a
        className="callb"
        href={`tel:${o.customer_phone}`}
        aria-label={t("phone.call")}
        onClick={(e) => {
          e.stopPropagation();
          onCall(o);
        }}
      >
        <Ic n="phone" />
      </a>
    );
  return (
    <div className="mrow" data-open={o.id} onClick={() => onOpen(o.id)}>
      <div className="mid">
        <QThumb src={o.product_image_url} seed={productOf(o)} qty={o.quantity} />
        <div className="oc-t">
          <span className="nm" dir="auto">{o.customer_name}</span>
          <div className="l2"><Line2 o={o} ctx={ctx} phone /></div>
        </div>
      </div>
      <span className="amt">{fmtAmount(o.total_price)}<small>{o.currency}</small></span>
      {btn ?? <span className="cbx" />}
      <div className="meta">
        <Activity o={o} ctx={ctx} chipOnly />
        {closed ? null : <span className={`age ${cls}`}>{cls ? <Ic n="clock" /> : null}{ageLong(t, age)}</span>}
        <RowTags tags={tags} />
      </div>
    </div>
  );
}
export const PhoneRow = memo(PhoneRowInner);

/** `marketHTML` — the rest of the market, read-only, under the agent's own results. */
export function MarketRows({ rows, ctx, onView }: { rows: MarketSearchRow[]; ctx: RowCtx; onView: (id: string) => void }) {
  const t = useTranslations("agentQueue");
  const rejection = useRejectionBadge(ctx.marketId);
  if (!rows.length) return null;
  return (
    <section className="list">
      <div className="lh" style={{ display: "flex", alignItems: "center", gap: 10, paddingInline: 18 }}>
        <Ic n="lock" />
        <span>{t("market.title")}</span>
        <span className="pl h-neutral" style={{ height: 21, textTransform: "none", letterSpacing: 0 }}>{t("market.readOnly")}</span>
      </div>
      <div className="rows">
        {rows.map((r) => (
          <div key={r.id} className="row qr" data-ro={r.id} tabIndex={-1} onClick={() => onView(r.id)}>
            <span className="ck" style={{ border: 0, background: "none", color: "var(--ink-3)" }}><Ic n="eye" /></span>
            <div className="oc">
              <QThumb src={null} seed={r.product_name ?? r.id} qty={1} />
              <div className="oc-t">
                <div className="l1">
                  <span className="nm" dir="auto">{r.customer_name}</span>
                  {r.external_id ? <span className="q num" style={{ fontSize: 12 }}>#{r.external_id}</span> : null}
                </div>
                <div className="l2"><b dir="auto">{r.product_name}</b>{r.customer_phone ? <> · <span className="num">{r.customer_phone}</span></> : null}</div>
              </div>
            </div>
            <div className="actv">
              <span><StatusPill o={{ status: r.status }} maxAttempts={ctx.maxAttempts} rejection={rejection} when={ctx.when} now={ctx.now} /></span>
              <small>
                {r.owner_name ? <span className="who2">{t("market.with", { name: r.owner_name })}</span> : <span className="who2 q">{t("market.free")}</span>}
              </small>
            </div>
            <div className="agew"><span className="age">{ageLong(t, minutesSince(r.created_at, ctx.now))}</span></div>
            <div className="amt">{fmtAmount(r.total_price ?? 0)}<small>{r.currency}</small></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export type { ClosedKey };
