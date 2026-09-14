"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Clock, MapPin, Package, Phone, RotateCcw, Truck, Check, FileText } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { BUCKET_TONE, formatPhone, moveFor, moveTone, orderRef, situationOf, type MoveKind } from "@/lib/delivery/presentation";
import { Chip, EDGE, Ltr, Money, OUTLINE_BTN, SIT_ICON, TONE, WhatsAppIcon, type IconComponent, useSituationLabel, useSituationSub, useWhen } from "./ui";

const MOVE_ICON: Record<MoveKind, IconComponent> = {
  call2: Phone, call: Phone, before: Phone, courier: Phone, save: RotateCcw, wa: WhatsAppIcon, track: Truck, details: Check,
};
/** The mobile square button uses the prototype's icon, which is not always the desktop one. */
const MOBILE_ICON: Partial<typeof MOVE_ICON> = { save: Package, details: FileText };

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
 * One parcel. A single element that lays out as the table row on desktop and
 * as the card on mobile, so nothing is rendered twice for screen readers
 * except the two action buttons, one of which is always hidden.
 */
function DeliveryRowInner({ row, selected, showAgent, market, locale, tz, now, onSelect, onMove, onWhatsApp }: DeliveryRowProps) {
  const t = useTranslations("delivery");
  const label = useSituationLabel();
  const sub = useSituationSub();
  const when = useWhen(now, tz, locale);
  const s = situationOf(row, now);
  const m = moveFor(row, now);
  const tone = BUCKET_TONE[row.bucket];
  const btnTone = moveTone(row, now);
  const Icon = MOVE_ICON[m.kind];
  const MobileIcon = MOBILE_ICON[m.kind] ?? Icon;
  const SitIcon = SIT_ICON[s.key];
  const p = product(row);
  const moved = row.latest_event_at ?? new Date(now - (row.hours_on_status ?? 0) * 3_600_000).toISOString();
  const moveLabel = t(`moves.${m.kind}`);
  const phones = [row.customer_phone, row.customer_phone_2].filter(Boolean).map(formatPhone).join(" · ");
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
        "mb-2 grid cursor-pointer gap-x-2.5 rounded-[10px] border text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#15803D]/40",
        "grid-cols-[minmax(0,1fr)_auto] px-4 py-3 ps-[18px]",
        "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_96px] lg:items-center lg:gap-x-4 lg:px-4 lg:py-2.5 lg:ps-5",
        selected ? "border-[1.5px] border-[#15803D] bg-[#F0FDF4]" : "border-[#E5E7EB] bg-white hover:border-[#C9CCCF]",
      ].join(" ")}
    >
      {/* Détails du colis */}
      <div className="col-start-1 row-start-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[17px] font-bold text-[#111827] [unicode-bidi:plaintext] lg:text-[15px]">{row.customer_name}</span>
          <Ltr className="text-[15px] text-[#6B7280] lg:text-[13.5px]">#{orderRef(row)}</Ltr>
        </div>
        {phones && (
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-[#374151]">
            <Phone size={14} className="shrink-0 text-[#9CA3AF] lg:hidden" aria-hidden />
            <Ltr>{phones}</Ltr>
          </div>
        )}
        <div className="mt-0.5 hidden flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#6B7280] lg:flex">
          <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden />{[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}</span>
          {p && <span className="inline-flex items-center gap-1"><Package size={14} aria-hidden />{p.name} <Ltr>×{p.qty}</Ltr></span>}
        </div>
        <div className="mt-0.5 text-[14.5px] text-[#6B7280] lg:hidden">
          {row.customer_city}{p ? <> · {p.name} <Ltr>×{p.qty}</Ltr></> : null}
        </div>
        {showAgent && row.agent_name && <div className="mt-1 text-[12.5px] text-[#6B7280]">{row.agent_name}</div>}
      </div>

      {/* Situation / durée */}
      <div className="col-start-1 row-start-2 mt-1.5 flex flex-col items-start gap-1.5 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:gap-0">
        <Chip tone={s.tone} icon={SitIcon}>{label(s)}</Chip>
        <div className="mt-1 text-[13px] text-[#6B7280] [unicode-bidi:plaintext]">{sub(s)}</div>
        <div className="mt-0.5 hidden items-center gap-1 text-[13px] text-[#6B7280] lg:flex">
          <Clock size={13} aria-hidden /><span>{when(moved)}</span>
        </div>
        {/* A second number only matters when it is the one to call. */}
        {m.kind === "call2" && m.dial && (
          <span className="flex items-center gap-2 text-sm font-medium text-[#111827] lg:hidden"><Phone size={16} aria-hidden /><Ltr>{formatPhone(m.dial)}</Ltr></span>
        )}
      </div>

      {/* Action */}
      <div className="col-start-2 row-span-2 row-start-2 flex min-w-0 items-end justify-end lg:col-start-3 lg:row-span-1 lg:row-start-1 lg:items-center lg:justify-start lg:gap-2">
        {/* A glyph alone does not separate "rescue this return" from "call the
            courier", so the phone button carries its own label. */}
        <button
          type="button"
          onClick={act}
          className={`flex w-[86px] flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 lg:hidden ${m.whatsapp ? "border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]" : `bg-white text-[#111827] ${TONE[btnTone].border}`}`}
        >
          <MobileIcon size={22} aria-hidden />
          <span className="w-full text-balance text-center text-[11px] font-semibold leading-tight">{moveLabel}</span>
        </button>
        <button
          type="button"
          onClick={act}
          className={`hidden h-11 min-w-0 px-4 text-[14px] lg:inline-flex ${OUTLINE_BTN} ${m.whatsapp ? "border-[#86EFAC] text-[#15803D]" : TONE[btnTone].border}`}
        >
          <Icon size={17} aria-hidden className={`shrink-0 ${m.whatsapp ? "text-[#15803D]" : TONE[btnTone].icon}`} />
          <span className="truncate">{moveLabel}</span>
        </button>
        {row.bucket !== "done" && !m.whatsapp && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onWhatsApp(row); }}
            aria-label={t("detail.whatsapp")}
            className={`hidden h-11 w-11 shrink-0 lg:inline-flex ${OUTLINE_BTN} border-[#86EFAC] !text-[#15803D]`}
          >
            <WhatsAppIcon size={20} />
          </button>
        )}
      </div>

      {/* Montant */}
      <div className="col-start-2 row-start-1 text-end text-[17px] font-bold text-[#111827] lg:col-start-4 lg:text-[19px]">
        <Money amount={row.total_price} market={market} locale={locale} />
      </div>
    </article>
  );
}

export const DeliveryRow = memo(DeliveryRowInner);
