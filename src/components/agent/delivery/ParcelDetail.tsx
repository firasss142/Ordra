"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { TimelineEntry, WorklistRow } from "@/lib/delivery/types";
import type { AgentActionType } from "@/lib/delivery/actions";
import { formatPhone } from "@/lib/delivery/presentation";
import { actOf, journalKind, relOf, sinceMinutes, sitOf, SIT_LOOK } from "@/lib/delivery/agent-view";
import { useDeliveryTimeline } from "@/hooks/useDeliveryTimeline";
import { useWhatsAppThread } from "@/hooks/useWhatsAppThread";
import { MessageThread } from "@/components/whatsapp/MessageThread";
import { StatusPill, useWhen as useCommandesWhen } from "@/components/orders/commandes/ui";
import { APill, Ic } from "@/components/agent/shared";
import { useDayWhen, useDur, useMoneyText } from "./words";

/** The four one-tap results with the customer, and the four with the courier (prototype TILES_C / TILES_K). */
export const TILES_C: [string, string, string][] = [
  ["reached_will_receive", "green", "check"], ["no_answer", "amber", "phoneoff"],
  ["reached_reschedule", "violet", "cal"], ["reached_wants_cancel", "red", "thumbdown"],
];
export const TILES_K: [string, string, string][] = [
  ["reattempt_promised", "teal", "rotate"], ["courier_no_answer", "amber", "phoneoff"],
  ["parcel_located", "green", "pin"], ["return_confirmed", "red", "back"],
];

export interface ParcelHandlers {
  /** A number was dialled from the page (the tel: link follows). */
  onDial: (row: WorklistRow, num: string, courier?: boolean) => void;
  onWhatsApp: (row: WorklistRow) => void;
  onQuick: (row: WorklistRow, outcome: string, actionType: AgentActionType) => void;
  onLog: (row: WorklistRow) => void;
  onCopy: (text: string) => void;
}

type JF = "all" | "act" | "car";

