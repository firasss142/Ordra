"use client";

import { useTranslations } from "next-intl";
import { Calendar, ChevronLeft, ChevronRight, FileText, MapPin, NotebookPen, Package, PenLine, Phone, RotateCcw, Truck, User, X, Check } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { BUCKET_TONE, formatPhone, moveFor, orderRef, situationOf, type MoveKind } from "@/lib/delivery/presentation";
import { DeliveryTimeline } from "./DeliveryTimeline";
import { Chip, EDGE, Ltr, TONE, WhatsAppIcon, type IconComponent, moneyText, useSituationLabel } from "./ui";

const MOVE_ICON: Record<MoveKind, IconComponent> = {
  call2: Phone, call: Phone, before: Phone, courier: Truck, save: RotateCcw, wa: WhatsAppIcon, track: Truck, details: Check,
};

export interface DetailHandlers {
  onLogAction: (row: WorklistRow, type?: "call_customer" | "call_courier" | "call_branch" | "note") => void;
  onWhatsApp: (row: WorklistRow) => void;
  /** A tel: link was followed — open the sheet so the call gets logged. */
  onDialed: (row: WorklistRow) => void;
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
          timeZone: tz, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
        }).format(new Date(iso))
      : "—";
}

const card = "rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5";
const line = "flex min-w-0 items-center gap-2 py-[3px] text-[14.5px] text-[#111827] text-start";

