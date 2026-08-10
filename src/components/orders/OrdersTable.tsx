"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import type { OrdersListRow } from "@/hooks/useOrdersList";
import { Pagination } from "@/components/shared/Pagination";
import { PAGE_SIZE_OPTIONS } from "@/lib/orders/list-filters";
import { Skeleton } from "@/components/ui/Skeleton";
import { OrderRow } from "./OrderRow";

interface Agent {
  id: string;
  full_name: string;
}

interface Props {
  rows: OrdersListRow[];
  locale: string;
  currencyCode: string;
  agents: Agent[];
  selectedIds: Set<string>;
  highlightedIds: Set<string>;
  cancellingId: string | null;
  recoveringId?: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  currentPage: number;
  pageSize: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onPageSizeChange: (size: number) => void;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onCancel: (id: string) => void;
  onRecover?: (id: string) => void;
  onDuplicateChange?: () => void;
  isLoading: boolean;
  isEmpty: boolean;
}

export function OrdersTable({
  rows,
  locale,
  currencyCode,
  agents,
  selectedIds,
  highlightedIds,
  cancellingId,
  recoveringId,
  hasNext,
  hasPrev,
  currentPage,
  pageSize,
  onNextPage,
  onPrevPage,
  onPageSizeChange,
  onOpen,
  onToggleSelect,
  onToggleSelectAll,
  onCancel,
  onRecover,
  onDuplicateChange,
  isLoading,
  isEmpty,
}: Props) {
  const t = useTranslations("orders");
  const tStatus = useTranslations("orders.statuses");

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.full_name);
    return m;
  }, [agents]);

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id));

  if (isLoading) {
    return <TableSkeleton />;
  }
  if (isEmpty) {
    return (
      <div className="bg-surface-card border border-line-subtle rounded-[8px] px-[18px] py-12 flex flex-col items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-surface-sunken text-ink-muted"
        >
          <Inbox size={18} strokeWidth={1.75} />
        </span>
        <span className="text-[14px] text-ink-secondary">{t("emptyState")}</span>
      </div>
    );
  }

  return (
    <div
      style={{ background: "transparent" }}
    >
      <div style={{ overflowX: "auto" }}>
        <table
          className="oms-rows"
          style={{
            width: "100%",
            minWidth: 900,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 64 }} />
            {/* 56, not 48: the kebab is always visible now, and a 28px target
                inside 48px of column left it crowding the source logo. */}
            <col style={{ width: 56 }} />
          </colgroup>
          <thead>
            <tr style={{ background: "var(--oms-bg)", position: "sticky", top: 0, zIndex: 1 }}>
              <th style={headerStyle}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={() => onToggleSelectAll(rows.map((r) => r.id))}
                  aria-label={t("columns.selectAll")}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={headerStyle}>{t("columns.order")}</th>
              <th style={{ ...headerStyle, textAlign: "end" }}>{t("columns.totalPrice")}</th>
              <th style={headerStyle}>{t("columns.status")}</th>
              <th style={headerStyle}>{t("columns.age")}</th>
              <th style={headerStyle}>{t("columns.agent")}</th>
              <th style={headerStyle}>{t("columns.source")}</th>
              <th style={headerStyle} aria-label={t("columns.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <OrderRow
                key={r.id}
                order={r}
                locale={locale}
                selected={selectedIds.has(r.id)}
                highlighted={highlightedIds.has(r.id)}
                currencyCode={currencyCode}
                agentName={r.assigned_to ? agentNameById.get(r.assigned_to) ?? null : null}
                labels={{
                  status: tStatus(r.status),
                  unassigned: t("unassigned"),
                  cancel: t("actions.cancel"),
                  recover: t("actions.recover"),
                  actions: t("columns.actions"),
                  callbackOverdue: t("callbackOverdue"),
                  priorRejected: t("priorRejected", {
                    count: r.prior_rejected_count ?? 0,
                  }),
                  carrierBarcodeDeleted: t("carrierBarcodeDeleted"),
                }}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
                onCancel={onCancel}
                cancellingId={cancellingId}
                onRecover={onRecover}
                recoveringId={recoveringId}
                onDuplicateChange={onDuplicateChange}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        hasNext={hasNext}
        hasPrev={hasPrev}
        rangeFrom={rows.length > 0 ? (currentPage - 1) * pageSize + 1 : undefined}
        rangeTo={rows.length > 0 ? (currentPage - 1) * pageSize + rows.length : undefined}
        onNext={onNextPage}
        onPrev={onPrevPage}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div
      role="status"
      className="bg-surface-card border border-line-subtle rounded-[8px] p-[18px] flex flex-col gap-2.5"
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

/**
 * Column heads sit on the page ground, not on a card.
 *
 * They used to be 13px uppercase on `#FFFFFF` — a white band the sticky row
 * behind them set to `var(--oms-bg)`, so the header disagreed with itself and
 * showed a seam on scroll. At 13px with letter-spacing they also out-weighed
 * the 14px row data they label. Now: 11px, the ink-3 step, and the same ground
 * as the row they are stuck to.
 */
const headerStyle: React.CSSProperties = {
  textAlign: "start",
  padding: "10px 16px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--oms-ink-3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  borderBottom: "1px solid var(--oms-border)",
  background: "var(--oms-bg)",
};