/** dlvDetail(p, phone): the parcel, its next move, the one-tap results, then everything known about it. */
export function ParcelDetail({ row, phone, now, tz, locale, market, marketId, whatsappOn, onClose, handlers }: {
  row: WorklistRow;
  phone: boolean;
  now: number;
  tz: string;
  locale: string;
  market: "ly" | "tn";
  marketId: string | null;
  /** The market's WhatsApp connection is known — the thread can be read. */
  whatsappOn: boolean;
  onClose: () => void;
  handlers: ParcelHandlers;
}) {
  const t = useTranslations("agentDelivery");
  const sit = sitOf(row, now);
  const look = SIT_LOOK[sit];
  const a = actOf(row, now);
  const done = row.bucket === "done";
  const dur = useDur();
  const money = useMoneyText(market);
  const rel = relOf(row);
  const courierPhone = row.handler_phone ?? row.handler_account_phone;
  const dial = a.num ?? row.customer_phone;
  const courierAction: AgentActionType = a.actionType === "call_branch" ? "call_branch" : "call_courier";
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const callBtn = (cls: string) =>
    a.wa || !dial ? (
      <button type="button" className={`${cls} wa`} onClick={() => handlers.onWhatsApp(row)}>
        <Ic n="wa" /><span>{t("act.wa")}</span>
      </button>
    ) : (
      <a className={cls} href={`tel:${dial}`} onClick={() => handlers.onDial(row, dial)}>
        <Ic n="phone" /><span>{t("detail.callShort")} <span className="num">{formatPhone(dial)}</span></span>
      </a>
    );

  const items = row.items;
  const content = items.length
    ? items.map((it) => `${it.product_name ?? ""}${it.variant_label ? ` · ${it.variant_label}` : ""}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(" + ")
    : "—";

  return (
    <>
      {!phone && (
        <div className="dr-top">
          <APill hue={look.hue} icon={look.icon} text={t(`sit.${sit}.label`)} />
          <span className="dr-age">{t("detail.since", { d: dur(sinceMinutes(row, now)) })}</span>
          <span className="sp" />
          {row.tracking_number && (
            <button type="button" className="ref" aria-label={t("detail.copy")} data-tip={t("detail.copy")} onClick={() => handlers.onCopy(row.tracking_number!)}>
              <Ic n="copy" />{row.tracking_number}
            </button>
          )}
          <div className="fbw" ref={menuRef}>
            <button type="button" className="xbtn" aria-label={t("detail.more")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Ic n="more" />
            </button>
            {menu && (
              <div className="menu end" role="menu">
                {!done && (
                  <button type="button" role="menuitem" className="mi act" onClick={() => { setMenu(false); handlers.onLog(row); }}>
                    <Ic n="check" /><span className="ml">{t("detail.logAction")}</span>
                  </button>
                )}
                {!done && (
                  <button type="button" role="menuitem" className="mi act" onClick={() => { setMenu(false); handlers.onWhatsApp(row); }}>
                    <Ic n="wa" /><span className="ml">WhatsApp</span>
                  </button>
                )}
                <button type="button" role="menuitem" className="mi act" onClick={() => { setMenu(false); onClose(); }}>
                  <Ic n="x" /><span className="ml">{t("detail.close")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="dr-body">
        <div className="pc" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
          <div className="pc-n"><h2 dir="auto">{row.customer_name}</h2></div>
          <div className="pc-ph">
            <span className={`rel h-${rel.hue}`}>
              {rel.kind === "risk" ? <Ic n="alert" /> : rel.kind === "reliable" ? <Ic n="check" /> : rel.kind === "mid" ? <Ic n="help" /> : null}
              {t(`rel.${rel.kind}`, { n: rel.n, del: rel.del, bad: rel.bad })}
            </span>
          </div>
        </div>

        <div className={`nextc h-${look.hue}`}>
          <small>{t("detail.next")}</small>
          <b>{t(`act.${a.key}`)}</b>
          <span>{t(`sit.${sit}.why`)}</span>
          {!done && callBtn("btn")}
        </div>

        {!done && (
          <div className="blk2">
            <h6>{t("detail.callResult")} · {t("detail.client")}</h6>
            <div className="oc4 sm">
              {TILES_C.map(([k, h, i]) => (
                <button key={k} type="button" className={`oct h-${h}`} onClick={() => handlers.onQuick(row, k, "call_customer")}>
                  <Ic n={i} />{t(`quick.${k}`)}
                </button>
              ))}
            </div>
            <h6 style={{ marginTop: 12 }}>{t("detail.callResult")} · {t("detail.courier")}</h6>
            <div className="oc4 sm">
              {TILES_K.map(([k, h, i]) => (
                <button key={k} type="button" className={`oct h-${h}`} onClick={() => handlers.onQuick(row, k, courierAction)}>
                  <Ic n={i} />{t(`quick.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="blk2">
          <h6>{t("detail.clientInfo")}</h6>
          <dl className="facts sm">
            {row.customer_phone && (
              <>
                <dt>{t("detail.phone1")}</dt>
                <dd><a href={`tel:${row.customer_phone}`} onClick={() => handlers.onDial(row, row.customer_phone!)}><span className="num">{formatPhone(row.customer_phone)}</span></a></dd>
              </>
            )}
            {row.customer_phone_2 && (
              <>
                <dt>{t("detail.phone2")}</dt>
                <dd>
                  <a href={`tel:${row.customer_phone_2}`} onClick={() => handlers.onDial(row, row.customer_phone_2!)}><span className="num">{formatPhone(row.customer_phone_2)}</span></a>
                  {a.key === "call2" && !done && <span className="tg h-green">{t("detail.recommended")}</span>}
                </dd>
              </>
            )}
            <dt>{t("detail.address")}</dt>
            <dd>{row.customer_city ?? ""}{row.customer_address ? <>, <span dir="auto">{row.customer_address}</span></> : null}</dd>
          </dl>
        </div>

        <div className="blk2">
          <h6>{t("detail.carrier")}{row.carrier_name ? ` · ${row.carrier_name}` : ""}</h6>
          <dl className="facts sm">
            <dt>{t("detail.courierName")}</dt>
            <dd dir="auto">{row.handler_name ?? row.handler_account_name ?? t("detail.notYet")}</dd>
            {courierPhone && (
              <>
                <dt>{t("detail.courierPhone")}</dt>
                <dd>
                  <span className="num">{formatPhone(courierPhone)}</span>
                  {!done && (
                    <a className="lnk" href={`tel:${courierPhone}`} onClick={() => handlers.onDial(row, courierPhone, true)}>
                      <Ic n="phone" />{t("detail.callCourier")}
                    </a>
                  )}
                </dd>
              </>
            )}
            <dt>{t("detail.status")}</dt>
            <dd><DeliveryStatus status={row.status} marketId={marketId} locale={locale} /></dd>
            {row.latest_remark && (
              <>
                <dt>{t("detail.courierMsg")}</dt>
                <dd dir="auto">« {row.latest_remark} »</dd>
              </>
            )}
          </dl>
        </div>

        <div className="blk2">
          <h6>{t("detail.parcel")}</h6>
          <dl className="facts sm">
            {row.tracking_number && (
              <>
                <dt>{t("detail.tracking")}</dt>
                <dd>
                  <span className="num">{row.tracking_number}</span>
                  <button type="button" className="mini" aria-label={t("detail.copy")} onClick={() => handlers.onCopy(row.tracking_number!)}><Ic n="copy" /></button>
                </dd>
              </>
            )}
            <dt>{t("detail.content")}</dt>
            <dd dir="auto">{content} · {money(row.total_price)}</dd>
            <dt>{t("detail.created")}</dt>
            <dd><Created iso={row.created_at} tz={tz} now={now} locale={locale} /></dd>
          </dl>
        </div>

        <Journal orderId={row.order_id} tz={tz} now={now} locale={locale} />
        <Messages orderId={row.order_id} marketId={whatsappOn ? marketId : null} />
      </div>
      {phone && !done && (
        <div className="dr-foot mfoot">
          {callBtn("fa pri wide")}
          <button type="button" className="fa" onClick={() => handlers.onLog(row)}>
            <Ic n="check" /><span>{t("detail.saveShort")}</span>
          </button>
        </div>
      )}
    </>
  );
}

