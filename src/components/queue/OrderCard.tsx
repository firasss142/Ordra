"use client";

import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check, MapPin, MessageSquare, Phone } from "lucide-react";
import {
  isReferenceDeletedUpload,
  isBulkCallEligible,
  EDIT_BLOCKED_STATUSES,
  canDeleteDuplicateSiblingStatus,
} from "@/lib/order-permissions";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { classifyOrderAge, formatOrderAge, AGE_TONE } from "@/lib/orders/order-age";
import { classifyLastAction, LAST_ACTION_TONE } from "@/lib/queue/last-action";
import { presentAgentStatus } from "@/lib/queue/agent-status";
import { Button } from "@/components/ui/Button";
import { QueueStatusPill } from "./QueueStatusPill";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { RejectionReasonHover } from "./RejectionReasonHover";
import { getCarrierLogo } from "@/lib/carriers/carrier-logos";
import type { QueueOrder } from "@/types/queue";
import type { BucketKey } from "./QueueHeader";
import { highlightSegments, type HighlightSegment } from "@/lib/queue/highlight";
import type { ParsedQuery, SearchField } from "@/lib/queue/search";
import { QUEUE_ROW_GRID, QUEUE_ROW_SPACING } from "./row-grid";

interface OrderCardProps {
  order: QueueOrder;
  onOpenDetail: (orderId: string) => void;
  onCallTerminated: (orderId: string) => void;
  maxAttempts?: number;
  focused?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** Bucket the row is currently rendered under. Kept for callers; the row's
   *  colour now comes from the status itself, so the two can never disagree. */
  selectedBucket?: BucketKey;
  /** When set (search active), matching substrings are highlighted. */
  highlightQuery?: ParsedQuery;
  /** Called after a duplicate sibling is deleted from the dialog, to revalidate the queue. */
  onMutate?: () => void;
}

/**
 * Renders `value`, wrapping the substrings that match the active search query in
 * <mark>. Short-circuits to plain text when no query is supplied, so normal
 * queue rendering is unaffected.
 */
