"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar, CalendarCheck, CheckCircle2, FileText, MapPin, MinusCircle, MoreHorizontal, NotebookPen, Phone, RotateCcw, Truck, User, X, Check, XCircle } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { formatPhone, moveFor, orderRef, quickOutcomesFor, situationOf, type MoveKind, type QuickOutcome } from "@/lib/delivery/presentation";
import { DeliveryTimeline } from "./DeliveryTimeline";
import { DeliveryMessages } from "./DeliveryMessages";
import { Chip, Ltr, Money, OUTLINE_BTN, PRIMARY_BTN, ProductThumb, SIT_ICON, TONE, WhatsAppIcon, type IconComponent, useSituationLabel } from "./ui";

const MOVE_ICON: Record<MoveKind, IconComponent> = {
  call2: Phone, call: Phone, before: Phone, courier: Phone, save: RotateCcw, wa: WhatsAppIcon, track: Truck, details: Check,
};

/** One tile per outcome: its glyph, and the tint it takes so the four read at a glance. */
const QUICK_STYLE: Record<QuickOutcome["tone"], { icon: IconComponent; cls: string }> = {
  green: { icon: CheckCircle2, cls: "border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]" },
  grey: { icon: XCircle, cls: "border-[#D1D5DB] bg-white text-[#374151]" },
  blue: { icon: CalendarCheck, cls: "border-[#93C5FD] bg-[#EFF6FF] text-[#1D4ED8]" },
  red: { icon: MinusCircle, cls: "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]" },
  amber: { icon: CheckCircle2, cls: "border-[#FBBF24] bg-[#FFFBEB] text-[#92400E]" },
};

export interface DetailHandlers {
  onLogAction: (row: WorklistRow, type?: "call_customer" | "call_courier" | "call_branch" | "note") => void;
  onWhatsApp: (row: WorklistRow) => void;
  /** A tel: link was followed — open the sheet so the call gets logged. */
  onDialed: (row: WorklistRow) => void;
  /** One of the four outcome tiles was tapped: record it, no sheet. */
  onQuick: (row: WorklistRow, outcome: QuickOutcome) => void;
}

interface Props extends DetailHandlers {
  row: WorklistRow;
  market: "ly" | "tn";
  locale: string;
  tz: string;
  now: number;
  /** The market's uuid and whether its WhatsApp business number is live. */
  marketId?: string | null;
  whatsappActive?: boolean;
  whatsappKnown?: boolean;
}

function useCreated(locale: string, tz: string) {
  return (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", {
          timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).format(new Date(iso)).replace(/ (?:à|في) (\d{2}:\d{2})$/, " · $1")
      : "—";
}

const card = "rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5";
const line = "flex min-w-0 items-center gap-2 py-[3px] text-[13.5px] text-[#111827] text-start";