function Created({ iso, tz, now, locale }: { iso: string | null; tz: string; now: number; locale: string }) {
  const when = useDayWhen(tz, now, locale);
  return <>{iso ? when(iso) : "—"}</>;
}

function DeliveryStatus({ status, marketId, locale }: { status: string; marketId: string | null; locale: string }) {
  const when = useCommandesWhen(marketId, locale);
  return <StatusPill o={{ status }} maxAttempts={null} rejection={() => null} when={when} />;
}

/** « Journal d'activité » — Tout / Actions / Transporteur (prototype journal()). */
function Journal({ orderId, tz, now, locale }: { orderId: string; tz: string; now: number; locale: string }) {
  const t = useTranslations("agentDelivery");
  const tStatus = useTranslations("orders.statuses");
  const tWa = useTranslations("whatsapp");
  const when = useDayWhen(tz, now, locale);
  const [jf, setJf] = useState<JF>("all");
  const { timeline } = useDeliveryTimeline(orderId, locale === "ar" ? "ar" : "fr");
  const shown = timeline.filter((e) => jf === "all" || journalKind(e.source) === jf);

  const text = (e: TimelineEntry): string => {
    if (e.source === "order") return tStatus.has(e.kind) ? tStatus(e.kind) : e.kind;
    if (e.source === "remark") return `${e.actor ?? t("detail.courierName")} : « ${e.text ?? ""} »`;
    if (e.source === "carrier") return [e.text ?? e.kind, e.actor].filter(Boolean).join(" · ");
    const who = e.mine ? t("detail.you") : e.actor ?? t("detail.system");
    if (e.kind === "whatsapp_customer") {
      const label = e.template_key && tWa.has(`templates.${e.template_key}`) ? tWa(`templates.${e.template_key}`) : tWa("thread.template");
      return `${who} · ${tWa("trace.timeline", { label })}`;
    }
    const type = t.has(`sheet.whos.${e.kind}`) ? t(`sheet.whos.${e.kind}`) : e.kind;
    const outcome = e.outcome && t.has(`sheet.outcomes.${e.outcome}`) ? t(`sheet.outcomes.${e.outcome}`) : null;
    return [who, type, outcome].filter(Boolean).join(" · ") + (e.text ? ` — « ${e.text} »` : "");
  };

  return (
    <div className="blk2">
      <h6>{t("detail.journal")}</h6>
      <div className="seg sm2">
        {(["all", "act", "car"] as JF[]).map((k) => (
          <button key={k} type="button" className={jf === k ? "on" : ""} aria-pressed={jf === k} onClick={() => setJf(k)}>{t(`detail.jf.${k}`)}</button>
        ))}
      </div>
      <ul className="tl">
        {shown.length === 0 ? (
          <li className="h-neutral">{t("detail.nothing")}</li>
        ) : (
          shown.map((e) => {
            const k = journalKind(e.source);
            return (
              <li key={`${e.source}-${e.id}`} className={`h-${k === "act" ? "violet" : k === "car" ? "teal" : "neutral"}`}>
                <time>{when(e.at)}</time>
                <span dir="auto">{text(e)}</span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/** « Messages » — what was said on WhatsApp with this customer, read-only; sending is the sheet's. */
function Messages({ orderId, marketId }: { orderId: string; marketId: string | null }) {
  const t = useTranslations("agentDelivery");
  const { thread } = useWhatsAppThread(marketId ? { order_id: orderId, market_id: marketId } : null);
  const messages = thread?.messages ?? [];
  return (
    <div className="blk2">
      <h6>{t("detail.messages")}</h6>
      {messages.length ? (
        <MessageThread messages={messages.slice(-8)} conversation={thread?.conversation ?? null} highlightUnread={false} />
      ) : (
        <p className="q" style={{ fontSize: 13 }}>{t("detail.noMessages")}</p>
      )}
    </div>
  );
}
