"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FollowUpCard, followUpCardAccent } from "./FollowUpCard";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { UseFollowUpsColumnReturn } from "@/hooks/useFollowUpsColumn";
import type { FollowUpStatus, OrderFollowUpWithOrder } from "@/types/follow-up";
import type { KanbanDensity } from "@/components/shared/KanbanBoard";

const ACCENT_COLOR: Record<string, string> = {
  neutral: "#6D7175",
  success: "#008060",
  warning: "#B98900",
  critical: "#D72C0D",
};

const STATUS_ACCENT: Record<FollowUpStatus, keyof typeof ACCENT_COLOR> = {
  open: "neutral",
  in_progress: "neutral",
  resolved: "success",
  escalated: "critical",
};

export interface FollowUpsKanbanColumn {
  status: FollowUpStatus;
  label: string;
  data: UseFollowUpsColumnReturn;
  count: number;
  onAdd?: () => void;
}

interface Props {
  columns: FollowUpsKanbanColumn[];
  marketCode: "TN" | "LY";
  locale: string;
  density?: KanbanDensity;
  /**
   * Called when a card is dropped into a different column. Return a rejected
   * promise or throw to roll back the optimistic move.
   */
  onMove: (
    item: OrderFollowUpWithOrder,
    fromStatus: FollowUpStatus,
    toStatus: FollowUpStatus,
  ) => Promise<void>;
}