/** Desktop side panel — the prototype's "Amina El Fitouri" column. */
export function DeliveryDetailPanel({ row, market, locale, tz, now, onClose, onLogAction, onWhatsApp, onDialed }: Props & { onClose: () => void }) {
  const t = useTranslations("delivery");
  const tStatus = useTranslations("orders.statuses");
  const label = useSituationLabel();
  const created = useCreated(locale, tz);
  const s = situationOf(row, now);
  const m = moveFor(row, now);
  const Icon = MOVE_ICON[m.kind];
  const done = row.bucket === "done";

  return (
    <div className="h-full overflow-y-auto rounded-[14px] border border-[#E5E7EB] bg-white px-[18px] pb-7 pt-[18px] [scrollbar-width:thin]">
      <div className="flex items-start gap-2.5">
        <h2 className="flex flex-wrap items-baseline gap-x-2.5 text-[22px] font-bold text-[#111827]">
          <span className="[unicode-bidi:plaintext]">{row.customer_name}</span>
          <Ltr className="text-[15px] font-normal text-[#6B7280]">#{orderRef(row)}</Ltr>
        </h2>
        <button type="button" onClick={onClose} aria-label={t("detail.close")} className="ms-auto grid h-8 w-8 place-items-center rounded-lg text-[#374151]">
          <X size={20} aria-hidden />
        </button>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2.5">
        <Chip tone={s.tone}>{label(s)}</Chip>
        <span className="whitespace-nowrap text-[30px] font-bold tracking-tight text-[#111827]">{moneyText(row.total_price, market, locale)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5 text-sm text-[#374151]">
        <span className="inline-flex items-center gap-1.5"><MapPin size={17} className="text-[#6B7280]" aria-hidden />{row.customer_city}</span>
        <span className="inline-flex items-center gap-1.5"><Calendar size={17} className="text-[#6B7280]" aria-hidden />{t("detail.created", { date: created(row.created_at) })}</span>
      </div>

      {/* Prochaine action recommandée */}
      <div className={`${card} mt-4 bg-[#F9FAFB] pb-3`}>
        <div className="flex items-start gap-3.5">
          <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full border border-[#D1D5DB] bg-white"><Icon size={20} aria-hidden /></span>
          <div>
            <small className="block text-[13.5px] text-[#6B7280]">{t("detail.recommended")}</small>
            <b className="mt-px block text-lg font-bold text-[#111827]">{t(`moves.${m.kind}`)}</b>
            <p className="mt-0.5 text-sm text-[#6B7280]">{t(`why.${m.kind}`)}</p>
          </div>
        </div>
        {m.whatsapp ? (
          <button type="button" onClick={() => onWhatsApp(row)} className="mt-3.5 flex h-[46px] w-full items-center justify-center gap-2.5 rounded-lg bg-[#111111] text-[15.5px] font-semibold text-white">
            <WhatsAppIcon size={18} />{t("moves.wa")}
          </button>
        ) : m.dial ? (
          <a href={`tel:${m.dial}`} onClick={() => onDialed(row)} className="mt-3.5 flex h-[46px] w-full items-center justify-center gap-2.5 rounded-lg bg-[#111111] text-[15.5px] font-semibold text-white">
            <Phone size={18} aria-hidden />
            {m.kind === "save"
              ? t("detail.callBranch", { phone: formatPhone(m.dial) })
              : t("detail.callNumber", { phone: formatPhone(m.dial) })}
          </a>
        ) : null}
        {!done && (
          <button type="button" onClick={() => onLogAction(row)} className="mx-auto mt-3 flex items-center gap-2 text-[14.5px] font-semibold text-[#2563EB]">
            <NotebookPen size={17} aria-hidden />{t("detail.logAction")}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={card}>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-[#111827]"><User size={18} aria-hidden />{t("detail.client")}</h3>
          <div className={line}><User size={16} className="shrink-0 text-[#6B7280]" aria-hidden /><span className="truncate [unicode-bidi:plaintext]">{row.customer_name}</span></div>
          {[row.customer_phone, row.customer_phone_2].filter(Boolean).map((ph) => (
            <a key={ph} href={`tel:${ph}`} onClick={() => onDialed(row)} className={line}><Phone size={16} className="shrink-0 text-[#6B7280]" aria-hidden /><Ltr>{formatPhone(ph)}</Ltr></a>
          ))}
          <div className={line}><MapPin size={16} className="shrink-0 text-[#6B7280]" aria-hidden /><span className="truncate [unicode-bidi:plaintext]">{[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}</span></div>
          <div className={`${line} text-[13.5px] text-[#6B7280]`}>
            <FileText size={16} className="shrink-0" aria-hidden />
            <span>{(row.customer_orders_count ?? 0) > 1
              ? t("detail.customerHistory", { orders: row.customer_orders_count ?? 0, delivered: row.customer_delivered_count ?? 0, returned: row.customer_returned_count ?? 0 })
              : t("detail.customerNew")}</span>
          </div>
          {!done && (
            <button type="button" onClick={() => onWhatsApp(row)} className={`${line} font-medium text-[#16A34A]`}>
              <WhatsAppIcon size={16} />{t("detail.whatsapp")}
            </button>
          )}
        </div>
        <div className={card}>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-[#111827]"><Truck size={18} aria-hidden />{t("detail.carrier")}</h3>
          {row.carrier_name && <div className={line}><span>{row.carrier_name}</span></div>}
          {row.handler_name && <div className={line}><User size={16} className="shrink-0 text-[#6B7280]" aria-hidden /><span className="truncate [unicode-bidi:plaintext]">{row.handler_name}</span></div>}
          {row.handler_phone && (
            <a href={`tel:${row.handler_phone}`} onClick={() => onDialed(row)} className={line}><Phone size={16} className="shrink-0 text-[#6B7280]" aria-hidden /><Ltr>{formatPhone(row.handler_phone)}</Ltr></a>
          )}
          <div className={`${line} text-[13.5px] text-[#6B7280]`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[BUCKET_TONE[row.bucket]].dot}`} aria-hidden />
            <span>{tStatus.has(row.status) ? tStatus(row.status) : row.status}</span>
          </div>
          {row.latest_remark && <div className={`${line} text-[13.5px] text-[#6B7280]`}><span className="[unicode-bidi:plaintext]">« {row.latest_remark} »</span></div>}
          {!row.carrier_name && !row.handler_name && <div className={`${line} text-[13.5px] text-[#6B7280]`}>{t("detail.notYet")}</div>}
          {!done && (row.handler_phone || row.handler_account_phone) && (
            <button type="button" onClick={() => onLogAction(row, "call_courier")}
              className="mt-2.5 flex h-10 w-full items-center justify-center rounded-lg border border-[#D1D5DB] bg-white text-sm font-semibold text-[#111827] hover:bg-[#F9FAFB]">
              {t("detail.callCourier")}
            </button>
          )}
        </div>
      </div>

      <div className={`${card} mt-3`}>
        <h3 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-[#111827]"><Package size={18} aria-hidden />{t("detail.parcel")}</h3>
        <div className="mt-2 flex items-end justify-between gap-2.5">
          <div className="min-w-0">
            {row.items.length === 0 ? <div className="text-[15px] text-[#6B7280]">—</div> : row.items.map((it, i) => (
              <div key={i} className="text-[15px] text-[#111827]">{it.product_name}{it.variant_label ? ` · ${it.variant_label}` : ""} <Ltr>× {it.quantity}</Ltr></div>
            ))}
            {row.tracking_number && <div className="mt-0.5 text-[13.5px] text-[#6B7280]">{t("detail.tracking")} : <Ltr>{row.tracking_number}</Ltr></div>}
          </div>
          <span className="whitespace-nowrap text-[21px] font-bold text-[#111827]">{moneyText(row.total_price, market, locale)}</span>
        </div>
      </div>

      <DeliveryTimeline orderId={row.order_id} locale={locale} tz={tz} now={now} />
    </div>
  );
}

/** Mobile full-screen detail — the prototype's "Détail du colis" phone. */
export function DeliveryDetailScreen({ row, market, locale, tz, now, onBack, onLogAction, onWhatsApp, onDialed }: Props & { onBack: () => void }) {
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
            <Chip tone={s.tone}>{label(s)}</Chip>
          </div>
        </div>

        <button type="button" onClick={() => (m.whatsapp ? onWhatsApp(row) : onLogAction(row))}
          className={`${block} ${EDGE} ${TONE[BUCKET_TONE[row.bucket]].edge} flex w-full items-center gap-3 text-start`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center"><Icon size={22} aria-hidden /></span>
          <span className="min-w-0">
            <small className="block text-[13.5px] text-[#6B7280]">{t("detail.suggested")}</small>
            <b className="block text-[17px] font-bold">{t(`moves.${m.kind}`)}</b>
            <span className="mt-px block text-[13.5px] text-[#6B7280]">{t(`why.${m.kind}`)}</span>
          </span>
          <Forward size={20} className="ms-auto shrink-0 text-[#6B7280]" aria-hidden />
        </button>

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
          <div className={kv}><span className="text-[#6B7280]">{t("detail.status")}</span><Chip tone={s.tone}>{label(s)}</Chip></div>
          <div className={kv}><span className="text-[#6B7280]">{t("detail.createdAt")}</span><span className="font-medium">{created(row.created_at)}</span></div>
        </div>

        <div className={block}>
          <DeliveryTimeline orderId={row.order_id} locale={locale} tz={tz} now={now} compact />
        </div>
      </div>

      {!done && (
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-[#E5E7EB] bg-white px-3 pb-6 pt-3">
          {m.whatsapp || !dial ? (
            <button type="button" onClick={() => onWhatsApp(row)} className="flex h-[50px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[#111111] px-2.5 text-[14.5px] font-semibold text-white">
              <WhatsAppIcon size={18} />{t("moves.wa")}
            </button>
          ) : (
            <a href={`tel:${dial}`} onClick={() => onDialed(row)} className="flex h-[50px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[#111111] px-2.5 text-[14.5px] font-semibold text-white">
              <Phone size={18} aria-hidden />{t("detail.callNumber", { phone: formatPhone(dial) })}
            </a>
          )}
          <button type="button" onClick={() => onWhatsApp(row)} aria-label={t("detail.whatsapp")} className="grid h-[50px] w-[50px] place-items-center rounded-[10px] bg-[#E8F6EE] text-[#16A34A]">
            <WhatsAppIcon size={22} />
          </button>
          <button type="button" onClick={() => onLogAction(row)} className="flex h-[50px] items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm font-semibold">
            <PenLine size={17} aria-hidden />{t("detail.logShort")}
          </button>
        </div>
      )}
    </div>
  );
}
