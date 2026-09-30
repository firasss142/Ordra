"use client";

import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";
import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check, Clock, MapPin, MessageSquare, Phone } from "lucide-react";
import {
  isBulkCallEligible,
  canDeleteDuplicateSiblingStatus,
  isReferenceDeletedUpload,
  EDIT_BLOCKED_STATUSES,
} from "@/lib/order-permissions";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { formatDateTime } from "@/lib/format";
import { classifyOrderAge, formatOrderAge, AGE_TONE } from "@/lib/orders/order-age";
import { classifyLastAction, LAST_ACTION_TONE } from "@/lib/queue/last-action";
import { ageGaugePercent, GAUGE_TONE, GAUGE_PILL_TONE } from "@/lib/queue/age-gauge";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { getCarrierLogo } from "@/lib/carriers/carrier-logos";
import { carrierAccountRing } from "@/lib/carriers/carrier-account-mark";
import type { QueueOrder } from "@/types/queue";
import type { BucketKey } from "./QueueHeader";
import { highlightSegments, type HighlightSegment } from "@/lib/queue/highlight";
import type { ParsedQuery, SearchField } from "@/lib/queue/search";
import { QUEUE_ROW_GRID, QUEUE_ROW_SPACING } from "./row-grid";
import { ManagerPresenceMark } from "./ManagerPresenceMark";
import type { PresenceRow } from "@/hooks/useOrderLocks";

interface OrderCardProps {
  order: QueueOrder;
  /** Managers/admins standing on this order. Advisory — never blocks the agent. */
  presenceRows?: PresenceRow[];
  onOpenDetail: (orderId: string) => void;
  /**
   * Opens the call-outcome sheet. Reached from the row's call button on the
   * phone; on the desktop the row opens the panel and the outcome is recorded
   * there, so the button is not rendered.
   */
  onCallTerminated?: (orderId: string) => void;
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

/** No call left to record once the order is finished. */
const TERMINAL_STATUSES = new Set([
  "delivered",
  "returned",
  "rejected",
  "deleted",
  "cancelled",
]);

export const OrderCard = memo(function OrderCard({
  order,
  presenceRows,
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
  const tWa = useTranslations("whatsapp");
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

  function getCustomerInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  const displayCurrency = formatDisplayCurrencyCode(order.currency, order.market_id);
  const nowMs = now?.getTime();

  // One clock on the row. The age is how long the customer has waited; how long
  // since an agent acted is said in words in the activity cell instead, because
  // two adjacent elapsed-time columns were a guessing game unlabelled.
  const age = classifyOrderAge(order.created_at, order.status, nowMs);
  const lastAction = classifyLastAction({
    lastActionAt: order.last_action_at,
    status: order.status,
    attemptsCount: order.attempt_count,
    maxAttempts,
    nowMs,
  });

  // Non-null only for carriers that run more than one account.
  const accountRing = carrierAccountRing(order.carrier_code, order.carrier_id);

  const showBadges =
    order.status !== "deleted" &&
    (order.repeat_kind !== "none" ||
      (order.is_potential_duplicate && order.is_duplicate_anchor));

  // The call affordance is back on the row, but as a glyph rather than the old
  // labelled button: on the phone the row is the whole screen, and reaching the
  // outcome sheet through the panel cost two taps for the commonest action.
  // Hidden once the carrier owns the parcel — there is no call left to record.
  const canRecordCall =
    !TERMINAL_STATUSES.has(order.status) &&
    (isReferenceDeletedUpload(order) || !EDIT_BLOCKED_STATUSES.has(order.status));

  return (
    <div
      data-order-id={order.id}
      data-focused={focused || undefined}
      data-selected={isSelected || undefined}
      onClick={() => onOpenDetail(order.id)}
      className={[
        "group relative grid cursor-pointer",
        QUEUE_ROW_GRID,
        QUEUE_ROW_SPACING,
        "mb-2 items-center overflow-hidden rounded-xl border border-agent-outline-variant bg-agent-surface py-2.5",
        "lg:mb-0 lg:min-h-[66px] lg:overflow-visible lg:rounded-none lg:border-0 lg:border-b",
        "lg:last:overflow-hidden lg:last:rounded-b-xl lg:last:border-b-0",
        "transition-[background-color,box-shadow,border-color] duration-base",
        "hover:border-agent-outline lg:hover:border-agent-outline-variant lg:hover:bg-agent-surface-low",
        isSelected
          ? [
              "border-[1.5px] border-brand bg-brand-tint",
              "lg:border-transparent lg:bg-agent-surface lg:rounded-lg",
              "lg:[box-shadow:inset_0_0_0_1.5px_var(--brand)]",
            ].join(" ")
          : "",
      ].join(" ")}
    >
      {/* Bulk-select checkbox — only on orders a "Start calls" batch can act on.
          The capture puts it in its own column ahead of the client, and only on
          the desktop table: the phone card has no bulk mode. */}
      <span className="hidden lg:flex justify-center">
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
              "inline-flex h-5 w-5 items-center justify-center rounded-[5px] border",
              "transition-all duration-fast",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-agent-primary/40 focus-visible:ring-offset-1",
              isSelected
                ? "border-agent-primary bg-agent-primary opacity-100"
                : "border-agent-outline bg-agent-surface opacity-0 hover:border-agent-on-surface group-hover:opacity-100 focus-visible:opacity-100 [[data-has-selection]_&]:opacity-100",
            ].join(" ")}
          >
            {isSelected && (
              <Check size={13} strokeWidth={3} className="text-white" aria-hidden="true" />
            )}
          </button>
        )}
      </span>

