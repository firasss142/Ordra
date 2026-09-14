"use client";

import { useTranslations } from "next-intl";
import { Ban, Calendar, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, FileText, MapPin, Package, PenLine, Phone, RotateCcw, Truck, User, X, Check, XCircle } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { BUCKET_TONE, formatPhone, moveFor, orderRef, quickOutcomesFor, situationOf, type MoveKind, type QuickOutcome } from "@/lib/delivery/presentation";
import { DeliveryTimeline } from "./DeliveryTimeline";
import { Chip, EDGE, Ltr, OUTLINE_BTN, PRIMARY_BTN, SIT_ICON, TONE, WhatsAppIcon, type IconComponent, moneyText, useSituationLabel } from "./ui";

const MOVE_ICON: Record<MoveKind, IconComponent> = {
  call2: Phone, call: Phone, before: Phone, courier: Phone, save: RotateCcw, wa: WhatsAppIcon, track: Truck, details: Check,
};

/** One tile per outcome: its glyph, and the tint it takes so the four read at a glance. */
const QUICK_STYLE: Record<QuickOutcome["tone"], { icon: IconComponent; cls: string }> = {
  green: { icon: CheckCircle2, cls: "border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]" },
  grey: { icon: XCircle, cls: "border-[#D1D5DB] bg-white text-[#374151]" },
  blue: { icon: CalendarCheck, cls: "border-[#93C5FD] bg-[#EFF6FF] text-[#1D4ED8]" },
  red: { icon: Ban, cls: "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]" },
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

/** Desktop side panel. */
export function DeliveryDetailPanel({ row, market, locale, tz, now, onClose, onLogAction, onWhatsApp, onDialed, onQuick }: Props & { onClose: () => void }) {
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
          <button type="button" onClick={onClose} aria-label={t("detail.close")} className="ms-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2.5">
          <Chip tone={s.tone} icon={SIT_ICON[s.key]}>{label(s)}</Chip>
          <span className="whitespace-nowrap text-[26px] font-bold tracking-tight text-[#111827]">{moneyText(row.total_price, market, locale)}</span>
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
            <span className={`ms-[3px] me-[3px] h-2 w-2 shrink-0 rounded-full ${TONE[BUCKET_TONE[row.bucket]].dot}`} aria-hidden />
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
        <Package size={18} className="shrink-0 text-[#111827]" aria-hidden />
        <span className="shrink-0 text-[14px] font-semibold text-[#111827]">{t("detail.parcel")}</span>
        <div className="min-w-0 flex-1">
          {item ? (
            <div className="truncate text-[13.5px] text-[#111827]">{item.product_name}{item.variant_label ? ` · ${item.variant_label}` : ""} <Ltr>×{item.quantity}</Ltr>{row.items.length > 1 ? ` +${row.items.length - 1}` : ""}</div>
          ) : <div className="text-[13.5px] text-[#6B7280]">—</div>}
          {row.tracking_number && <div className="truncate text-[12.5px] text-[#6B7280]">{t("detail.tracking")} : <Ltr>{row.tracking_number}</Ltr></div>}
        </div>
        <span className="shrink-0 whitespace-nowrap text-[18px] font-bold text-[#111827]">{moneyText(row.total_price, market, locale)}</span>
      </div>

      <DeliveryTimeline orderId={row.order_id} locale={locale} tz={tz} now={now} />
    </div>
  );
}

