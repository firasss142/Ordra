"use client";

import React, { useMemo, useState } from "react";

export type KanbanAccent =
  | "neutral"
  | "action"
  | "success"
  | "warning"
  | "critical";

// Functional accent tokens — these mirror the design-system status colors
// (--action / --success / --warning / --critical / --neutral). Kept inline
// because the rest of the board uses inline styles.
const ACCENT_COLOR: Record<KanbanAccent, string> = {
  neutral: "#6D7175",
  action: "#2C6ECB",
  success: "#008060",
  warning: "#B98900",
  critical: "#D72C0D",
};

export interface KanbanColumn {
  key: string;
  label: string;
  /** Optional functional accent line rendered at the top of the column. */
  accent?: KanbanAccent;
  /** Optional right-aligned node beside the count chip (e.g. a KPI pill). */
  kpi?: React.ReactNode;
  /** When provided, a "+" button is rendered in the column header. */
  onAdd?: () => void;
  /** Accessible label for the "+" button (should be translated). */
  addLabel?: string;
}

export type KanbanDensity = "comfortable" | "compact";

export interface KanbanBoardProps<T> {
  columns: KanbanColumn[];
  items: T[];
  /** Unique identifier for each item (used as React key + drag payload) */
  getItemId: (item: T) => string;
  /** Return the column key this item belongs to */
  groupBy: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  /**
   * Optional per-card accent rendered as a 3px inline-start strip.
   * Use sparingly — functional signal only (urgency / attention).
   */
  cardAccent?: (item: T) => KanbanAccent;
  /**
   * Called when a card is dragged from one column to another.
   * Return a rejected promise or throw to roll back the optimistic update.
   * Omit to render a read-only board.
   */
  onMove?: (item: T, fromKey: string, toKey: string) => Promise<void> | void;
  emptyLabel?: string;
  /** Visual density; "compact" tightens gaps. Default "comfortable". */
  density?: KanbanDensity;
}

/**
 * Generic, RTL-safe Kanban using the HTML5 drag-and-drop API.
 * Columns scroll horizontally when content exceeds viewport width.
 */
