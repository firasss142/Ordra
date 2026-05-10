"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { OrdersListRow } from "@/hooks/useOrdersList";
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
  hasNext: boolean;
  hasPrev: boolean;
  currentPage: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onCancel: (id: string) => void;
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
  hasNext,
  hasPrev,
  currentPage,
  onNextPage,
  onPrevPage,
  onOpen,
  onToggleSelect,
  onToggleSelectAll,
  onCancel,
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
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: "48px 18px",
          textAlign: "center",
          color: "#6D7175",
          fontSize: 14,
        }}
      >
        {t("emptyState")}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 860,
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 48 }} />
          </colgroup>
          <thead>
            <tr style={{ background: "#FFFFFF", position: "sticky", top: 0, zIndex: 1 }}>
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
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderTop: "1px solid #E1E3E5",
          background: "#FAFAFA",
        }}
      >
        <button
          type="button"
          onClick={onPrevPage}
          disabled={!hasPrev}
          style={{
            ...paginationBtnStyle,
            opacity: hasPrev ? 1 : 0.35,
            cursor: hasPrev ? "pointer" : "default",
          }}
        >
          {t("previous")}
        </button>

        <span style={{ fontSize: 13, color: "#6D7175" }}>
          {t("page", { page: currentPage })}
        </span>

        <button
          type="button"
          onClick={onNextPage}
          disabled={!hasNext}
          style={{
            ...paginationBtnStyle,
            opacity: hasNext ? 1 : 0.35,
            cursor: hasNext ? "pointer" : "default",
          }}
        >
          {t("next")}
        </button>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 40,
            background: "#F7F7F7",
            borderRadius: 6,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  textAlign: "start",
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
  background: "#FFFFFF",
};

const paginationBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 500,
  color: "#1A1A1A",
  background: "#FFFFFF",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
};
