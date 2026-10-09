"use client";

/**
 * The parcel panel (prototype v5): it reads top-down —
 *   who and how long · why (the courier's words) · what to do · details · history.
 * Floating on desktop (§4.9), full screen under 640 px.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, CalendarCheck, CheckCircle2, Clock, History, MessageCircle, MinusCircle, NotebookPen, Package, Phone, Target, X, XCircle } from "lucide-react";
import type { TimelineEntry, WorklistRow } from "@/lib/delivery/types";
import { formatPhone, moveFor, orderRef, quickOutcomesFor, situationOf, type QuickOutcome } from "@/lib/delivery/presentation";
import { useDeliveryTimeline } from "@/hooks/useDeliveryTimeline";
import { DeliveryMessages } from "../DeliveryMessages";
import { Money, WhatsAppIcon, useDuration, useWhen } from "../ui";
import { Avatar, SitChip, Thumb } from "./parts";

const QUICK_ICON: Record<QuickOutcome["tone"], typeof CheckCircle2> = {
  green: CheckCircle2, grey: XCircle, blue: CalendarCheck, red: MinusCircle, amber: CheckCircle2,
};

export interface DrawerHandlers {
  onLogAction: (row: WorklistRow, type?: "call_customer" | "call_courier" | "call_branch" | "note") => void;
  onWhatsApp: (row: WorklistRow) => void;
  /** A tel: link was followed — open the sheet so the call gets logged. */
  onDialed: (row: WorklistRow) => void;
  onQuick: (row: WorklistRow, outcome: QuickOutcome) => void;
  onReassign: (row: WorklistRow) => void;
}

function Timeline({ row, locale, tz, now }: { row: WorklistRow; locale: string; tz: string; now: number }) {
  const t = useTranslations("delivery");
  const tm = useTranslations("delivery.manager.drawer");
  const tStatus = useTranslations("orders.statuses");
  const when = useWhen(now, tz, locale);
  const [all, setAll] = useState(false);
  const { timeline, isLoading } = useDeliveryTimeline(row.order_id, locale === "ar" ? "ar" : "fr");
  const title = (e: TimelineEntry) => {
    if (e.source === "order") return tStatus.has(e.kind) ? tStatus(e.kind) : e.kind;
    if (e.source === "remark") return e.actor ?? t("timeline.courier_message");
    if (e.source === "carrier") return e.text ?? e.kind;
    const type = t.has(`sheet.types.${e.kind}`) ? t(`sheet.types.${e.kind}`) : t.has(`timeline.${e.kind}`) ? t(`timeline.${e.kind}`) : e.kind;
    const outcome = e.outcome && t.has(`sheet.outcomes.${e.outcome}`) ? t(`sheet.outcomes.${e.outcome}`) : "";
    const who = e.mine ? t("timeline.you") : e.actor;
    return [who, outcome ? `${type} · ${outcome}` : type].filter(Boolean).join(" · ");
  };
  const detail = (e: TimelineEntry) =>
    e.source === "remark" ? (e.text ? `« ${e.text} »` : null) : e.source === "carrier" ? e.actor : e.source === "action" ? e.text : null;
  const items = all ? timeline : timeline.slice(0, 3);
  return (
    <section className="tl5">
      <div className="lbl"><History className="ic" />{tm("timeline")}</div>
      {isLoading ? <div className="skel" style={{ height: 80 }} /> : timeline.length === 0 ? <p className="none">{tm("noEvents")}</p> : (
        <ol>
          {items.map((e, i) => (
            <li key={`${e.source}-${e.id}`} className={i === 0 ? "now" : undefined}>
              <i aria-hidden />
              <span><b>{title(e)}</b>{detail(e) ? <em>{detail(e)}</em> : null}</span>
              <small>{when(e.at)}</small>
            </li>
          ))}
        </ol>
      )}
      {timeline.length > 3 ? (
        <button type="button" className="lnk5" onClick={() => setAll((v) => !v)}>{all ? tm("less") : tm("seeAll", { n: timeline.length })}</button>
      ) : null}
    </section>
  );
}

