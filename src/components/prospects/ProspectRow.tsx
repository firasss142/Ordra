"use client";

/**
 * One prospect. A single element that lays out as the table row on desktop and
 * as the card on mobile, so nothing is rendered twice for screen readers
 * except the two action buttons, one of which is always hidden.
 *
 * Design: prototypes/prospects-v3.html.
 */
import { memo } from "react";
import { ArrowRight, MapPin, Package, Phone } from "lucide-react";
import { BUCKET_TONE, moveFor, situationOf } from "@/lib/prospects/presentation";
import { formatPhone } from "@/lib/prospects/presentation";
import type { ProspectRow as Row } from "@/lib/prospects/types";
import {
  Chip, EDGE, Ltr, Money, OUTLINE_BTN, SIT_ICON, TONE,
  useSituationLabel, useSituationSub,
} from "./ui";
import { useTranslations } from "next-intl";

interface Props {
  row: Row;
  selected: boolean;
  /**
   * The clock, rounded to the minute — and only for the two buckets whose text
   * changes with it. A campaign, win-back or converted row is handed a
   * constant, so the minute tick no longer re-renders the whole list: with a
   * market's ~300 prospects that was ~300 wasted renders a minute, each
   * rebuilding a chip, two buttons and a formatted amount.
   */
  now: number;
  market: "ly" | "tn";
  locale: string;
  tz: string;
  onSelect: (row: Row) => void;
  onAct: (row: Row) => void;
}

function ProspectRowInner({ row, selected, now, market, locale, tz, onSelect, onAct }: Props) {
  const t = useTranslations("prospects");
  const situationLabel = useSituationLabel(tz, locale);
  const situationSub = useSituationSub();

  const tone = BUCKET_TONE[row.bucket];
  const sit = situationOf(row, now);
  const move = moveFor(row, now);
  const SitIcon = SIT_ICON[sit.key];
  const moveLabel = t(`moves.${move.kind}`);
  const sub = situationSub(sit.sub);

  const act = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAct(row);
  };

  return (
    <div
      role="listitem"
      tabIndex={0}
      onClick={() => onSelect(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row);
        }
      }}
      className={[
        EDGE, TONE[tone].edge,
        "mb-2 grid cursor-pointer gap-x-2.5 rounded-[10px] border text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#15803D]/40",
        "grid-cols-[minmax(0,1fr)_auto] px-3.5 py-3 ps-4",
        "lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_96px] lg:items-center lg:gap-x-4 lg:px-4 lg:py-2.5 lg:ps-5",
        selected ? "border-[1.5px] border-[#15803D] bg-[#F0FDF4]" : "border-[#E5E7EB] bg-white hover:border-[#C9CCCF]",
      ].join(" ")}
    >
      {/* Who */}
      <div className="col-start-1 row-start-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-[16px] font-bold text-[#111827] [unicode-bidi:plaintext] lg:text-[15px]">
            {row.customer_name}
          </span>
        </div>
        <div className="mt-0.5 text-[14px] text-[#374151]">
          <Ltr>{formatPhone(row.customer_phone)}</Ltr>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13.5px] text-[#374151]">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin size={14} aria-hidden className="shrink-0 text-[#6B7280]" />
            <span className="truncate [unicode-bidi:plaintext]">{row.customer_city ?? "—"}</span>
            {row.product_name ? <span className="lg:hidden"> · {row.product_name}</span> : null}
          </span>
          {row.product_name ? (
            <span className="hidden items-center gap-1 lg:inline-flex">
              <Package size={14} aria-hidden className="shrink-0 text-[#6B7280]" />
              <span className="truncate">{row.product_name}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Situation */}
      <div className="col-span-2 col-start-1 row-start-2 mt-2 flex flex-col items-start lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0">
        <Chip tone={tone} icon={SitIcon}>{situationLabel(sit)}</Chip>
        {sub ? (
          <span className="mt-1.5 line-clamp-1 text-[13.5px] text-[#6B7280] [unicode-bidi:plaintext]">{sub}</span>
        ) : null}
      </div>

      {/* Move — a full-width tinted bar on the phone, an outlined pill on desktop. */}
      <div className="col-span-2 col-start-1 row-start-3 mt-2.5 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:mt-0">
        <button
          type="button"
          onClick={act}
          className={`flex h-10 w-full items-center gap-2 rounded-lg px-3.5 text-[14px] font-semibold text-[#111827] lg:hidden ${TONE[tone].soft}`}
        >
          <span className="truncate">{moveLabel}</span>
          <ArrowRight size={16} aria-hidden className="ms-auto shrink-0 rtl:-scale-x-100" />
        </button>
        <button
          type="button"
          onClick={act}
          className={`hidden h-11 min-w-0 px-4 text-[14px] lg:inline-flex ${OUTLINE_BTN} ${TONE[tone].border}`}
        >
          <Phone size={17} aria-hidden className={`shrink-0 ${TONE[tone].icon}`} />
          <span className="truncate">{moveLabel}</span>
        </button>
      </div>

      {/* Value — only when a product says what it is worth. */}
      <div className="col-start-2 row-start-1 text-end lg:col-start-4">
        {row.product_price !== null ? (
          <>
            <Money amount={row.product_price} market={market} locale={locale} className="text-[17px] font-bold text-[#111827]" />
            <div className="mt-0.5 text-[12px] font-medium text-[#6B7280]">
              {row.bucket === "converted" ? t("value.order") : t("value.potential")}
            </div>
          </>
        ) : (
          <span aria-hidden className="text-[15px] text-[#D1D5DB]">—</span>
        )}
      </div>
    </div>
  );
}

export const ProspectRowCard = memo(ProspectRowInner);