export function FollowUpsKanban({
  columns,
  marketCode,
  locale,
  density = "comfortable",
  onMove,
}: Props) {
  const [dragOver, setDragOver] = useState<FollowUpStatus | null>(null);
  const [overlay, setOverlay] = useState<Record<string, FollowUpStatus>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const isCompact = density === "compact";
  const bodyPadding = isCompact ? 6 : 8;
  const cardGap = isCompact ? 6 : 8;
  const columnGap = isCompact ? 10 : 12;

  const itemsById = useMemo(() => {
    const m = new Map<string, OrderFollowUpWithOrder>();
    for (const col of columns) for (const row of col.data.rows) m.set(row.id, row);
    return m;
  }, [columns]);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    item: OrderFollowUpWithOrder,
    fromStatus: FollowUpStatus,
  ) => {
    const id = item.id;
    e.dataTransfer.setData("text/kanban-id", id);
    e.dataTransfer.setData("text/kanban-from", fromStatus);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };

  const handleDragEnd = () => setDraggingId(null);

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    toStatus: FollowUpStatus,
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== toStatus) setDragOver(toStatus);
  };

  const handleDragLeave = () => setDragOver(null);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>, toStatus: FollowUpStatus) => {
      e.preventDefault();
      setDragOver(null);
      setDraggingId(null);

      const id = e.dataTransfer.getData("text/kanban-id");
      const fromRaw = e.dataTransfer.getData("text/kanban-from") as FollowUpStatus;
      if (!id || !fromRaw || fromRaw === toStatus) return;
      const item = itemsById.get(id);
      if (!item) return;

      setOverlay((o) => ({ ...o, [id]: toStatus }));
      try {
        await onMove(item, fromRaw, toStatus);
      } catch {
        setOverlay((o) => {
          const next = { ...o };
          delete next[id];
          return next;
        });
      }
    },
    [itemsById, onMove],
  );

  // Apply overlay: a card being optimistically moved shows in its destination.
  const displayed = useMemo(() => {
    if (Object.keys(overlay).length === 0) {
      return Object.fromEntries(
        columns.map((c) => [c.status, c.data.rows]),
      ) as Record<FollowUpStatus, OrderFollowUpWithOrder[]>;
    }
    const map: Record<FollowUpStatus, OrderFollowUpWithOrder[]> = {
      open: [],
      in_progress: [],
      resolved: [],
      escalated: [],
    };
    for (const col of columns) {
      for (const row of col.data.rows) {
        const dest = overlay[row.id] ?? row.status;
        if (dest in map) map[dest as FollowUpStatus].push(row);
      }
    }
    return map;
  }, [overlay, columns]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        gap: columnGap,
        overflowX: isMobile ? "visible" : "auto",
        paddingBottom: 8,
        alignItems: "stretch",
      }}
    >
      {columns.map((col) => {
        const rows = displayed[col.status] ?? [];
        const isOver = dragOver === col.status;
        const accent = STATUS_ACCENT[col.status];
        return (
          <div
            key={col.status}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.status)}
            style={{
              flex: isMobile ? "0 0 auto" : "0 0 304px",
              width: isMobile ? "100%" : undefined,
              minHeight: isMobile ? 240 : 480,
              maxHeight: isMobile ? "none" : "min(calc(100dvh - 200px), 720px)",
              background: "#FFFFFF",
              border: `1px solid ${isOver ? "#1A1A1A" : "#E1E3E5"}`,
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              transition: "border-color 120ms ease",
              overflow: "hidden",
              isolation: "isolate",
            }}
          >
            <div
              style={{
                height: 2,
                background: ACCENT_COLOR[accent],
                width: "100%",
              }}
            />
            <ColumnHeader
              label={col.label}
              total={col.count}
              isCompact={isCompact}
              onAdd={col.onAdd}
            />
            <div
              style={{
                padding: bodyPadding,
                display: "flex",
                flexDirection: "column",
                gap: cardGap,
                overflowY: "auto",
                background: isOver ? "#F6F6F7" : "#FFFFFF",
                flex: 1,
                transition: "background-color 120ms ease",
              }}
            >
              {rows.length === 0 && !col.data.isLoading ? (
                <EmptyState isOver={isOver} />
              ) : (
                rows.map((row) => {
                  const acc = followUpCardAccent(row);
                  const isDragging = draggingId === row.id;
                  return (
                    <div
                      key={row.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, row, col.status)}
                      onDragEnd={handleDragEnd}
                      style={{
                        position: "relative",
                        opacity: isDragging ? 0.55 : 1,
                        transition: "opacity 120ms ease",
                        borderInlineStart:
                          acc !== "neutral"
                            ? `3px solid ${ACCENT_COLOR[acc]}`
                            : undefined,
                        paddingInlineStart: acc !== "neutral" ? 2 : 0,
                      }}
                    >
                      <FollowUpCard
                        followUp={row}
                        marketCode={marketCode}
                        locale={locale}
                        density={density}
                      />
                    </div>
                  );
                })
              )}
              {col.data.hasMore ? (
                <LoadMore
                  loading={col.data.loadingMore}
                  onClick={col.data.loadMore}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColumnHeader({
  label,
  total,
  isCompact,
  onAdd,
}: {
  label: string;
  total: number;
  isCompact: boolean;
  onAdd?: () => void;
}) {
  return (
    <div
      style={{
        padding: isCompact ? "8px 12px" : "10px 12px",
        borderBottom: "1px solid #E1E3E5",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        position: "sticky",
        top: 0,
        background: "#FFFFFF",
        zIndex: 10,
        boxShadow: "0 1px 0 #E1E3E5",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#1A1A1A",
            background: "#F6F6F7",
            border: "1px solid #E1E3E5",
            borderRadius: 10,
            padding: "1px 8px",
            fontVariantNumeric: "tabular-nums",
            minWidth: 20,
            textAlign: "center",
          }}
        >
          {total}
        </span>
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label="+"
            style={{
              width: 24,
              height: 24,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              background: "#FFFFFF",
              color: "#1A1A1A",
              fontSize: 16,
              lineHeight: 1,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            +
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ isOver }: { isOver: boolean }) {
  const t = useTranslations("crm.followUps");
  return (
    <div
      style={{
        padding: "24px 8px",
        color: "#6D7175",
        fontSize: 12,
        fontWeight: 500,
        textAlign: "center",
        border: isOver ? "1px dashed #1A1A1A" : "1px dashed #E1E3E5",
        borderRadius: 6,
        margin: 4,
      }}
    >
      {t("columnEmpty")}
    </div>
  );
}

function LoadMore({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const t = useTranslations("crm.followUps");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        padding: "8px 10px",
        marginTop: 4,
        border: "1px dashed #E1E3E5",
        borderRadius: 6,
        background: "#FFFFFF",
        color: "#6D7175",
        fontSize: 12,
        fontWeight: 500,
        cursor: loading ? "default" : "pointer",
      }}
    >
      {loading ? t("column.loading") : t("column.loadMore")}
    </button>
  );
}
