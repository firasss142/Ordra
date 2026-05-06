"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  applyFilters,
  applySubgroup,
  groupRowsByCarrier,
  groupRowsByCity,
  groupRowsByProduct,
  groupRowsBySchedule,
  groupRowsByStatus,
  groupRowsFlat,
  summarizeScheduled,
} from "@/lib/to-ship/group";
import { flagStockWarnings } from "@/lib/to-ship/stock-warning";
import type { Group, Grouping, Subgrouping, ToShipFilters, ToShipRow } from "@/lib/to-ship/types";
import { openPdfBlob } from "@/lib/pdf-utils";
import { ToShipFilterBar, type FilterOption } from "./ToShipFilterBar";
import { ToShipGroupingControl } from "./ToShipGroupingControl";

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

const STORAGE_KEY = "toShip:groupingV2";

interface PersistedState {
  primary: Grouping;
  secondary: Subgrouping;
  filters: ToShipFilters;
}

const DEFAULT_STATE: PersistedState = {
  primary: "city",
  secondary: "none",
  filters: { productId: null, city: null },
};

function loadPersisted(): PersistedState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      primary: parsed.primary ?? DEFAULT_STATE.primary,
      secondary: parsed.secondary ?? DEFAULT_STATE.secondary,
      filters: {
        productId: parsed.filters?.productId ?? null,
        city: parsed.filters?.city ?? null,
      },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function ToShipCockpit({ rows, carriers, currency }: Props) {
  const t = useTranslations("toShip");
  const isMobile = useIsMobile();
  const [grouping, setGrouping] = useState<Grouping>(DEFAULT_STATE.primary);
  const [subgrouping, setSubgrouping] = useState<Subgrouping>(DEFAULT_STATE.secondary);
  const [filters, setFilters] = useState<ToShipFilters>(DEFAULT_STATE.filters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [carrierId, setCarrierId] = useState<string>(carriers[0]?.id ?? "");
  const [dispatching, setDispatching] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; message: string } | null>(null);

  useEffect(() => {
    const persisted = loadPersisted();
    setGrouping(persisted.primary);
    setSubgrouping(persisted.secondary);
    setFilters(persisted.filters);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ primary: grouping, secondary: subgrouping, filters }),
      );
    } catch {
      // ignore
    }
  }, [grouping, subgrouping, filters]);

  const carrierMap = useMemo(
    () => new Map(carriers.map((c) => [c.id, c.label])),
    [carriers],
  );

  const shippableRows = useMemo(
    () => rows.filter((r) => r.status === "confirmed" || r.status === "scanned"),
    [rows],
  );

  const scheduledSummary = useMemo(() => summarizeScheduled(rows, new Date()), [rows]);

  const groupableRows = useMemo(
    () => (grouping === "schedule" ? rows : shippableRows),
    [grouping, rows, shippableRows],
  );

  const filteredRows = useMemo(
    () => applyFilters(groupableRows, filters),
    [groupableRows, filters],
  );

  const stockFlags = useMemo(() => flagStockWarnings(filteredRows), [filteredRows]);

  const productFilterOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>();
    for (const r of shippableRows) {
      if (r.product_id && !seen.has(r.product_id)) seen.set(r.product_id, r.product_name);
    }
    return [...seen.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [shippableRows]);

  const cityFilterOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>();
    for (const r of shippableRows) if (r.customer_city) seen.add(r.customer_city);
    return [...seen].sort().map((c) => ({ id: c, label: c }));
  }, [shippableRows]);

  const groups = useMemo<Group[]>(() => {
    const now = new Date();
    let primary: Group[];
    switch (grouping) {
      case "city":
        primary = groupRowsByCity(filteredRows);
        break;
      case "product":
        primary = groupRowsByProduct(filteredRows);
        break;
      case "carrier":
        primary = groupRowsByCarrier(filteredRows, carrierMap, t("groupBy.carrierUnassigned"));
        break;
      case "schedule":
        primary = groupRowsBySchedule(filteredRows, now, {
          overdue: t("groupBy.scheduleBuckets.overdue"),
          today: t("groupBy.scheduleBuckets.today"),
          tomorrow: t("groupBy.scheduleBuckets.tomorrow"),
          later: t("groupBy.scheduleBuckets.later"),
          unscheduled: t("groupBy.scheduleBuckets.unscheduled"),
        });
        break;
      case "status":
        primary = groupRowsByStatus(filteredRows, {
          confirmed: t("status.confirmed"),
          dispatch_scheduled: t("status.dispatch_scheduled"),
          scanned: t("status.scanned"),
        });
        break;
      case "none":
      default:
        primary = groupRowsFlat(filteredRows);
        break;
    }
    const allowSecondary = grouping === "product" || grouping === "carrier";
    return allowSecondary && subgrouping === "city"
      ? applySubgroup(primary, "city")
      : primary;
  }, [filteredRows, grouping, subgrouping, carrierMap, t]);

  const filtersActive = filters.productId !== null || filters.city !== null;

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
        body: JSON.stringify({
          order_ids: [...selected],
          grouping,
          subgrouping: grouping === "product" || grouping === "carrier" ? subgrouping : "none",
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      openPdfBlob(blob, `picklist-${Date.now()}.pdf`);
    } finally {
      setPrinting(false);
    }
  }, [grouping, subgrouping, printing, selected]);

  return (
    <div style={{ padding: isMobile ? "64px 16px 80px" : 24, backgroundColor: D.bgPage, minHeight: "100vh" }}>
      <Header
        total={shippableRows.length}
        summary={scheduledSummary}
        grouping={grouping}
        onGroupingChange={setGrouping}
        subgrouping={subgrouping}
        onSubgroupingChange={setSubgrouping}
        filters={filters}
        onFiltersChange={setFilters}
        productOptions={productFilterOptions}
        cityOptions={cityFilterOptions}
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
          <EmptyState label={filtersActive ? t("filters.emptyAfterFilter") : t("empty")} />
        ) : (
          groups.map((g) =>
            g.subgroups && g.subgroups.length > 0 ? (
              <NestedGroupCard
                key={g.key}
                parent={g}
                selected={selected}
                stockFlags={stockFlags}
                currency={currency}
                onToggle={toggleSelect}
                onToggleGroup={toggleGroup}
                isMobile={isMobile}
                t={t}
              />
            ) : (
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
                isMobile={isMobile}
                t={t}
              />
            ),
          )
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
          isMobile={isMobile}
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
  subgrouping: Subgrouping;
  onSubgroupingChange: (s: Subgrouping) => void;
  filters: ToShipFilters;
  onFiltersChange: (f: ToShipFilters) => void;
  productOptions: FilterOption[];
  cityOptions: FilterOption[];
  t: ReturnType<typeof useTranslations>;
}

