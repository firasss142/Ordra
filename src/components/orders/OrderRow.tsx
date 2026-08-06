"use client";

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, RotateCcw, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { StatusHistoryPopover } from "./StatusHistoryPopover";
import { ProductAvatar } from "./ProductAvatar";
import { SourceLogo } from "@/components/shared/SourceLogo";
import { formatDateTime } from "@/lib/format";
import { classifyOrderAge, formatOrderAge, AGE_TONE } from "@/lib/orders/order-age";
import type { OrdersListRow } from "@/hooks/useOrdersList";
import { canManuallyDeleteOrderStatus } from "@/lib/order-permissions";

/** Deterministic hue per agent so the same person keeps the same colour. */
function AgentAvatar({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span
        aria-hidden
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-oms-border-strong text-[11px] text-oms-ink-3"
      >
        +
      </span>
    );
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      aria-hidden
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold uppercase text-white"
      style={{ background: `linear-gradient(140deg, hsl(${hue} 55% 58%), hsl(${hue} 58% 42%))` }}
    >
      {name.trim().slice(0, 2)}
    </span>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "neutral",
  assigned: "neutral",
  attempt_1: "warning",
  attempt_2: "warning",
  attempt_3: "warning",
  callback_scheduled: "warning",
  confirmed: "action",
  dispatch_scheduled: "action",
  uploaded: "action",
  scanned: "action",
  dispatched: "action",
  deposit: "action",
  in_transit: "action",
  unverified: "warning",
  to_be_returned: "warning",
  received: "action",
  delivered: "success",
  returned: "critical",
  rejected: "critical",
  cancelled: "critical",
  deleted: "neutral",
};

interface Props {
  order: OrdersListRow;
  locale: string;
  selected: boolean;
  highlighted: boolean;
  agentName: string | null;
  currencyCode: string;
  labels: {
    status: string;
    unassigned: string;
    cancel: string;
    recover: string;
    actions: string;
    callbackOverdue: string;
    priorRejected: string;
    carrierBarcodeDeleted: string;
  };
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  cancellingId: string | null;
  /** Recover (un-delete) a soft-deleted order. Optional: only managers/admins. */
  onRecover?: (id: string) => void;
  recoveringId?: string | null;
  /** Called after a duplicate sibling is deleted from the dialog, to revalidate. */
  onDuplicateChange?: () => void;
}

