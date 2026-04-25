"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { groupRowsByCity, groupRowsByProduct, summarizeScheduled } from "@/lib/to-ship/group";
import { flagStockWarnings } from "@/lib/to-ship/stock-warning";
import type { Grouping, ToShipRow } from "@/lib/to-ship/types";
import { openPdfBlob } from "@/lib/pdf-utils";

interface CarrierOption {
  id: string;
  code: string;
  label: string;
}

interface Props {
  rows: ToShipRow[];
  carriers: CarrierOption[];
  currency: string;
}

const D = {
  bgPage: "#F6F6F7",
  bgCard: "#FFFFFF",
  bgHover: "#F7F7F7",
  border: "#E1E3E5",
  borderStrong: "#C9CCCF",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  successBg: "#F1F8F5",
  success: "#008060",
  warningBg: "#FFF8E6",
  warning: "#B98900",
  criticalBg: "#FFF4F4",
  critical: "#D72C0D",
  neutralBg: "#F6F6F7",
  neutral: "#6D7175",
  actionBg: "#EEF3FB",
  action: "#2C6ECB",
} as const;

type FeedbackKind = "success" | "error" | null;

export function ToShipCockpit({ rows, carriers, currency }: Props) {
  const t = useTranslations("toShip");
  const [grouping, setGrouping] = useState<Grouping>("city");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [carrierId, setCarrierId] = useState<string>(carriers[0]?.id ?? "");
  const [dispatching, setDispatching] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; message: string } | null>(null);

  const shippableRows = useMemo(
    () => rows.filter((r) => r.status === "confirmed" || r.status === "scanned"),
    [rows],
  );

  const scheduledSummary = useMemo(() => summarizeScheduled(rows, new Date()), [rows]);

  const stockFlags = useMemo(() => flagStockWarnings(shippableRows), [shippableRows]);

  const groups = useMemo(
    () => (grouping === "city" ? groupRowsByCity(shippableRows) : groupRowsByProduct(shippableRows)),
    [grouping, shippableRows],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupRows: ToShipRow[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = groupRows.every((r) => next.has(r.id));
      if (allSelected) groupRows.forEach((r) => next.delete(r.id));
      else groupRows.forEach((r) => next.add(r.id));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleBulkDispatch = useCallback(async () => {
    if (selected.size === 0 || !carrierId || dispatching) return;
    setDispatching(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/orders/bulk-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: [...selected], carrier_id: carrierId }),
      });
      if (!res.ok) {
        setFeedback({ kind: "error", message: t("bulkDispatch.networkError") });
        return;
      }
      const json = (await res.json()) as {
        succeeded: Array<{ order_id: string }>;
        failed: Array<{ order_id: string; error: string }>;
      };
      if (json.failed.length === 0) {
        setFeedback({
          kind: "success",
          message: t("bulkDispatch.allSucceeded", { count: json.succeeded.length }),
        });
      } else if (json.succeeded.length === 0) {
        setFeedback({
          kind: "error",
          message: t("bulkDispatch.allFailed", { count: json.failed.length }),
        });
      } else {
        setFeedback({
          kind: "error",
          message: t("bulkDispatch.partial", {
            ok: json.succeeded.length,
            bad: json.failed.length,
          }),
        });
      }
      // Keep failed rows selected so the operator can retry them
      const failedIds = new Set(json.failed.map((f) => f.order_id));
      setSelected(failedIds);
    } finally {
      setDispatching(false);
    }
  }, [carrierId, dispatching, selected, t]);

  const handlePrintPicklist = useCallback(async () => {
    if (selected.size === 0 || printing) return;
    setPrinting(true);
    try {
      const res = await fetch("/api/to-ship/picklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: [...selected], grouping }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      openPdfBlob(blob, `picklist-${Date.now()}.pdf`);
    } finally {
      setPrinting(false);
    }
  }, [grouping, printing, selected]);

  return (
    <div style={{ padding: 24, backgroundColor: D.bgPage, minHeight: "100vh" }}>
      <Header
        total={shippableRows.length}
        summary={scheduledSummary}
        grouping={grouping}
        onGroupingChange={setGrouping}
        t={t}
      />

      {feedback && (
        <div
          role="status"
          style={{
            marginTop: 16,
            padding: "8px 12px",
            fontSize: 13,
            borderRadius: 6,
            backgroundColor: feedback.kind === "success" ? D.successBg : D.criticalBg,
            color: feedback.kind === "success" ? D.success : D.critical,
            border: `1px solid ${feedback.kind === "success" ? D.success : D.critical}`,
          }}
        >
          {feedback.message}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {groups.length === 0 ? (
          <EmptyState label={t("empty")} />
        ) : (
          groups.map((g) => (
            <GroupCard
              key={g.key}
              heading={g.label}
              count={g.rows.length}
              totalQuantity={g.totalQuantity}
              rows={g.rows}
              selected={selected}
              stockFlags={stockFlags}
              currency={currency}
              onToggle={toggleSelect}
              onToggleGroup={() => toggleGroup(g.rows)}
              t={t}
            />
          ))
        )}
      </div>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          carriers={carriers}
          carrierId={carrierId}
          onCarrierChange={setCarrierId}
          onDispatch={handleBulkDispatch}
          onPrint={handlePrintPicklist}
          onClear={clearSelection}
          dispatching={dispatching}
          printing={printing}
          t={t}
        />
      )}
    </div>
  );
}