function Header({
  total,
  summary,
  grouping,
  onGroupingChange,
  subgrouping,
  onSubgroupingChange,
  filters,
  onFiltersChange,
  productOptions,
  cityOptions,
  t,
}: HeaderProps) {
  const hasScheduled =
    summary.overdue > 0 || summary.today > 0 || summary.tomorrow > 0 || summary.later > 0;

  const filterLabels = useMemo(
    () => ({
      label: t("filters.label"),
      product: t("filters.product"),
      city: t("filters.city"),
      all: t("filters.all"),
      clear: t("filters.clear"),
      searchPlaceholder: t("filters.search"),
      noResults: t("filters.noResults"),
      activeCount: (n: number) => t("filters.active", { count: n }),
    }),
    [t],
  );

  const groupingLabels = useMemo(
    () => ({
      groupBy: t("groupBy.label"),
      thenBy: t("groupBy.thenBy"),
      city: t("groupBy.city"),
      product: t("groupBy.product"),
      carrier: t("groupBy.carrier"),
      schedule: t("groupBy.schedule"),
      status: t("groupBy.status"),
      none: t("groupBy.none"),
      subCity: t("groupBy.subCity"),
      subNone: t("groupBy.subNone"),
      cityHint: t("groupBy.hints.city"),
      productHint: t("groupBy.hints.product"),
      carrierHint: t("groupBy.hints.carrier"),
      scheduleHint: t("groupBy.hints.schedule"),
      statusHint: t("groupBy.hints.status"),
      noneHint: t("groupBy.hints.none"),
    }),
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-[20px] font-semibold text-ink-primary">{t("title")}</h1>
        <p className="m-0 mt-1 text-[13px] text-ink-secondary">
          {t("subtitle", { count: total })}
        </p>
      </div>

      <div className="bg-surface-card border border-line rounded-card p-3 flex flex-col gap-3 shadow-panel">
        <ToShipFilterBar
          filters={filters}
          onChange={onFiltersChange}
          productOptions={productOptions}
          cityOptions={cityOptions}
          labels={filterLabels}
        />

        <div className="h-px bg-line-subtle -mx-3" />

        <ToShipGroupingControl
          grouping={grouping}
          onChange={onGroupingChange}
          subgrouping={subgrouping}
          onSubgroupingChange={onSubgroupingChange}
          labels={groupingLabels}
        />

        {hasScheduled && (
          <>
            <div className="h-px bg-line-subtle -mx-3" />
            <div className="flex items-center gap-2 flex-wrap">
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
          </>
        )}
      </div>
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
  isMobile?: boolean;
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
  isMobile = false,
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

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r) => {
            const isSelected = selected.has(r.id);
            const warn = stockFlags.get(r.id) === true;
            return (
              <label
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderBottom: `1px solid ${D.border}`,
                  backgroundColor: isSelected ? "#F2F6FC" : D.bgCard,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  aria-label={t("selectRow", { id: r.id.slice(0, 8) })}
                  checked={isSelected}
                  onChange={() => onToggle(r.id)}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: D.textPrimary }}>
                      {r.id.slice(0, 8).toUpperCase()}
                    </span>
                    <StatusCell row={r} warn={warn} t={t} />
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, color: D.textPrimary, fontWeight: 500 }}>
                    {r.customer_name}
                    {r.customer_city ? <span style={{ color: D.textSecondary, fontWeight: 400 }}> · {r.customer_city}</span> : null}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 12, color: D.textSecondary }}>
                    {r.product_name}
                    {r.variant_label ? ` · ${r.variant_label}` : ""}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 12, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: D.textSecondary }}>{t("cols.qty")}: <span style={{ color: D.textPrimary, fontWeight: 500 }}>{r.quantity}</span></span>
                    <span style={{ color: D.textSecondary }}>{t("cols.total")}: <span style={{ color: D.textPrimary, fontWeight: 500 }}>{r.total_price.toFixed(2)} {currency}</span></span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle} aria-hidden="true" />
              <th style={thStyle}>{t("cols.id")}</th>
              <th style={thStyle}>{t("cols.product")}</th>
              <th style={thStyle}>{t("cols.customer")}</th>
              <th style={{ ...thStyle, textAlign: "end" }}>{t("cols.total")}</th>
              <th style={thStyle}>{t("cols.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selected.has(r.id);
              const warn = stockFlags.get(r.id) === true;
              const productInitial = r.product_name.trim()[0]?.toUpperCase() ?? "?";
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
                  <td
                    style={{
                      ...tdStyle,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 13,
                      color: D.textSecondary,
                      whiteSpace: "nowrap",
                    }}
                  >
                    #{r.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: "#F6F6F7",
                          color: D.textPrimary,
                          fontSize: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          marginTop: 1,
                          border: "1px solid #E1E3E5",
                        }}
                      >
                        {productInitial}
                      </span>
                      <div>
                        <div
                          style={{
                            fontWeight: 500,
                            fontSize: 14,
                            color: D.textPrimary,
                            lineHeight: "20px",
                          }}
                        >
                          {r.product_name}
                        </div>
                        {(r.variant_label || r.quantity > 1) && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              marginTop: 2,
                            }}
                          >
                            {r.variant_label && (
                              <span style={{ fontSize: 12, color: D.textSecondary }}>
                                {r.variant_label}
                              </span>
                            )}
                            {r.quantity > 1 && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: D.textSecondary,
                                  background: "#F6F6F7",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  border: "1px solid #E1E3E5",
                                }}
                              >
                                ×{r.quantity}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: 14,
                        color: D.textPrimary,
                        lineHeight: "20px",
                      }}
                    >
                      {r.customer_name}
                    </div>
                    {r.customer_city && (
                      <div style={{ fontSize: 12, color: D.textSecondary, marginTop: 2 }}>
                        {r.customer_city}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "end",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.total_price.toFixed(2)}{" "}
                    <span style={{ fontSize: 12, color: D.textSecondary, fontWeight: 400 }}>
                      {currency}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <StatusCell row={r} warn={warn} t={t} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface NestedGroupCardProps {
  parent: Group;
  selected: Set<string>;
  stockFlags: Map<string, boolean>;
  currency: string;
  onToggle: (id: string) => void;
  onToggleGroup: (rows: ToShipRow[]) => void;
  isMobile: boolean;
  t: ReturnType<typeof useTranslations>;
}

function NestedGroupCard({
  parent,
  selected,
  stockFlags,
  currency,
  onToggle,
  onToggleGroup,
  isMobile,
  t,
}: NestedGroupCardProps) {
  const allSelected = parent.rows.every((r) => selected.has(r.id));
  const someSelected = !allSelected && parent.rows.some((r) => selected.has(r.id));
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
          backgroundColor: "#F4F6F8",
        }}
      >
        <input
          type="checkbox"
          aria-label={t("selectGroup", { heading: parent.label })}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={() => onToggleGroup(parent.rows)}
        />
        <span style={{ fontSize: 14, fontWeight: 600, color: D.textPrimary, flex: 1 }}>
          {parent.label}
        </span>
        <span style={{ fontSize: 12, color: D.textSecondary, fontVariantNumeric: "tabular-nums" }}>
          {t("groupMeta", { count: parent.rows.length, units: parent.totalQuantity })}
        </span>
      </div>
      <div
        style={{
          paddingInlineStart: 16,
          paddingInlineEnd: 0,
          paddingBlock: 12,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          backgroundColor: D.bgPage,
        }}
      >
        {parent.subgroups!.map((sg) => (
          <GroupCard
            key={sg.key}
            heading={sg.label}
            count={sg.rows.length}
            totalQuantity={sg.totalQuantity}
            rows={sg.rows}
            selected={selected}
            stockFlags={stockFlags}
            currency={currency}
            onToggle={onToggle}
            onToggleGroup={() => onToggleGroup(sg.rows)}
            isMobile={isMobile}
            t={t}
          />
        ))}
      </div>
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
  isMobile?: boolean;
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
  isMobile = false,
  t,
}: BulkBarProps) {
  return (
    <div
      role="region"
      aria-label={t("bulkBar.label")}
      style={{
        position: "fixed",
        insetInlineStart: isMobile ? 0 : 240,
        insetInlineEnd: 0,
        bottom: 0,
        backgroundColor: D.textPrimary,
        color: "#FFFFFF",
        padding: isMobile ? "10px 16px" : "12px 24px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        gap: isMobile ? 8 : 12,
        zIndex: 20,
      }}
    >
      {/* Count + clear row on mobile */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {t("bulkBar.selected", { count })}
        </span>
        <button
          type="button"
          onClick={onClear}
          style={{
            all: "unset",
            padding: "4px 8px",
            fontSize: 13,
            color: "#8C9196",
            cursor: "pointer",
          }}
        >
          {t("bulkBar.clear")}
        </button>
      </div>

      {/* Carrier + actions row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <select
          aria-label={t("bulkBar.carrierLabel")}
          value={carrierId}
          onChange={(e) => onCarrierChange(e.target.value)}
          style={{
            flex: isMobile ? 1 : undefined,
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
            flex: isMobile ? 1 : undefined,
            textAlign: "center",
            padding: "8px 14px",
            backgroundColor: dispatching || !carrierId ? "#444" : "#FFFFFF",
            color: dispatching || !carrierId ? "#9CA3AF" : D.textPrimary,
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 4,
            cursor: dispatching || !carrierId ? "not-allowed" : "pointer",
          }}
        >
          {dispatching ? t("bulkBar.uploading") : t("bulkBar.dispatch")}
        </button>
        <button
          type="button"
          onClick={onPrint}
          disabled={printing}
          style={{
            all: "unset",
            flex: isMobile ? 1 : undefined,
            textAlign: "center",
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
        {!isMobile && <div style={{ flex: 1 }} />}
        {!isMobile && (
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
        )}
      </div>
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