function RowKebab({
  orderId,
  mode,
  cancelLabel,
  recoverLabel,
  actionsLabel,
  pending,
  onCancel,
  onRecover,
}: {
  orderId: string;
  /** "cancel" for deletable orders, "recover" for soft-deleted ones. */
  mode: "cancel" | "recover";
  cancelLabel: string;
  recoverLabel: string;
  actionsLabel: string;
  pending: boolean;
  onCancel: (id: string) => void;
  onRecover?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={actionsLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary opacity-0 transition-colors duration-fast hover:bg-surface-selected hover:text-ink-primary focus-visible:opacity-100 group-hover/row:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-[calc(100%+4px)] z-20 min-w-[160px] rounded-card border border-line bg-surface-card p-1 shadow-floating"
        >
          {mode === "recover" ? (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => {
                onRecover?.(orderId);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-[13px] font-medium text-ink-primary hover:bg-surface-hover disabled:opacity-50"
            >
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
              {pending ? "…" : recoverLabel}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => {
                onCancel(orderId);
                setOpen(false);
              }}
              className="block w-full rounded-md px-3 py-2 text-start text-[13px] font-medium text-status-critical hover:bg-surface-hover disabled:opacity-50"
            >
              {pending ? "…" : cancelLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  order,
  locale,
  selected,
  highlighted,
  agentName,
  currencyCode,
  labels,
  onToggleSelect,
  onOpen,
  onCancel,
  cancellingId,
  onRecover,
  recoveringId,
  onDuplicateChange,
}: Props) {
  const statusTone = STATUS_TONE[order.status] ?? "neutral";
  // Prefer the internal catalog name; fall back to the external storefront
  // string for orders that never resolved to a product.
  const productDisplayName = order.product_display_name || order.product_name;
  const canDelete = canManuallyDeleteOrderStatus(order.status);
  // A soft-deleted order can be recovered by a manager/admin (onRecover passed).
  const canRecover = order.status === "deleted" && onRecover !== undefined;
  const callbackOverdue =
    !!order.callback_scheduled_at &&
    new Date(order.callback_scheduled_at).getTime() <= Date.now();
  const hasPriorRejections = (order.prior_rejected_count ?? 0) > 0;
  const age = classifyOrderAge(order.created_at, order.status);

  const rowBg = selected
    ? "bg-[#F2F6FC]"
    : highlighted
      ? "bg-[#FFFBEA]"
      : "bg-surface-card hover:bg-surface-hover";

  return (
    <tr
      onClick={() => onOpen(order.id)}
      className={`group/row cursor-pointer border-b border-line-subtle transition-colors duration-fast ${rowBg} hover:shadow-hover-row`}
    >
      {/* Checkbox + accent bar */}
      <td
        className="relative px-4 py-2 align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        {highlighted && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-accent"
          />
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(order.id)}
          aria-label={`select ${order.external_id ?? order.id}`}
          className="h-4 w-4 cursor-pointer accent-ink-primary"
        />
      </td>

      {/* Order cell — two-line record: customer leads, product supports.
          The order reference used to live here pushed to inline-end, which is
          what created the empty gap across every row. It now lives in the
          detail panel and stays searchable. */}
      <td className="px-4 py-2 align-middle">
        <div className="flex items-center gap-3">
          <ProductAvatar
            imageUrl={order.product_image_url ?? null}
            productName={productDisplayName}
          />

          <div className="flex min-w-0 flex-col gap-px">
            {/* Line 1 — the row's entry point */}
            <div className="flex min-w-0 items-center gap-1.5">
              {hasPriorRejections && (
              <span
                aria-hidden
                title={labels.priorRejected.replace(
                  "{count}",
                  String(order.prior_rejected_count ?? 0),
                )}
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-critical"
              />
            )}
            <span
              dir="auto"
              className="min-w-0 truncate text-[14px] font-semibold leading-[1.32] tracking-[-0.006em] text-oms-ink-1"
            >
              {order.customer_name}
            </span>
            {order.status !== "deleted" &&
            ((order.repeat_kind && order.repeat_kind !== "none") ||
              (order.is_potential_duplicate && order.is_duplicate_anchor)) ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                {order.repeat_kind && order.repeat_kind !== "none" && (
                  <RepeatBuyerBadge
                    source="order"
                    sourceId={order.id}
                    repeatKind={order.repeat_kind}
                    priorOrderCount={order.prior_order_count ?? 0}
                    priorLeadCount={order.prior_lead_count ?? 0}
                    priorRejectedCount={order.prior_rejected_count ?? 0}
                    currencyCode={currencyCode}
                    customerPhone={order.customer_phone}
                    anchorOrderId={order.id}
                    anchorStatus={order.status}
                    anchorCreatedAt={order.created_at}
                    anchorTotalPrice={order.total_price}
                    anchorProductName={productDisplayName}
                    anchorProductImageUrl={order.product_image_url ?? null}
                    anchorCustomerName={order.customer_name}
                    anchorCustomerAddress={order.customer_address}
                    anchorCustomerCity={order.customer_city}
                  />
                )}
                {order.is_potential_duplicate && order.is_duplicate_anchor && (
                  <DuplicateOrderBadge
                    count={order.duplicate_count ?? 0}
                    siblings={order.duplicate_siblings ?? []}
                    hasUploadedSibling={order.has_uploaded_sibling ?? false}
                    anchorOrderId={order.id}
                    anchorStatus={order.status}
                    anchorCreatedAt={order.created_at}
                    anchorTotalPrice={order.total_price}
                    anchorProductName={productDisplayName}
                    anchorProductImageUrl={order.product_image_url ?? null}
                    anchorCustomerName={order.customer_name}
                    anchorCustomerAddress={order.customer_address}
                    anchorCustomerCity={order.customer_city}
                    currencyCode={currencyCode}
                    canDelete
                    onChange={onDuplicateChange}
                  />
                )}
              </span>
            ) : null}
            </div>

            {/* Line 2 — quiet supporting detail */}
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-[1.34] text-oms-ink-3">
              {order.customer_city && (
                <span dir="auto" className="shrink-0 truncate">
                  {order.customer_city}
                </span>
              )}
              {order.customer_city && <span aria-hidden>·</span>}
              {/* Name and variant stay separate nodes so each resolves its own
                  direction — an Arabic variant beside a Latin name otherwise
                  flips the separator to the wrong side. */}
              <span dir="auto" className="min-w-0 truncate text-oms-ink-2">
                {productDisplayName}
              </span>
              {order.variant_label && (
                <span dir="auto" className="shrink-0 truncate text-oms-ink-3">
                  · {order.variant_label}
                </span>
              )}
              {order.quantity > 1 && (
                <span className="shrink-0 font-semibold tabular-nums text-oms-ink-2">
                  ×{order.quantity}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Price — the loudest thing in the row; currency demoted so the number wins */}
      <td className="whitespace-nowrap px-4 py-2 text-end align-middle">
        <span className="text-[16px] font-[650] tracking-[-0.02em] tabular-nums text-oms-ink-1">
          {order.total_price.toFixed(2)}
        </span>
        <span className="ms-1 text-[10.5px] font-medium uppercase tracking-[0.05em] text-oms-ink-3">
          {currencyCode}
        </span>
      </td>

      {/* Status + callback overdue flag */}
      <td className="whitespace-nowrap px-4 py-2 align-middle">
        <span className="inline-flex items-center">
          <StatusHistoryPopover
            orderId={order.id}
            sourcePlatform={order.external_platform ?? null}
          >
            <Badge tone={statusTone}>{labels.status}</Badge>
          </StatusHistoryPopover>
          {order.carrier_barcode_deleted_at && (
            <span
              className="ms-1.5 inline-flex items-center gap-1 h-[20px] px-1.5 rounded-card border border-line-subtle bg-surface-page text-[10.5px] font-medium text-ink-secondary"
              title={labels.carrierBarcodeDeleted}
            >
              <RotateCcw size={9} strokeWidth={2} aria-hidden="true" />
              {labels.carrierBarcodeDeleted}
            </span>
          )}
          {callbackOverdue && (
            <span className="ms-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-status-critical">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-status-critical"
              />
              {labels.callbackOverdue}
            </span>
          )}
        </span>
      </td>

      {/* Age — how long it has been waiting. Escalates only while the order
          still needs a human; the exact timestamp is on hover. */}
      <td className="whitespace-nowrap px-4 py-2 text-start align-middle">
        <span
          data-testid="order-age"
          data-tier={age.tier}
          title={formatDateTime(order.created_at, locale)}
          className={`inline-flex items-center gap-1 text-[12.5px] tabular-nums ${AGE_TONE[age.tier]}`}
        >
          {age.isBreach && (
            <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          )}
          {formatOrderAge(age.minutes, locale)}
        </span>
      </td>

      {/* Assignee — unassigned is the actionable state, so it reads differently */}
      <td className="whitespace-nowrap px-4 py-2 align-middle">
        <span className="flex items-center gap-2">
          <AgentAvatar name={agentName} />
          <span
            className={`min-w-0 truncate text-[12.5px] ${
              agentName ? "font-medium text-oms-ink-1" : "italic text-oms-ink-3"
            }`}
          >
            {agentName ?? labels.unassigned}
          </span>
        </span>
      </td>

      {/* Source platform — logo with tooltip */}
      <td className="whitespace-nowrap px-4 py-2 align-middle">
        <SourceLogo platform={order.external_platform} />
      </td>

      {/* Actions — hover-revealed kebab */}
      <td className="px-2 py-2 align-middle">
        {(canDelete || canRecover) && (
          <RowKebab
            orderId={order.id}
            mode={canRecover ? "recover" : "cancel"}
            cancelLabel={labels.cancel}
            recoverLabel={labels.recover}
            actionsLabel={labels.actions}
            pending={
              canRecover
                ? recoveringId === order.id
                : cancellingId === order.id
            }
            onCancel={onCancel}
            onRecover={onRecover}
          />
        )}
      </td>
    </tr>
  );
}

export const OrderRow = React.memo(Row, (prev, next) => {
  const prevOverdue =
    !!prev.order.callback_scheduled_at &&
    new Date(prev.order.callback_scheduled_at).getTime() <= Date.now();
  const nextOverdue =
    !!next.order.callback_scheduled_at &&
    new Date(next.order.callback_scheduled_at).getTime() <= Date.now();
  return (
    prev.order === next.order &&
    prev.selected === next.selected &&
    prev.highlighted === next.highlighted &&
    prev.agentName === next.agentName &&
    prev.cancellingId === next.cancellingId &&
    prev.recoveringId === next.recoveringId &&
    prev.onRecover === next.onRecover &&
    prev.locale === next.locale &&
    prev.currencyCode === next.currencyCode &&
    prev.labels.status === next.labels.status &&
    prev.labels.cancel === next.labels.cancel &&
    prev.labels.recover === next.labels.recover &&
    prev.labels.actions === next.labels.actions &&
    prev.labels.callbackOverdue === next.labels.callbackOverdue &&
    prev.labels.priorRejected === next.labels.priorRejected &&
    prevOverdue === nextOverdue
  );
});