interface HeaderProps {
  total: number;
  summary: ReturnType<typeof summarizeScheduled>;
  grouping: Grouping;
  onGroupingChange: (g: Grouping) => void;
  t: ReturnType<typeof useTranslations>;
}

function Header({ total, summary, grouping, onGroupingChange, t }: HeaderProps) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: D.textPrimary }}>
            {t("title")}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: D.textSecondary }}>
            {t("subtitle", { count: total })}
          </p>
        </div>
        <GroupingToggle grouping={grouping} onChange={onGroupingChange} t={t} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {summary.overdue > 0 && (
          <Pill tone="critical" label={t("scheduled.overdue", { count: summary.overdue })} />
        )}
        {summary.today > 0 && (
          <Pill
            tone="action"
            label={t("scheduled.today", {
              count: summary.today,
              auto: summary.todayAuto,
            })}
          />
        )}
        {summary.tomorrow > 0 && (
          <Pill tone="warning" label={t("scheduled.tomorrow", { count: summary.tomorrow })} />
        )}
        {summary.later > 0 && (
          <Pill tone="neutral" label={t("scheduled.later", { count: summary.later })} />
        )}
      </div>
    </div>
  );
}

function GroupingToggle({
  grouping,
  onChange,
  t,
}: {
  grouping: Grouping;
  onChange: (g: Grouping) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const btn = (value: Grouping, label: string) => {
    const active = grouping === value;
    return (
      <button
        key={value}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(value)}
        style={{
          all: "unset",
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          color: active ? D.textPrimary : D.textSecondary,
          backgroundColor: active ? D.bgCard : "transparent",
          border: `1px solid ${active ? D.borderStrong : D.border}`,
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="tablist" aria-label={t("groupBy.label")} style={{ display: "flex", gap: 6 }}>
      {btn("city", t("groupBy.city"))}
      {btn("product", t("groupBy.product"))}
    </div>
  );
}

function Pill({
  tone,
  label,
}: {
  tone: "critical" | "warning" | "action" | "neutral";
  label: string;
}) {
  const palette = {
    critical: { bg: D.criticalBg, fg: D.critical },
    warning: { bg: D.warningBg, fg: D.warning },
    action: { bg: D.actionBg, fg: D.action },
    neutral: { bg: D.neutralBg, fg: D.neutral },
  }[tone];
  return (
    <span
      style={{
        fontSize: 13,
        fontWeight: 500,
        padding: "4px 10px",
        borderRadius: 9999,
        backgroundColor: palette.bg,
        color: palette.fg,
      }}
    >
      {label}
    </span>
  );
}

interface GroupCardProps {
  heading: string;
  count: number;
  totalQuantity: number;
  rows: ToShipRow[];
  selected: Set<string>;
  stockFlags: Map<string, boolean>;
  currency: string;
  onToggle: (id: string) => void;
  onToggleGroup: () => void;
  t: ReturnType<typeof useTranslations>;
}

function GroupCard({
  heading,
  count,
  totalQuantity,
  rows,
  selected,
  stockFlags,
  currency,
  onToggle,
  onToggleGroup,
  t,
}: GroupCardProps) {
  const allSelected = rows.every((r) => selected.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selected.has(r.id));
  return (
    <div
      style={{
        backgroundColor: D.bgCard,
        border: `1px solid ${D.border}`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: `1px solid ${D.border}`,
          backgroundColor: "#FAFBFB",
        }}
      >
        <input
          type="checkbox"
          aria-label={t("selectGroup", { heading })}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={onToggleGroup}
        />
        <span style={{ fontSize: 14, fontWeight: 600, color: D.textPrimary, flex: 1 }}>
          {heading}
        </span>
        <span style={{ fontSize: 12, color: D.textSecondary, fontVariantNumeric: "tabular-nums" }}>
          {t("groupMeta", { count, units: totalQuantity })}
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle} aria-hidden="true" />
            <th style={thStyle}>{t("cols.id")}</th>
            <th style={thStyle}>{t("cols.customer")}</th>
            <th style={thStyle}>{t("cols.product")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("cols.qty")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("cols.total")}</th>
            <th style={thStyle}>{t("cols.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selected.has(r.id);
            const warn = stockFlags.get(r.id) === true;
            return (
              <tr
                key={r.id}
                style={{
                  backgroundColor: isSelected ? "#F2F6FC" : D.bgCard,
                }}
              >
                <td style={tdStyle}>
                  <input
                    type="checkbox"
                    aria-label={t("selectRow", { id: r.id.slice(0, 8) })}
                    checked={isSelected}
                    onChange={() => onToggle(r.id)}
                  />
                </td>
                <td style={{ ...tdStyle, fontFamily: "monospace" }}>
                  {r.id.slice(0, 8).toUpperCase()}
                </td>
                <td style={tdStyle}>
                  <div>{r.customer_name}</div>
                  <div style={{ fontSize: 12, color: D.textSecondary }}>
                    {r.customer_city ?? "—"}
                  </div>
                </td>
                <td style={tdStyle}>
                  <div>{r.product_name}</div>
                  {r.variant_label && (
                    <div style={{ fontSize: 12, color: D.textSecondary }}>{r.variant_label}</div>
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "end",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {r.quantity}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "end",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {r.total_price.toFixed(2)} {currency}
                </td>
                <td style={tdStyle}>
                  <StatusCell row={r} warn={warn} t={t} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusCell({
  row,
  warn,
  t,
}: {
  row: ToShipRow;
  warn: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const statusTone: Record<string, { bg: string; fg: string; label: string }> = {
    confirmed: { bg: D.successBg, fg: D.success, label: t("status.confirmed") },
    scanned: { bg: D.actionBg, fg: D.action, label: t("status.scanned") },
    dispatch_scheduled: {
      bg: D.warningBg,
      fg: D.warning,
      label: t("status.dispatch_scheduled"),
    },
  };
  const tone = statusTone[row.status] ?? {
    bg: D.neutralBg,
    fg: D.neutral,
    label: row.status,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 9999,
          fontSize: 13,
          fontWeight: 500,
          backgroundColor: tone.bg,
          color: tone.fg,
          width: "fit-content",
        }}
      >
        {tone.label}
      </span>
      {warn && (
        <span
          role="status"
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: D.critical,
          }}
        >
          {t("stockWarning")}
        </span>
      )}
    </div>
  );
}

interface BulkBarProps {
  count: number;
  carriers: CarrierOption[];
  carrierId: string;
  onCarrierChange: (id: string) => void;
  onDispatch: () => void;
  onPrint: () => void;
  onClear: () => void;
  dispatching: boolean;
  printing: boolean;
  t: ReturnType<typeof useTranslations>;
}

function BulkBar({
  count,
  carriers,
  carrierId,
  onCarrierChange,
  onDispatch,
  onPrint,
  onClear,
  dispatching,
  printing,
  t,
}: BulkBarProps) {
  return (
    <div
      role="region"
      aria-label={t("bulkBar.label")}
      style={{
        position: "fixed",
        insetInlineStart: 240,
        insetInlineEnd: 0,
        bottom: 0,
        backgroundColor: D.textPrimary,
        color: "#FFFFFF",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        zIndex: 20,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {t("bulkBar.selected", { count })}
      </span>
      <select
        aria-label={t("bulkBar.carrierLabel")}
        value={carrierId}
        onChange={(e) => onCarrierChange(e.target.value)}
        style={{
          padding: "6px 8px",
          borderRadius: 4,
          border: "1px solid #444",
          backgroundColor: "#2A2A2A",
          color: "#FFFFFF",
          fontSize: 13,
        }}
      >
        {carriers.length === 0 && <option value="">{t("bulkBar.noCarriers")}</option>}
        {carriers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onDispatch}
        disabled={!carrierId || dispatching}
        style={{
          all: "unset",
          padding: "8px 14px",
          backgroundColor: dispatching || !carrierId ? "#444" : "#FFFFFF",
          color: dispatching || !carrierId ? "#9CA3AF" : D.textPrimary,
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 4,
          cursor: dispatching || !carrierId ? "not-allowed" : "pointer",
        }}
      >
        {dispatching ? t("bulkBar.dispatching") : t("bulkBar.dispatch")}
      </button>
      <button
        type="button"
        onClick={onPrint}
        disabled={printing}
        style={{
          all: "unset",
          padding: "8px 14px",
          backgroundColor: "transparent",
          color: "#FFFFFF",
          fontSize: 13,
          fontWeight: 500,
          border: "1px solid #444",
          borderRadius: 4,
          cursor: printing ? "not-allowed" : "pointer",
        }}
      >
        {printing ? t("bulkBar.printing") : t("bulkBar.printPicklist")}
      </button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onClear}
        style={{
          all: "unset",
          padding: "8px 12px",
          fontSize: 13,
          color: "#8C9196",
          cursor: "pointer",
        }}
      >
        {t("bulkBar.clear")}
      </button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: 48,
        textAlign: "center",
        backgroundColor: D.bgCard,
        border: `1px solid ${D.border}`,
        borderRadius: 6,
        color: D.textSecondary,
        fontSize: 14,
      }}
    >
      {label}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "start",
  fontSize: 13,
  fontWeight: 500,
  color: D.textSecondary,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "10px 16px",
  borderBottom: `1px solid ${D.borderStrong}`,
};

const tdStyle: React.CSSProperties = {
  fontSize: 14,
  color: D.textPrimary,
  padding: "10px 16px",
  borderBottom: `1px solid ${D.border}`,
  verticalAlign: "top",
};
