"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Clock, MapPin, Package, Phone, RotateCcw, Truck, Check } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { BUCKET_TONE, formatPhone, moveFor, moveTone, orderRef, situationOf, type MoveKind } from "@/lib/delivery/presentation";
import { Chip, EDGE, Ltr, Money, OUTLINE_BTN, ProductThumb, SIT_ICON, TONE, WhatsAppIcon, type IconComponent, useSituationLabel, useSituationSub, useWhen } from "./ui";

const MOVE_ICON: Record<MoveKind, IconComponent> = {
  call2: Phone, call: Phone, before: Phone, courier: Phone, save: RotateCcw, wa: WhatsAppIcon, track: Truck, details: Check,
};

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
        "grid-cols-[minmax(0,1fr)_auto] px-3.5 py-3 ps-4",
        "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_96px] lg:items-center lg:gap-x-4 lg:px-4 lg:py-2.5 lg:ps-5",
        selected ? "border-[1.5px] border-[#15803D] bg-[#F0FDF4]" : "border-[#E5E7EB] bg-white hover:border-[#C9CCCF]",
      ].join(" ")}
    >
      {/* Détails du colis */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-3">
       <ProductThumb src={row.items[0]?.image_url} alt={p?.name ?? ""} size={44} className="mt-0.5" />
       <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[16px] font-bold text-[#111827] [unicode-bidi:plaintext] lg:text-[15px]">{row.customer_name}</span>
          <Ltr className="text-[13.5px] text-[#6B7280]">#{orderRef(row)}</Ltr>
        </div>
        {phones && (
          <div className="mt-0.5 hidden items-center gap-1.5 text-sm text-[#374151] lg:flex">
            <Ltr>{phones}</Ltr>
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-[#6B7280]">
          <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden />{[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}{p && <span className="lg:hidden"> · {p.name} <Ltr>×{p.qty}</Ltr></span>}</span>
          {p && <span className="hidden items-center gap-1 lg:inline-flex"><Package size={14} aria-hidden />{p.name} <Ltr>×{p.qty}</Ltr></span>}
        </div>
        {showAgent && row.agent_name && <div className="mt-1 text-[12.5px] text-[#6B7280]">{row.agent_name}</div>}
       </div>
      </div>

      {/* Situation / durée */}
      <div className="col-span-2 col-start-1 row-start-2 mt-2 flex flex-col items-start lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0">
        <Chip tone={s.tone} icon={SitIcon}>{label(s)}</Chip>
        <div className="mt-1 hidden text-[13px] text-[#6B7280] [unicode-bidi:plaintext] lg:block">{sub(s)}</div>
        <div className="mt-0.5 hidden items-center gap-1 text-[13px] text-[#6B7280] lg:flex">
          <Clock size={13} aria-hidden /><span>{when(moved)}</span>
        </div>
      </div>

      {/* Action */}
      <div className="col-span-2 col-start-1 row-start-3 mt-2.5 flex min-w-0 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:mt-0 lg:items-center lg:gap-2">
        {/* On a phone the move is a full-width bar in the bucket's tint, the
            arrow pointing where a tap goes. */}
        <button
          type="button"
          onClick={act}
          className={`flex h-10 w-full items-center gap-2 rounded-lg px-3.5 text-[14px] font-semibold text-[#111827] lg:hidden ${m.whatsapp ? "bg-[#DCFCE7]" : TONE[btnTone === "grey" ? "grey" : btnTone].soft}`}
        >
          <span className="truncate">{moveLabel}</span>
          <ArrowRight size={16} aria-hidden className="ms-auto shrink-0 rtl:-scale-x-100" />
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
      <div className="col-start-2 row-start-1 self-start text-end text-[17px] font-bold text-[#111827] lg:col-start-4 lg:self-center lg:text-[19px]">
        <Money amount={row.total_price} market={market} locale={locale} />
      </div>
    </article>
  );
}

export const DeliveryRow = memo(DeliveryRowInner);