export function KanbanBoard<T>({
  columns,
  items,
  getItemId,
  groupBy,
  renderCard,
  onMove,
  emptyLabel,
  cardAccent,
  density = "comfortable",
}: KanbanBoardProps<T>) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Record<string, string>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const isCompact = density === "compact";
  const bodyPadding = isCompact ? 6 : 8;
  const cardGap = isCompact ? 6 : 8;
  const columnGap = isCompact ? 10 : 12;

  const grouped = useMemo(() => {
    const map = new Map<string, T[]>();
    columns.forEach((c) => map.set(c.key, []));
    for (const item of items) {
      const key = groupBy(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [columns, items, groupBy]);

  const itemsById = useMemo(() => {
    const m = new Map<string, T>();
    for (const i of items) m.set(getItemId(i), i);
    return m;
  }, [items, getItemId]);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    item: T,
    fromKey: string
  ) => {
    if (!onMove) return;
    const id = getItemId(item);
    e.dataTransfer.setData("text/kanban-id", id);
    e.dataTransfer.setData("text/kanban-from", fromKey);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    toKey: string
  ) => {
    if (!onMove) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== toKey) setDragOver(toKey);
  };

  const handleDragLeave = () => setDragOver(null);

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    toKey: string
  ) => {
    if (!onMove) return;
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);

    const id = e.dataTransfer.getData("text/kanban-id");
    const fromKey = e.dataTransfer.getData("text/kanban-from");
    if (!id || !fromKey || fromKey === toKey) return;

    const item = itemsById.get(id);
    if (!item) return;

    // Optimistic UI: overlay the item into the target column until SWR revalidates
    setOverlay((o) => ({ ...o, [id]: toKey }));
    try {
      await onMove(item, fromKey, toKey);
    } catch {
      // Roll back overlay on error
      setOverlay((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    }
  };

  const displayGrouped = useMemo(() => {
    if (Object.keys(overlay).length === 0) return grouped;
    const next = new Map<string, T[]>();
    columns.forEach((c) => next.set(c.key, []));
    for (const item of items) {
      const id = getItemId(item);
      const key = overlay[id] ?? groupBy(item);
      if (!next.has(key)) next.set(key, []);
      next.get(key)!.push(item);
    }
    return next;
  }, [overlay, grouped, items, columns, groupBy, getItemId]);

  return (
    <div
      data-kanban-density={density}
      style={{
        display: "flex",
        gap: columnGap,
        overflowX: "auto",
        paddingBottom: 8,
        alignItems: "flex-start",
      }}
    >
      {columns.map((col) => {
        const colItems = displayGrouped.get(col.key) ?? [];
        const isOver = dragOver === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => handleDragOver(e, col.key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.key)}
            style={{
              flex: "0 0 304px",
              minHeight: 480,
              background: "white",
              border: `1px solid ${isOver ? "#1A1A1A" : "#E1E3E5"}`,
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              transition: "border-color 120ms ease",
              overflow: "hidden",
            }}
          >
            {/* Top functional accent — only rendered when column.accent is set */}
            {col.accent && (
              <div
                data-kanban-accent={col.accent}
                style={{
                  height: 2,
                  background: ACCENT_COLOR[col.accent],
                  width: "100%",
                }}
              />
            )}

            {/* Column header — uppercase tracked label, monochrome */}
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
                background: "white",
                zIndex: 1,
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
                {col.label}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {col.kpi && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#6D7175",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {col.kpi}
                  </span>
                )}
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
                  {colItems.length}
                </span>
                {col.onAdd && (
                  <button
                    type="button"
                    aria-label={col.addLabel ?? "+"}
                    onClick={(e) => {
                      e.stopPropagation();
                      col.onAdd!();
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid #E1E3E5",
                      borderRadius: 6,
                      background: "white",
                      color: "#1A1A1A",
                      fontSize: 16,
                      lineHeight: 1,
                      cursor: "pointer",
                      flexShrink: 0,
                      transition: "border-color 120ms ease, background-color 120ms ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "#F6F6F7";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#C9CCCF";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "white";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#E1E3E5";
                    }}
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            {/* Column body */}
            <div
              style={{
                padding: bodyPadding,
                display: "flex",
                flexDirection: "column",
                gap: cardGap,
                overflowY: "auto",
                background: isOver ? "#F6F6F7" : "white",
                flex: 1,
                transition: "background-color 120ms ease",
              }}
            >
              {colItems.length === 0 ? (
                <div
                  style={{
                    padding: "24px 8px",
                    color: "#6D7175",
                    fontSize: 12,
                    fontWeight: 500,
                    textAlign: "center",
                    border: isOver
                      ? "1px dashed #1A1A1A"
                      : "1px dashed #E1E3E5",
                    borderRadius: 6,
                    margin: 4,
                    transition: "border-color 120ms ease",
                  }}
                >
                  {emptyLabel ?? "—"}
                </div>
              ) : (
                colItems.map((item) => {
                  const id = getItemId(item);
                  const isDragging = draggingId === id;
                  const isHovered = hoveredId === id;
                  const isFocused = focusedId === id;
                  const accent = cardAccent?.(item) ?? "neutral";
                  const showAccentStrip = accent !== "neutral";
                  return (
                    <div
                      key={id}
                      draggable={Boolean(onMove)}
                      onDragStart={(e) => handleDragStart(e, item, col.key)}
                      onDragEnd={handleDragEnd}
                      onMouseEnter={() => setHoveredId(id)}
                      onMouseLeave={() =>
                        setHoveredId((prev) => (prev === id ? null : prev))
                      }
                      onFocus={() => setFocusedId(id)}
                      onBlur={() =>
                        setFocusedId((prev) => (prev === id ? null : prev))
                      }
                      tabIndex={onMove ? 0 : -1}
                      style={{
                        position: "relative",
                        cursor: onMove ? "grab" : "default",
                        opacity: isDragging ? 0.5 : 1,
                        borderRadius: 8,
                        background: isHovered ? "#FAFBFB" : "transparent",
                        outline: isFocused ? "2px solid #1A1A1A" : "none",
                        outlineOffset: 2,
                        transition:
                          "opacity 120ms ease, background-color 120ms ease",
                      }}
                    >
                      {showAccentStrip ? (
                        <span
                          data-card-accent={accent}
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            insetInlineStart: 0,
                            top: 0,
                            bottom: 0,
                            width: 3,
                            background: ACCENT_COLOR[accent],
                            borderStartStartRadius: 8,
                            borderEndStartRadius: 8,
                            pointerEvents: "none",
                          }}
                        />
                      ) : (
                        // Still emit a marker so tests / tooling can tell the card
                        // rendered with no accent.
                        <span
                          data-card-accent="neutral"
                          aria-hidden="true"
                          style={{ display: "none" }}
                        />
                      )}
                      {renderCard(item)}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