function Highlighted({
  value,
  field,
  query,
}: {
  value: string;
  field: SearchField;
  query?: ParsedQuery;
}) {
  if (!query) return <>{value}</>;
  const segments: HighlightSegment[] = highlightSegments(value, query, field);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-hue-amber-bg text-inherit rounded-[2px]">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A note or an address change is one glyph until you want it.
 *
 * These used to occupy a whole extra sub-row under the card, which made row
 * height depend on whether a customer happened to leave a comment. Now every
 * row is the same height and the text is a hover (or a tab-stop) away.
 *
 * The panel is anchored to the indicator's inline-start edge rather than
 * centred, so one rule works in both text directions.
 */
function HoverNote({
  label,
  body,
  tone = "neutral",
  children,
}: {
  label: string;
  body: string;
  tone?: "neutral" | "warn";
  children: React.ReactNode;
}) {
  return (
    <span className="group/note relative inline-flex shrink-0">
      <button
        type="button"
        data-hover-note
        aria-label={`${label} — ${body}`}
        onClick={(e) => e.stopPropagation()}
        className={[
          "inline-flex h-[21px] w-[21px] items-center justify-center rounded-md",
          "transition-colors duration-fast",
          tone === "warn"
            ? "text-hue-amber-edge hover:bg-hue-amber-bg"
            : "text-agent-ink-3 hover:bg-agent-surface-low hover:text-agent-on-surface",
        ].join(" ")}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className={[
          "pointer-events-none absolute bottom-[calc(100%+8px)] start-0 z-30",
          "w-max max-w-[260px] rounded-[9px] px-3 py-2 text-start",
          "bg-agent-on-surface text-agent-surface shadow-floating",
          "text-[12px] font-medium leading-relaxed",
          "translate-y-[3px] opacity-0 transition duration-base",
          "group-hover/note:translate-y-0 group-hover/note:opacity-100",
          "group-focus-within/note:translate-y-0 group-focus-within/note:opacity-100",
        ].join(" ")}
      >
        <span className="block text-[10px] font-bold tracking-[0.07em] opacity-60">
          {label}
        </span>
        {body}
      </span>
    </span>
  );
}

/** Per-hue inline-start rail. The row echoes its own status pill's colour. */
const RAIL: Record<string, string> = {
  neutral: "bg-hue-neutral-edge",
  amber: "bg-hue-amber-edge",
  violet: "bg-hue-violet-edge",
  teal: "bg-hue-teal-edge",
  green: "bg-hue-green-edge",
  red: "bg-hue-red-edge",
};

export const OrderCard = memo(function OrderCard({
  order,
  onOpenDetail,
  onCallTerminated,
  maxAttempts = 3,
  focused = false,
  isSelected = false,
  onToggleSelect,
  highlightQuery,
  onMutate,
}: OrderCardProps) {
  const t = useTranslations("queue");
  const locale = useLocale();

  // Mounted-only clock: the server and the client would otherwise disagree on
  // every elapsed value and blow up hydration.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  // Prefer the internal catalog name; fall back to the external storefront
  // string for orders that never resolved to a product.
  const productDisplayName = order.product_display_name || order.product_name;

  // The end-call affordance shows whenever the order is still in the agent's
  // hands, plus uploads whose carrier reference was deleted. Hidden on terminal
  // and carrier-locked statuses.
  const TERMINAL = new Set(["delivered", "returned", "rejected", "deleted", "cancelled"]);
  const showEndCall =
    !TERMINAL.has(order.status) &&
    (isReferenceDeletedUpload(order) || !EDIT_BLOCKED_STATUSES.has(order.status));

  function getCustomerInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  const displayCurrency = formatDisplayCurrencyCode(order.currency, order.market_id);
  const nowMs = now?.getTime();

  // Two clocks. The age is how long the customer has waited; the last action is
  // how long since anyone touched it. They coincide on a new order, which is
  // why the second reads "—" there instead of restating the first.
  const age = classifyOrderAge(order.created_at, order.status, nowMs);
  const lastAction = classifyLastAction({
    lastActionAt: order.last_action_at,
    status: order.status,
    attemptsCount: order.attempt_count,
    maxAttempts,
    nowMs,
  });

  const { hue } = presentAgentStatus(order, { maxAttempts, nowMs });

  const showBadges =
    order.status !== "deleted" &&
    (order.repeat_kind !== "none" ||
      (order.is_potential_duplicate && order.is_duplicate_anchor));

  const statusPill = (
    <QueueStatusPill order={order} maxAttempts={maxAttempts} now={now ?? undefined} />
  );

  return (
    <div
      data-order-id={order.id}
      data-focused={focused || undefined}
      data-selected={isSelected || undefined}
      onClick={() => onOpenDetail(order.id)}
      className={[
        "group relative grid cursor-pointer items-center py-3",
        QUEUE_ROW_GRID,
        QUEUE_ROW_SPACING,
        "border-b border-agent-outline-variant bg-agent-surface",
        "transition-[background-color,box-shadow] duration-base",
        "last:rounded-b-xl last:border-b-0 hover:bg-agent-surface-low hover:shadow-hover-row",
        isSelected ? "bg-hue-green-bg/60" : "",
      ].join(" ")}
    >
      {/* Status rail — the row carries its own status colour at the leading
          edge, so state reads twice: once as colour here, once as a word in
          the status column. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 start-0 w-[3px] ${RAIL[hue] ?? RAIL.neutral}`}
      />

      {/* Bulk-select checkbox — only on orders a "Start calls" batch can act on. */}
      <span className="flex justify-center">
        {onToggleSelect && isBulkCallEligible(order) && (
          <button
            type="button"
            role="checkbox"
            data-checkbox
            aria-checked={isSelected}
            aria-label={t("selectOrder")}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(order.id);
            }}
            className={[
              "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border",
              "transition-all duration-fast",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-agent-primary/40 focus-visible:ring-offset-1",
              isSelected
                ? "border-agent-primary bg-agent-primary opacity-100"
                : "border-agent-outline bg-agent-surface opacity-0 hover:border-agent-on-surface group-hover:opacity-100 focus-visible:opacity-100 [[data-has-selection]_&]:opacity-100",
            ].join(" ")}
          >
            {isSelected && (
              <Check size={12} strokeWidth={3} className="text-white" aria-hidden="true" />
            )}
          </button>
        )}
      </span>

      {/* Leading visual — product image, falling back to customer initials. A
          small ×N badge sits on the corner so multi-unit orders read at a glance. */}
      <span className="relative shrink-0">
        {order.product_image_url ? (
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[9px] border border-agent-outline-variant bg-agent-surface-low">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={order.product_image_url}
              alt={productDisplayName}
              width={40}
              height={40}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-agent-outline-variant bg-agent-surface-low text-[13px] font-bold text-agent-on-surface-variant"
          >
            {getCustomerInitials(order.customer_name)}
          </span>
        )}
        <span
          aria-label={`×${order.quantity}`}
          className="absolute -bottom-1 -end-1 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-pill bg-agent-on-surface px-1 text-[10px] font-bold leading-none text-agent-surface ring-2 ring-agent-surface tabular-nums"
        >
          ×{new Intl.NumberFormat(locale).format(order.quantity)}
        </span>
      </span>

      {/* Identity — who, then what. The product line is the catalogue name, not
          the storefront's marketing sentence, and the city rides with it. */}
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.005em] text-agent-on-surface">
            <Highlighted value={order.customer_name} field="name" query={highlightQuery} />
          </span>

          {showBadges && (
            <span className="inline-flex shrink-0 items-center gap-1">
              {order.repeat_kind !== "none" && (
                <RepeatBuyerBadge
                  source="order"
                  sourceId={order.id}
                  repeatKind={order.repeat_kind}
                  priorOrderCount={order.prior_order_count}
                  priorLeadCount={order.prior_lead_count}
                  priorRejectedCount={order.prior_rejected_count}
                  currencyCode={displayCurrency}
                  customerPhone={order.customer_phone}
                  anchorOrderId={order.id}
                  anchorStatus={order.status}
                  anchorCreatedAt={order.created_at}
                  anchorTotalPrice={order.total_price}
                  anchorProductName={productDisplayName}
                  anchorProductImageUrl={order.product_image_url}
                  anchorCustomerName={order.customer_name}
                  anchorCustomerAddress={order.customer_address}
                  anchorCustomerCity={order.customer_city}
                />
              )}
              {order.is_potential_duplicate && order.is_duplicate_anchor && (
                <DuplicateOrderBadge
                  count={order.duplicate_count}
                  siblings={order.duplicate_siblings}
                  hasUploadedSibling={order.has_uploaded_sibling}
                  anchorOrderId={order.id}
                  anchorStatus={order.status}
                  anchorCreatedAt={order.created_at}
                  anchorTotalPrice={order.total_price}
                  anchorProductName={productDisplayName}
                  anchorProductImageUrl={order.product_image_url}
                  anchorCustomerName={order.customer_name}
                  anchorCustomerAddress={order.customer_address}
                  anchorCustomerCity={order.customer_city}
                  currencyCode={displayCurrency}
                  canDelete={canDeleteDuplicateSiblingStatus(order.status)}
                  onChange={onMutate}
                />
              )}
            </span>
          )}

          {order.last_known_address && (
            <HoverNote
              label={t("addressChanged")}
              body={order.last_known_address}
              tone="warn"
            >
              <MapPin size={13} strokeWidth={2} aria-hidden="true" />
            </HoverNote>
          )}
          {order.customer_note && (
            <HoverNote label={t("customerNote")} body={order.customer_note}>
              <MessageSquare size={13} strokeWidth={2} aria-hidden="true" />
            </HoverNote>
          )}
        </div>

        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-agent-ink-3">
          {productDisplayName && (
            <span className="min-w-0 truncate">
              {productDisplayName}
              {order.variant_label ? ` · ${order.variant_label}` : ""}
            </span>
          )}
          {productDisplayName && order.customer_city && (
            <span aria-hidden="true" className="shrink-0 text-agent-outline">
              ·
            </span>
          )}
          {order.customer_city && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <MapPin size={11} strokeWidth={2} aria-hidden="true" />
              <Highlighted value={order.customer_city} field="city" query={highlightQuery} />
            </span>
          )}
        </span>
      </div>

      {/* Clock 1 — how long the customer has waited. Escalates only while the
          order still needs a human. */}
      <span
        data-testid="order-age"
        data-tier={age.tier}
        className={`hidden lg:inline-flex items-center gap-1 text-[12.5px] tabular-nums ${AGE_TONE[age.tier]}`}
      >
        {now ? formatOrderAge(age.minutes, locale) : ""}
      </span>

      {/* Clock 2 — how long since an agent last acted. A dash means never. */}
      <span
        data-testid="order-last-action"
        data-tier={lastAction.tier}
        className={`hidden lg:inline-flex items-center gap-1 text-[12.5px] tabular-nums ${LAST_ACTION_TONE[lastAction.tier]}`}
      >
        {!now ? "" : lastAction.minutes === null ? "—" : formatOrderAge(lastAction.minutes, locale)}
      </span>

      {/* Status */}
      <span className="hidden min-w-0 lg:flex">
        {order.status === "rejected" ? (
          <RejectionReasonHover reason={order.rejection_reason} note={order.rejection_note}>
            {statusPill}
          </RejectionReasonHover>
        ) : (
          statusPill
        )}
      </span>

      {/* Money — aligned to the trailing edge, tabular so the column stacks. */}
      <span className="flex items-baseline justify-end gap-1">
        <span className="text-[15px] font-bold tracking-[-0.01em] text-agent-on-surface tabular-nums">
          {order.total_price}
        </span>
        <span className="text-[11px] font-semibold text-agent-ink-3">{displayCurrency}</span>
      </span>

      {/* Action — or, once the order is with a carrier, whose it is. */}
      <span className="flex justify-end">
        {showEndCall ? (
          <>
            <Button
              size="sm"
              aria-label={t("callEnded")}
              className="w-8 gap-0 px-0 lg:hidden"
              onClick={(e) => {
                e.stopPropagation();
                onCallTerminated(order.id);
              }}
            >
              <Phone size={14} strokeWidth={2.25} aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              className="hidden whitespace-nowrap lg:inline-flex"
              onClick={(e) => {
                e.stopPropagation();
                onCallTerminated(order.id);
              }}
            >
              {t("callEnded")}
            </Button>
          </>
        ) : (
          order.carrier_code && (
            <span
              className="inline-flex items-center"
              title={order.carrier_name ?? order.carrier_code}
            >
              {getCarrierLogo(order.carrier_code) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getCarrierLogo(order.carrier_code)!}
                  alt={order.carrier_name ?? order.carrier_code}
                  width={20}
                  height={20}
                  loading="lazy"
                  decoding="async"
                  className="h-5 w-auto object-contain"
                />
              ) : (
                <span
                  aria-label={order.carrier_name ?? order.carrier_code}
                  className="inline-flex h-5 items-center justify-center rounded border border-agent-outline-variant bg-agent-surface-low px-1.5 text-[10px] font-bold uppercase text-agent-ink-3"
                >
                  {(order.carrier_name ?? order.carrier_code).slice(0, 3)}
                </span>
              )}
            </span>
          )
        )}
      </span>
    </div>
  );
});