/** Mobile full-screen detail. */
export function DeliveryDetailScreen({ row, market, locale, tz, now, onBack, onLogAction, onWhatsApp, onDialed, onQuick }: Props & { onBack: () => void }) {
  const t = useTranslations("delivery");
  const label = useSituationLabel();
  const created = useCreated(locale, tz);
  const s = situationOf(row, now);
  const m = moveFor(row, now);
  const Icon = MOVE_ICON[m.kind];
  const done = row.bucket === "done";
  const dial = m.dial ?? row.customer_phone;
  const item = row.items[0];
  const Back = locale === "ar" ? ChevronRight : ChevronLeft;
  const Forward = locale === "ar" ? ChevronLeft : ChevronRight;
  const block = "mb-2.5 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5";
  const kv = "flex items-center justify-between gap-2.5 py-[7px] text-[14.5px]";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#F5F6F8] text-start lg:hidden">
      <div className="relative flex h-[52px] shrink-0 items-center justify-center border-b border-[#E5E7EB] bg-white text-[17px] font-semibold">
        <button type="button" onClick={onBack} aria-label={t("detail.back")} className="absolute start-2.5 grid h-9 w-9 place-items-center"><Back size={22} aria-hidden /></button>
        {t("detail.title")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-2.5">
        <div className={`${block} grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1`}>
          <div className="min-w-0">
            <div className="text-[21px] font-bold [unicode-bidi:plaintext]">{row.customer_name}</div>
            <div className="flex items-center gap-2 text-[14.5px] text-[#6B7280]"><MapPin size={16} aria-hidden />{row.customer_city}</div>
            {item && <div className="flex items-center gap-2 text-[14.5px] text-[#6B7280]"><Package size={16} aria-hidden />{item.product_name} <Ltr>×{item.quantity}</Ltr></div>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Ltr className="text-sm text-[#6B7280]">#{orderRef(row)}</Ltr>
            <span className="whitespace-nowrap text-[26px] font-bold leading-none">{moneyText(row.total_price, market, locale)}</span>
            <Chip tone={s.tone} icon={SIT_ICON[s.key]}>{label(s)}</Chip>
          </div>
        </div>

        <button type="button" onClick={() => (m.whatsapp ? onWhatsApp(row) : onLogAction(row))}
          className={`${block} ${EDGE} ${TONE[BUCKET_TONE[row.bucket]].edge} flex w-full items-center gap-3 text-start`}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#DCFCE7] text-[#15803D]"><Icon size={22} aria-hidden /></span>
          <span className="min-w-0">
            <small className="block text-[13.5px] text-[#6B7280]">{t("detail.suggested")}</small>
            <b className="block text-[17px] font-bold">{t(`moves.${m.kind}`)}</b>
            <span className="mt-px block text-[13.5px] text-[#6B7280]">{t(`why.${m.kind}`)}</span>
          </span>
          <Forward size={20} className="ms-auto shrink-0 text-[#6B7280]" aria-hidden />
        </button>

        {!done && <div className={block}><QuickOutcomes row={row} now={now} onQuick={onQuick} /></div>}

        <div className={block}>
          <h3 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><User size={18} aria-hidden />{t("detail.clientInfo")}</h3>
          {row.customer_phone_2 && (
            <div className={kv}><span className="text-[#6B7280]">{m.kind === "call2" ? t("detail.phone2Recommended") : t("detail.phone2")}</span>
              <a href={`tel:${row.customer_phone_2}`} onClick={() => onDialed(row)} className={m.kind === "call2" ? "text-base font-bold" : "font-medium"}><Ltr>{formatPhone(row.customer_phone_2)}</Ltr></a></div>
          )}
          {row.customer_phone && (
            <div className={kv}><span className="text-[#6B7280]">{t("detail.phone1")}</span>
              <a href={`tel:${row.customer_phone}`} onClick={() => onDialed(row)} className={m.kind !== "call2" ? "text-base font-bold" : "font-medium"}><Ltr>{formatPhone(row.customer_phone)}</Ltr></a></div>
          )}
          <div className={kv}><MapPin size={16} className="text-[#6B7280]" aria-hidden /><span className="text-end font-medium [unicode-bidi:plaintext]">{[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}</span></div>
        </div>

        <div className={block}>
          <h3 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><Truck size={18} aria-hidden />{t("detail.deliveryInfo")}</h3>
          <div className={kv}><span className="text-[#6B7280]">{t("detail.carrierLabel")}</span><span className="font-medium">{row.carrier_name ?? "—"}</span></div>
          <div className={kv}><span className="text-[#6B7280]">{t("detail.courier")}</span><span className="font-medium [unicode-bidi:plaintext]">{row.handler_name ?? "—"}</span></div>
          <div className={kv}><span className="text-[#6B7280]">{t("detail.status")}</span><Chip tone={s.tone} icon={SIT_ICON[s.key]}>{label(s)}</Chip></div>
          <div className={kv}><span className="text-[#6B7280]">{t("detail.createdAt")}</span><span className="font-medium">{created(row.created_at)}</span></div>
        </div>

        <div className={block}>
          <DeliveryTimeline orderId={row.order_id} locale={locale} tz={tz} now={now} compact />
        </div>
      </div>

      {!done && (
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-[#E5E7EB] bg-white px-3 pb-6 pt-3">
          {m.whatsapp || !dial ? (
            <button type="button" onClick={() => onWhatsApp(row)} className={`h-[50px] min-w-0 flex-1 px-2.5 text-[14.5px] ${PRIMARY_BTN}`}>
              <WhatsAppIcon size={18} />{t("moves.wa")}
            </button>
          ) : (
            <a href={`tel:${dial}`} onClick={() => onDialed(row)} className={`h-[50px] min-w-0 flex-1 px-2.5 text-[14.5px] ${PRIMARY_BTN}`}>
              <Phone size={18} aria-hidden />{t("detail.callNumber", { phone: formatPhone(dial) })}
            </a>
          )}
          <button type="button" onClick={() => onWhatsApp(row)} aria-label={t("detail.whatsapp")} className={`h-[50px] w-[50px] ${OUTLINE_BTN} border-[#86EFAC] !text-[#15803D]`}>
            <WhatsAppIcon size={22} />
          </button>
          <button type="button" onClick={() => onLogAction(row)} className={`h-[50px] px-3 text-sm ${OUTLINE_BTN} border-[#D1D5DB]`}>
            <PenLine size={17} aria-hidden />{t("detail.logShort")}
          </button>
        </div>
      )}
    </div>
  );
}