/** The four one-tap outcomes under the recommended call. */
function QuickOutcomes({ row, now, onQuick }: { row: WorklistRow; now: number; onQuick: DetailHandlers["onQuick"] }) {
  const t = useTranslations("delivery");
  const quick = quickOutcomesFor(moveFor(row, now));
  if (quick.length === 0) return null;
  return (
    <div className="mt-3.5">
      <p className="mb-2 text-[14px] font-semibold text-[#111827]">{t("detail.callResult")}</p>
      <div role="group" aria-label={t("detail.callResult")} className="grid grid-cols-4 gap-2">
        {quick.map((q) => {
          const st = QUICK_STYLE[q.tone];
          const Icon = st.icon;
          return (
            <button key={q.outcome} type="button" onClick={() => onQuick(row, q)}
              className={`flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-[10px] border px-1 py-2 text-center text-[12.5px] font-semibold leading-tight ${st.cls}`}>
              <Icon size={20} aria-hidden />
              <span>{t(`quick.${q.outcome}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The "…" at the panel's corner: the three things the panel can do for this parcel. */
function PanelMenu({ row, done, onClose, onLogAction, onWhatsApp }: { row: WorklistRow; done: boolean; onClose: () => void; onLogAction: DetailHandlers["onLogAction"]; onWhatsApp: DetailHandlers["onWhatsApp"] }) {
  const t = useTranslations("delivery");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "flex w-full items-center gap-2.5 px-3 py-2 text-[13.5px] text-[#111827] hover:bg-[#F3F4F6]";
  return (
    <div ref={ref} className="relative ms-auto shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("detail.more")} onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]">
        <MoreHorizontal size={20} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-[0_8px_24px_rgba(17,24,39,0.10)]">
          {!done && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onLogAction(row); }}><NotebookPen size={16} aria-hidden />{t("detail.logAction")}</button>}
          {!done && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onWhatsApp(row); }}><WhatsAppIcon size={16} className="text-[#15803D]" />{t("detail.whatsapp")}</button>}
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onClose(); }}><X size={16} aria-hidden />{t("detail.close")}</button>
        </div>
      )}
    </div>
  );
}

/** Desktop side panel. */
export function DeliveryDetailPanel({ row, market, locale, tz, now, marketId = null, whatsappActive = false, whatsappKnown = false, onClose, onLogAction, onWhatsApp, onDialed, onQuick }: Props & { onClose: () => void }) {
  const t = useTranslations("delivery");
  const tStatus = useTranslations("orders.statuses");
  const label = useSituationLabel();
  const created = useCreated(locale, tz);
  const s = situationOf(row, now);
  const m = moveFor(row, now);
  const Icon = MOVE_ICON[m.kind];
  const done = row.bucket === "done";
  const item = row.items[0];

  return (
    <div className="h-full overflow-y-auto [scrollbar-width:thin]">
      <div className={`${card} pb-4`}>
        <div className="flex items-start gap-2.5">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-[20px] font-bold text-[#111827]">
            <span className="[unicode-bidi:plaintext]">{row.customer_name}</span>
            <Ltr className="text-[14px] font-normal text-[#6B7280]">#{orderRef(row)}</Ltr>
          </h2>
          <PanelMenu row={row} done={done} onClose={onClose} onLogAction={onLogAction} onWhatsApp={onWhatsApp} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2.5">
          <Chip tone={s.tone} icon={SIT_ICON[s.key]}>{label(s)}</Chip>
          <Money amount={row.total_price} market={market} locale={locale} className="text-[26px] font-bold tracking-tight text-[#111827]" />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#6B7280]">
          <span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden />{[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}</span>
          <span className="inline-flex items-center gap-1.5"><Calendar size={15} aria-hidden />{created(row.created_at)}</span>
        </div>

        {/* Prochaine action */}
        <div className="mt-3.5 rounded-[10px] bg-[#F3F4F6] p-3.5">
          <div className="flex items-center gap-3.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#DCFCE7] text-[#15803D]"><Icon size={24} aria-hidden /></span>
            <div className="min-w-0">
              <small className="block text-[13px] text-[#6B7280]">{t("detail.recommended")}</small>
              <b className="mt-px block text-[19px] font-bold leading-tight text-[#111827]">{t(`moves.${m.kind}`)}</b>
              <p className="mt-0.5 text-[13px] text-[#6B7280]">{t(`why.${m.kind}`)}</p>
            </div>
          </div>
          {m.whatsapp ? (
            <button type="button" onClick={() => onWhatsApp(row)} className={`mt-3.5 h-12 w-full text-[16px] ${PRIMARY_BTN}`}>
              <WhatsAppIcon size={20} />{t("moves.wa")}
            </button>
          ) : m.dial ? (
            <a href={`tel:${m.dial}`} onClick={() => onDialed(row)} aria-label={t("detail.callNumber", { phone: formatPhone(m.dial) })} className={`mt-3.5 h-12 w-full text-[19px] ${PRIMARY_BTN}`}>
              <Phone size={20} aria-hidden />
              <Ltr>{formatPhone(m.dial)}</Ltr>
            </a>
          ) : null}
        </div>

        {!done && <QuickOutcomes row={row} now={now} onQuick={onQuick} />}
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className={card}>
          <h3 className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold text-[#111827]"><User size={17} aria-hidden />{t("detail.clientInfo")}</h3>
          {[row.customer_phone, row.customer_phone_2].filter(Boolean).map((ph) => (
            <a key={ph} href={`tel:${ph}`} onClick={() => onDialed(row)} className={line}><Phone size={15} className="shrink-0 text-[#6B7280]" aria-hidden /><Ltr>{formatPhone(ph)}</Ltr></a>
          ))}
          <div className={line}><MapPin size={15} className="shrink-0 text-[#6B7280]" aria-hidden /><span className="truncate [unicode-bidi:plaintext]">{[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}</span></div>
          <div className={`${line} text-[#6B7280]`}>
            <FileText size={15} className="shrink-0" aria-hidden />
            <span>{(row.customer_orders_count ?? 0) > 1
              ? t("detail.customerHistory", { orders: row.customer_orders_count ?? 0, delivered: row.customer_delivered_count ?? 0, returned: row.customer_returned_count ?? 0 })
              : t("detail.customerNew")}</span>
          </div>
          {!done && (
            <button type="button" onClick={() => onWhatsApp(row)} className={`${line} mt-0.5 font-semibold text-[#15803D]`}>
              <WhatsAppIcon size={16} />{t("detail.whatsapp")}
            </button>
          )}
        </div>
        <div className={card}>
          <h3 className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold text-[#111827]"><Truck size={17} aria-hidden />{t("detail.carrier")}</h3>
          {row.carrier_name && <div className={line}><User size={15} className="shrink-0 text-[#6B7280]" aria-hidden /><span className="truncate">{row.carrier_name}</span></div>}
          {row.handler_name && <div className={line}><User size={15} className="shrink-0 text-[#6B7280]" aria-hidden /><span className="truncate [unicode-bidi:plaintext]">{row.handler_name}</span></div>}
          {row.handler_phone && (
            <a href={`tel:${row.handler_phone}`} onClick={() => onDialed(row)} className={line}><Phone size={15} className="shrink-0 text-[#6B7280]" aria-hidden /><Ltr>{formatPhone(row.handler_phone)}</Ltr></a>
          )}
          <div className={`${line} text-[#6B7280]`}>
            <span className={`ms-[3px] me-[3px] h-2 w-2 shrink-0 rounded-full ${TONE[s.tone].dot}`} aria-hidden />
            <span>{tStatus.has(row.status) ? tStatus(row.status) : row.status}</span>
          </div>
          {row.latest_remark && (
            <div className="mt-1.5 rounded-lg bg-[#F3F4F6] px-2.5 py-1.5 text-[12.5px] text-[#374151] [unicode-bidi:plaintext]">« {row.latest_remark} »</div>
          )}
          {!row.carrier_name && !row.handler_name && <div className={`${line} text-[#6B7280]`}>{t("detail.notYet")}</div>}
          {!done && (row.handler_phone || row.handler_account_phone) && (
            <button type="button" onClick={() => onLogAction(row, "call_courier")} className={`mt-2 h-9 w-full text-[13px] ${OUTLINE_BTN} border-[#D1D5DB]`}>
              <Phone size={15} aria-hidden />{t("detail.callCourier")}
            </button>
          )}
        </div>
      </div>

      <div className={`${card} mt-2.5 flex items-center gap-3`}>
        <ProductThumb src={item?.image_url} alt={item?.product_name ?? ""} size={40} />
        <span className="shrink-0 text-[14px] font-semibold text-[#111827]">{t("detail.parcel")}</span>
        <div className="min-w-0 flex-1">
          {item ? (
            <div className="truncate text-[13.5px] text-[#111827]">{item.product_name}{item.variant_label ? ` · ${item.variant_label}` : ""} <Ltr>×{item.quantity}</Ltr>{row.items.length > 1 ? ` +${row.items.length - 1}` : ""}</div>
          ) : <div className="text-[13.5px] text-[#6B7280]">—</div>}
          {row.tracking_number && <div className="truncate text-[12.5px] text-[#6B7280]">{t("detail.tracking")} : <Ltr>{row.tracking_number}</Ltr></div>}
        </div>
        <Money amount={row.total_price} market={market} locale={locale} className="shrink-0 text-[18px] font-bold text-[#111827]" />
      </div>

      <DeliveryTimeline orderId={row.order_id} locale={locale} tz={tz} now={now} waStatus={row.wa_last?.status ?? null} />
      {(whatsappActive || whatsappKnown) && marketId && (
        <DeliveryMessages orderId={row.order_id} marketId={marketId} onOpenSheet={() => onWhatsApp(row)} />
      )}
    </div>
  );
}
