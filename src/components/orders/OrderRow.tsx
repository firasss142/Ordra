"use client";

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { ProductAvatar } from "./ProductAvatar";
import { SourceLogo } from "@/components/shared/SourceLogo";
import { formatDateTime } from "@/lib/format";
import type { OrdersListRow } from "@/hooks/useOrdersList";
import { canManuallyDeleteOrderStatus } from "@/lib/order-permissions";

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
    actions: string;
    callbackOverdue: string;
    priorRejected: string;
    carrierBarcodeDeleted: string;
  };
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  cancellingId: string | null;
  /** Called after a duplicate sibling is deleted from the dialog, to revalidate. */
  onDuplicateChange?: () => void;
}

function RowKebab({
  orderId,
  cancelLabel,
  actionsLabel,
  cancelling,
  onCancel,
}: {
  orderId: string;
  cancelLabel: string;
  actionsLabel: string;
  cancelling: boolean;
  onCancel: (id: string) => void;
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
          <button
            type="button"
            role="menuitem"
            disabled={cancelling}
            onClick={() => {
              onCancel(orderId);
              setOpen(false);
            }}
            className="block w-full rounded-md px-3 py-2 text-start text-[13px] font-medium text-status-critical hover:bg-surface-hover disabled:opacity-50"
          >
            {cancelling ? "…" : cancelLabel}
          </button>
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
  onDuplicateChange,
}: Props) {
  const statusTone = STATUS_TONE[order.status] ?? "neutral";
  const canDelete = canManuallyDeleteOrderStatus(order.status);
  const callbackOverdue =
    !!order.callback_scheduled_at &&
    new Date(order.callback_scheduled_at).getTime() <= Date.now();
  const hasPriorRejections = (order.prior_rejected_count ?? 0) > 0;

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

      {/* Order cell — image + product + customer + city + #id */}
      <td className="px-4 py-2 align-middle">
        <div className="flex items-center gap-3">
          <ProductAvatar
            imageUrl={order.product_image_url ?? null}
            productName={order.product_name}
          />

          {/* Product block */}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-medium leading-5 text-ink-primary">
              {order.product_name}
            </span>
            {order.variant_label && (
              <span className="shrink-0 text-[12px] text-ink-secondary">
                · {order.variant_label}
              </span>
            )}
            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-primary">
              ×{order.quantity}
            </span>
          </div>

          {/* Divider */}
          <span aria-hidden className="h-4 w-px shrink-0 bg-line-subtle" />

          {/* Customer block */}
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
            <span className="truncate text-[14px] font-medium leading-5 text-ink-primary">
              {order.customer_name}
            </span>
            {order.customer_city && (
              <span className="shrink-0 text-[12px] text-ink-secondary">
                · {order.customer_city}
              </span>
            )}
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
                anchorProductName={order.product_name}
                anchorProductImageUrl={order.product_image_url ?? null}
                anchorCustomerName={order.customer_name}
                anchorCustomerAddress={order.customer_address}
                anchorCustomerCity={order.customer_city}
                currencyCode={currencyCode}
                canDelete
                onChange={onDuplicateChange}
              />
            )}
          </div>

          {/* Order ID — pushed to inline-end */}
          <span className="ms-auto shrink-0 font-mono text-[12px] tabular-nums text-ink-secondary">
            #{order.external_id ?? order.id.slice(0, 8)}
          </span>
        </div>
      </td>

      {/* Price */}
      <td className="whitespace-nowrap px-4 py-2 text-end align-middle">
        <span className="text-[15px] font-semibold tabular-nums text-ink-primary">
          {order.total_price.toFixed(2)}
        </span>
        <span className="ms-1 text-[11px] font-medium text-ink-secondary">
          {currencyCode}
        </span>
      </td>

      {/* Status + callback overdue flag */}
      <td className="whitespace-nowrap px-4 py-2 align-middle">
        <span className="inline-flex items-center">
          <Badge tone={statusTone}>{labels.status}</Badge>
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

      {/* Created date */}
      <td className="whitespace-nowrap px-4 py-2 text-start align-middle">
        <span className="text-[13px] tabular-nums text-ink-secondary">
          {formatDateTime(order.created_at, locale)}
        </span>
      </td>

      {/* Assignee */}
      <td className="whitespace-nowrap px-4 py-2 align-middle">
        <span
          className={`block truncate text-[13px] font-medium ${
            agentName ? "text-ink-primary" : "text-ink-secondary"
          }`}
        >
          {agentName ?? labels.unassigned}
        </span>
      </td>

      {/* Source platform — logo with tooltip */}
      <td className="whitespace-nowrap px-4 py-2 align-middle">
        <SourceLogo platform={order.external_platform} />
      </td>

      {/* Actions — hover-revealed kebab */}
      <td className="px-2 py-2 align-middle">
        {canDelete && (
          <RowKebab
            orderId={order.id}
            cancelLabel={labels.cancel}
            actionsLabel={labels.actions}
            cancelling={cancellingId === order.id}
            onCancel={onCancel}
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
    prev.locale === next.locale &&
    prev.currencyCode === next.currencyCode &&
    prev.labels.status === next.labels.status &&
    prev.labels.cancel === next.labels.cancel &&
    prev.labels.actions === next.labels.actions &&
    prev.labels.callbackOverdue === next.labels.callbackOverdue &&
    prev.labels.priorRejected === next.labels.priorRejected &&
    prevOverdue === nextOverdue
  );
});