      {/* Client — thumbnail, who, then what. One cell, two lines, exactly as the
          capture draws it. On the phone it spans both rows of the card. */}
      <div className="row-span-2 flex min-w-0 items-center gap-2.5 lg:row-span-1 lg:gap-3">
        <span className="relative shrink-0">
          {order.product_image_url ? (
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[9px] border border-agent-outline-variant bg-agent-surface-low lg:h-11 lg:w-11">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={order.product_image_url}
                alt={productDisplayName}
                width={44}
                height={44}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-agent-outline-variant bg-agent-surface-low text-[13px] font-bold text-agent-on-surface-variant lg:h-11 lg:w-11"
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

        <div className="flex min-w-0 flex-col gap-[2px]">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[14px] font-bold tracking-[-0.005em] text-agent-on-surface lg:text-[15px]">
              <Highlighted value={order.customer_name} field="name" query={highlightQuery} />
            </span>

            {/* Someone from the office is in this order. Advisory only. */}
            {presenceRows && presenceRows.length > 0 && (
              <ManagerPresenceMark rows={presenceRows} />
            )}

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

          {/* The product, and — once a carrier owns the parcel — whose it is.
              The capture has no carrier column, so the mark rides the line it
              belongs to rather than costing the table a sixth track. */}
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-agent-ink-3 lg:text-[13px]">
            {/* WhatsApp on this order — « a répondu » while a reply is unread
                (prototype whatsapp-agent-v1.html, queue row). */}
            {order.wa_conversation && (
              <>
                <span data-testid="queue-row-whatsapp" className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand">
                  <WhatsAppGlyph size={13} strokeWidth={2} />
                  {(order.wa_unread ?? 0) > 0 ? tWa("prospects.replied") : tWa("button")}
                </span>
                <span aria-hidden="true" className="shrink-0 text-agent-outline">·</span>
              </>
            )}
            {productDisplayName && (
              <span className="min-w-0 truncate">
                {productDisplayName}
                {order.variant_label ? ` · ${order.variant_label}` : ""}
              </span>
            )}
            {order.customer_city && (
              <>
                <span aria-hidden="true" className="hidden shrink-0 text-agent-outline lg:inline">
                  ·
                </span>
                <span className="hidden shrink-0 items-center gap-1 lg:inline-flex">
                  <MapPin size={11} strokeWidth={2} aria-hidden="true" />
                  <Highlighted value={order.customer_city} field="city" query={highlightQuery} />
                </span>
              </>
            )}
            {order.carrier_code && (
              <span
                className="inline-flex shrink-0 items-center"
                title={order.carrier_name ?? order.carrier_code}
              >
                {getCarrierLogo(order.carrier_code) ? (
                  // Two Darb Assabil accounts share one code and therefore one
                  // logo file. The ring is the only thing separating a Tripoli
                  // shipment from a Benghazi one at 18px — and because colour
                  // must never be the sole signal, the account name stays in
                  // `title` and in `alt` (§4.18, named exception).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getCarrierLogo(order.carrier_code)!}
                    alt={order.carrier_name ?? order.carrier_code}
                    width={18}
                    height={18}
                    loading="lazy"
                    decoding="async"
                    data-carrier-account={accountRing ? order.carrier_id : undefined}
                    className={
                      accountRing
                        ? "h-[18px] w-auto rounded-full object-contain ring-2 ring-offset-1 ring-offset-agent-surface"
                        : "h-[18px] w-auto object-contain"
                    }
                    style={accountRing ? { ["--tw-ring-color" as string]: accountRing } : undefined}
                  />
                ) : (
                  <span
                    aria-label={order.carrier_name ?? order.carrier_code}
                    className="inline-flex h-[18px] items-center justify-center rounded border border-agent-outline-variant bg-agent-surface-low px-1.5 text-[10px] font-bold uppercase text-agent-ink-3"
                  >
                    {(order.carrier_name ?? order.carrier_code).slice(0, 3)}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Activity — how many calls out of the allowance, and when the last one
          was. The counter is the capture's own "n / 8"; the sentence beside it
          is what the second elapsed-time column used to say in digits. */}
      <div
        data-testid="order-activity"
        className="col-start-3 row-start-2 flex min-w-0 items-center justify-end gap-2 lg:col-auto lg:row-auto lg:justify-start lg:gap-2.5"
      >
        <span
          data-testid="order-attempts"
          className="inline-flex h-[22px] shrink-0 items-center justify-center rounded-lg border border-agent-outline-variant px-2 text-[11.5px] font-semibold tabular-nums text-agent-on-surface-variant lg:h-[26px] lg:rounded-[8px] lg:px-2.5 lg:text-[13px]"
        >
          <span dir="ltr">
            {order.attempt_count} / {maxAttempts}
          </span>
        </span>

        <span
          data-tier={lastAction.tier}
          title={
            now && order.last_action_at ? formatDateTime(order.last_action_at, locale) : undefined
          }
          className={[
            "hidden min-w-0 items-center gap-1.5 truncate text-[13px] lg:inline-flex",
            lastAction.minutes === null ? "text-agent-ink-3" : LAST_ACTION_TONE[lastAction.tier],
          ].join(" ")}
        >
          {lastAction.minutes === null ? (
            now ? (
              t("row.notCalled")
            ) : (
              ""
            )
          ) : (
            <>
              <Phone size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              <span className="truncate">
                {now ? t("row.calledAgo", { time: formatOrderAge(lastAction.minutes, locale) }) : ""}
              </span>
            </>
          )}
        </span>
      </div>

      {/* Age — the number, and under it the bar that lets the column be ranked
          without reading any of it. */}
      <div
        data-testid="order-age"
        data-tier={age.tier}
        title={now ? formatDateTime(order.created_at, locale) : undefined}
        className="col-start-2 row-start-2 flex min-w-0 flex-col items-start gap-1 justify-self-start lg:col-auto lg:row-auto lg:gap-1.5"
      >
        <span
          className={[
            "inline-flex items-center gap-1 whitespace-nowrap tabular-nums",
            "h-[22px] rounded-md px-1.5 text-[12px] font-bold lg:h-auto lg:rounded-none lg:px-0 lg:text-[16px]",
            GAUGE_PILL_TONE[age.tier],
            `lg:bg-transparent ${AGE_TONE[age.tier]}`,
          ].join(" ")}
        >
          <Clock size={12} strokeWidth={2.4} aria-hidden="true" className="shrink-0 lg:hidden" />
          {now ? formatOrderAge(age.minutes, locale) : ""}
        </span>
        <span
          aria-hidden="true"
          className="h-[3px] w-[70px] overflow-hidden rounded-pill bg-agent-surface-high lg:h-[5px] lg:w-[180px]"
        >
          <span
            data-testid="order-age-gauge"
            data-tier={age.tier}
            className={`block h-full rounded-pill ${GAUGE_TONE[age.tier]}`}
            style={{ width: `${now ? ageGaugePercent(age.minutes) : 0}%` }}
          />
        </span>
      </div>

      {/* Money — currency then amount, left-to-right, as the capture prints it. */}
      <span
        dir="ltr"
        className="col-start-3 row-start-1 flex items-baseline justify-end gap-1 justify-self-end lg:col-auto lg:row-auto lg:justify-start lg:justify-self-start"
      >
        <span className="text-[11.5px] font-medium text-agent-ink-3">{displayCurrency}</span>
        <span className="text-[15px] font-bold tracking-[-0.01em] text-agent-on-surface tabular-nums lg:text-[17px]">
          {order.total_price}
        </span>
      </span>

      {/* The call button, phone only. The desktop row opens the panel and the
          outcome is recorded there — the owner asked for the labelled end-call
          button to leave the table, not for the action to move. */}
      {canRecordCall && onCallTerminated && (
        <button
          type="button"
          data-testid="row-call"
          aria-label={t("callEnded")}
          onClick={(e) => {
            e.stopPropagation();
            onCallTerminated(order.id);
          }}
          className="col-start-4 row-span-2 row-start-1 inline-grid h-11 w-11 place-items-center self-center rounded-[11px] bg-brand text-white transition-colors duration-fast hover:bg-brand-hover lg:hidden"
        >
          <Phone size={19} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