export function ParcelDrawer({ row, late, agentColor, market, locale, tz, now, marketId, whatsappActive, whatsappKnown, onClose, ...h }: DrawerHandlers & {
  row: WorklistRow; late: boolean; agentColor: string | null; market: "ly" | "tn"; locale: string; tz: string; now: number;
  marketId: string | null; whatsappActive: boolean; whatsappKnown: boolean; onClose: () => void;
}) {
  const t = useTranslations("delivery");
  const tm = useTranslations("delivery.manager");
  const duration = useDuration();
  const when = useWhen(now, tz, locale);
  const s = situationOf(row, now);
  const m = moveFor(row, now);
  const quick = quickOutcomesFor(m);
  const done = row.bucket === "done";
  const item = row.items[0];
  const courierPhone = row.handler_phone ?? row.handler_account_phone;

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="dr5" role="dialog" aria-modal="true" aria-label={row.customer_name ?? orderRef(row)}>
        <header className="h5">
          <div className="h5-top">
            <SitChip sit={s.key} label={t(`sit.${s.key}`)} />
            {!done ? (
              <span className={`h5-wait${late ? " late" : ""}`}><Clock className="ic" />{tm("drawer.since", { age: duration(row.hours_on_status ?? 0) })}{late ? ` · ${tm("late")}` : ""}</span>
            ) : null}
            <button type="button" className="ib x5" aria-label={tm("drawer.close")} onClick={onClose}><X className="ic" /></button>
          </div>
          <div className="h5-who">
            <h3><bdi>{row.customer_name ?? "—"}</bdi></h3>
            <span className="h5-amt"><Money amount={row.total_price} market={market} locale={locale} /></span>
          </div>
          <div className="h5-meta">
            <bdi dir="ltr">#{orderRef(row)}</bdi>
            {row.customer_city ? <><i>·</i><bdi>{row.customer_city}</bdi></> : null}
            <i>·</i>
            {row.assigned_to ? <><Avatar id={row.assigned_to} name={row.agent_name} color={agentColor} small />{row.agent_name}</> : <span className="none">{tm("f.noAgent")}</span>}
          </div>
        </header>

        <div className="b5">
          {row.latest_remark ? (
            <section className="why5">
              <div className="lbl"><MessageCircle className="ic" />{tm("drawer.remark")}{row.latest_remark_at ? <span>{when(row.latest_remark_at)}</span> : null}</div>
              <p>« <bdi>{row.latest_remark}</bdi> »</p>
              {row.handler_name || row.carrier_name ? (
                <div className="who5">
                  <bdi>{[row.handler_name, row.carrier_name].filter(Boolean).join(" · ")}</bdi>
                  {courierPhone && !done ? (
                    <a className="lnk5" href={`tel:${courierPhone}`} onClick={() => h.onLogAction(row, "call_courier")}><Phone className="ic" />{tm("drawer.callCourier")}</a>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {!done ? (
            <section className="act5">
              <div className="lbl"><Target className="ic" />{tm("drawer.todo")}</div>
              <div className="mv5">{t(`moves.${m.kind}`)}</div>
              {m.whatsapp ? (
                <div className="call5"><button type="button" className="callbtn" onClick={() => h.onWhatsApp(row)}><WhatsAppIcon size={20} />{t("moves.wa")}</button></div>
              ) : m.dial ? (
                <div className="call5">
                  <a className="callbtn" href={`tel:${m.dial}`} onClick={() => h.onDialed(row)} aria-label={t("detail.callNumber", { phone: formatPhone(m.dial) })}>
                    <Phone className="ic" style={{ width: 20, height: 20 }} /><bdi dir="ltr">{formatPhone(m.dial)}</bdi>
                  </a>
                  <button type="button" className="wa5" aria-label={tm("drawer.wa")} onClick={() => h.onWhatsApp(row)}><WhatsAppIcon size={20} /></button>
                </div>
              ) : null}
              {quick.length > 0 ? (
                <>
                  <div className="lbl sub5">{tm("drawer.outcome")}</div>
                  <div className="q5" role="group" aria-label={tm("drawer.outcome")}>
                    {quick.map((q) => {
                      const Icon = QUICK_ICON[q.tone];
                      return <button key={q.outcome} type="button" className={q.tone} onClick={() => h.onQuick(row, q)}><Icon className="ic" /><span>{t(`quick.${q.outcome}`)}</span></button>;
                    })}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          <section className="det5">
            <div className="lbl"><Package className="ic" />{tm("drawer.details")}</div>
            <div className="prod5">
              <Thumb item={item} />
              <div>
                <b>{item ? `${item.product_name ?? "—"}${item.variant_label ? ` · ${item.variant_label}` : ""}` : "—"}</b>
                <small><bdi dir="ltr">×{item?.quantity ?? 1}</bdi>{row.items.length > 1 ? ` +${row.items.length - 1}` : ""} · {tm("drawer.cod")}</small>
              </div>
            </div>
            <dl className="g5">
              <div><dt>{tm("drawer.phones")}</dt><dd>
                {[row.customer_phone, row.customer_phone_2].filter(Boolean).map((ph, i) => (
                  <span key={ph}>{i > 0 ? " · " : ""}<a href={`tel:${ph}`} onClick={() => h.onDialed(row)}><bdi dir="ltr">{formatPhone(ph)}</bdi></a></span>
                ))}
                {!row.customer_phone && !row.customer_phone_2 ? "—" : null}
              </dd></div>
              <div><dt>{tm("drawer.tracking")}</dt><dd><bdi dir="ltr">{row.tracking_number ?? "—"}</bdi></dd></div>
              <div className="wide"><dt>{tm("drawer.address")}</dt><dd><bdi>{[row.customer_city, row.customer_address].filter(Boolean).join(" · ") || "—"}</bdi></dd></div>
              <div><dt>{tm("drawer.carrier")}</dt><dd>{row.carrier_name ?? "—"}</dd></div>
              <div><dt>{tm("drawer.courier")}</dt><dd>{row.handler_name ? <bdi>{row.handler_name}</bdi> : "—"}{courierPhone ? <> · <bdi dir="ltr">{formatPhone(courierPhone)}</bdi></> : null}</dd></div>
              <div className="wide"><dt>{tm("drawer.history")}</dt><dd>
                {(row.customer_orders_count ?? 0) > 1 ? (
                  <span className="hist5">
                    <span>{tm("drawer.orders", { n: row.customer_orders_count ?? 0 })}</span>
                    <span className="g"><i />{tm("drawer.delivered", { n: row.customer_delivered_count ?? 0 })}</span>
                    <span className="r"><i />{tm("drawer.returned", { n: row.customer_returned_count ?? 0 })}</span>
                  </span>
                ) : tm("drawer.newCustomer")}
              </dd></div>
            </dl>
          </section>

          <Timeline row={row} locale={locale} tz={tz} now={now} />
          {(whatsappActive || whatsappKnown) && marketId ? (
            <DeliveryMessages orderId={row.order_id} marketId={marketId} onOpenSheet={() => h.onWhatsApp(row)} />
          ) : null}
        </div>

        {!done ? (
          <footer className="f5">
            <button type="button" className="btn sec" onClick={() => h.onReassign(row)}><ArrowLeftRight className="ic" />{tm("drawer.reassign")}</button>
            <button type="button" className="btn pri" onClick={() => h.onLogAction(row)}><NotebookPen className="ic" />{tm("drawer.log")}</button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}
