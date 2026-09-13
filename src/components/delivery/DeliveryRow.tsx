"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Clock, MapPin, Package, Phone, RotateCcw, Truck, Check, FileText } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { BUCKET_TONE, formatPhone, moveFor, orderRef, situationOf, type MoveKind } from "@/lib/delivery/presentation";
import { Chip, EDGE, Ltr, TONE, WhatsAppIcon, type IconComponent, moneyText, useSituationLabel, useSituationSub, useWhen } from "./ui";

const MOVE_ICON: Record<MoveKind, IconComponent> = {
  call2: Phone, call: Phone, before: Phone, courier: Truck, save: RotateCcw, wa: WhatsAppIcon, track: Truck, details: Check,
};
/** The mobile square button uses the prototype's icon, which is not always the desktop one. */
const MOBILE_ICON: Partial<typeof MOVE_ICON> = { courier: Phone, save: Package, details: FileText };

export interface DeliveryRowProps {
  row: WorklistRow;
  selected: boolean;
  showAgent: boolean;
  market: "ly" | "tn";
  locale: string;
  tz: string;
  now: number;
  onSelect: (row: WorklistRow) => void;
  onMove: (row: WorklistRow) => void;
  onWhatsApp: (row: WorklistRow) => void;
}

function product(row: WorklistRow) {
  const first = row.items[0];
  if (!first) return null;
  const more = row.items.length > 1 ? ` +${row.items.length - 1}` : "";
  return { name: `${first.product_name ?? ""}${first.variant_label ? ` · ${first.variant_label}` : ""}${more}`, qty: first.quantity };
}

/**
 * One parcel. A single element that lays out as the prototype's table row on
 * desktop and as its card on mobile, so nothing is rendered twice for screen
 * readers except the two action buttons, one of which is always hidden.
 */
function DeliveryRowInner({ row, selected, showAgent, market, locale, tz, now, onSelect, onMove, onWhatsApp }: DeliveryRowProps) {
  const t = useTranslations("delivery");
  const label = useSituationLabel();
  const sub = useSituationSub();
  const when = useWhen(now, tz, locale);
  const s = situationOf(row, now);
  const m = moveFor(row, now);
  const tone = BUCKET_TONE[row.bucket];
  const Icon = MOVE_ICON[m.kind];
  const MobileIcon = MOBILE_ICON[m.kind] ?? Icon;
  const p = product(row);
  const moved = row.latest_event_at ?? new Date(now - (row.hours_on_status ?? 0) * 3_600_000).toISOString();
  const moveLabel = t(`moves.${m.kind}`);
  const act = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMove(row);
  };

  return (
    <article
      role="listitem"
      aria-current={selected ? "true" : undefined}
      tabIndex={0}
      onClick={() => onSelect(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect(row);
      }}
      className={[
        EDGE, TONE[tone].edge,
        "mb-2 grid cursor-pointer gap-x-2.5 rounded-xl border bg-white text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#2563EB]",
        "grid-cols-[minmax(0,1fr)_auto] px-4 py-3 ps-[18px]",
        "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_200px_92px] lg:items-center lg:gap-x-4 lg:rounded-[10px] lg:ps-5",
        selected ? "border-[1.5px] border-[#111111]" : "border-[#E5E7EB] hover:border-[#D1D5DB]",
      ].join(" ")}
    >
      {/* Client / colis */}
      <div className="col-start-1 row-start-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-[17px] font-bold text-[#111827] [unicode-bidi:plaintext] lg:text-base lg:font-semibold">{row.customer_name}</span>
          <Ltr className="text-[15px] text-[#6B7280] lg:text-sm">#{orderRef(row)}</Ltr>
        </div>
        <div className="mt-0.5 hidden text-sm text-[#374151] lg:block">
          <Ltr>{[row.customer_phone, row.customer_phone_2].filter(Boolean).map(formatPhone).join(" · ")}</Ltr>
        </div>
        <div className="mt-1.5 hidden flex-wrap items-center gap-x-3.5 gap-y-1 text-[13.5px] text-[#374151] lg:flex">
          <span className="inline-flex items-center gap-1.5"><MapPin size={16} className="text-[#6B7280]" aria-hidden />{row.customer_city}</span>
          {p && <span className="inline-flex items-center gap-1.5"><Package size={16} className="text-[#6B7280]" aria-hidden />{p.name} <Ltr>×{p.qty}</Ltr></span>}
        </div>
        <div className="mt-0.5 text-[14.5px] text-[#6B7280] lg:hidden">
          {row.customer_city}{p ? <> · {p.name} <Ltr>×{p.qty}</Ltr></> : null}
        </div>
        {showAgent && row.agent_name && <div className="mt-1 text-[12.5px] text-[#6B7280]">{row.agent_name}</div>}
      </div>

      {/* Situation */}
      <div className="col-start-1 row-start-2 mt-1.5 flex flex-col items-start gap-1.5 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:gap-0">
        <Chip tone={s.tone}>{label(s)}</Chip>
        <div className="mt-1.5 hidden text-[13.5px] text-[#6B7280] [unicode-bidi:plaintext] lg:block">{sub(s)}</div>
        <div className="mt-1 hidden items-center gap-1.5 text-[13px] text-[#6B7280] lg:flex">
          <Clock size={15} aria-hidden /><span>{when(moved)}</span>
        </div>
        {m.dial && (m.kind === "call2" || m.kind === "call" || m.kind === "before") && (
          <span className="flex items-center gap-2 text-sm text-[#374151] lg:hidden"><Phone size={16} aria-hidden /><Ltr>{formatPhone(m.dial)}</Ltr></span>
        )}
        <span className={`inline-flex items-center gap-2 py-0.5 text-[15px] font-semibold text-[#111827] lg:hidden ${selected ? `-ms-1 rounded-full px-3 ${TONE[tone].soft}` : ""}`}>
          <ArrowRight size={16} aria-hidden className="rtl:-scale-x-100" />{moveLabel}
        </span>
      </div>

      {/* Action */}
      <div className="col-start-2 row-span-2 row-start-2 flex min-w-0 items-end justify-end lg:col-start-3 lg:row-span-1 lg:row-start-1 lg:items-center lg:justify-start lg:gap-2">
        <button
          type="button"
          onClick={act}
          aria-label={moveLabel}
          className={`grid h-[60px] w-[60px] place-items-center rounded-xl border lg:hidden ${m.whatsapp ? "border-[#BFE3CC] bg-[#E8F6EE] text-[#16A34A]" : "border-[#D1D5DB] bg-white text-[#111827]"}`}
        >
          <MobileIcon size={24} aria-hidden />
        </button>
        <button
          type="button"
          onClick={act}
          className="hidden h-10 min-w-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm font-semibold text-[#111827] hover:bg-[#F9FAFB] lg:inline-flex"
        >
          <Icon size={18} aria-hidden className="shrink-0" />
          <span className="truncate">{moveLabel}</span>
        </button>
        {row.bucket !== "done" && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onWhatsApp(row); }}
            aria-label={t("detail.whatsapp")}
            className="hidden h-10 w-10 place-items-center rounded-lg bg-[#E8F6EE] text-[#16A34A] lg:grid"
          >
            <WhatsAppIcon size={18} />
          </button>
        )}
      </div>

      {/* Montant */}
      <div className="col-start-2 row-start-1 whitespace-nowrap text-end text-[17px] font-bold text-[#111827] lg:col-start-4 lg:text-lg">
        {moneyText(row.total_price, market, locale)}
      </div>
    </article>
  );
}

export const DeliveryRow = memo(DeliveryRowInner);
