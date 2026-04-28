"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  History,
  Inbox,
  PackageMinus,
  PackageX,
  PhoneCall,
  RefreshCw,
  Truck,
  UserX,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { useAlerts } from "@/hooks/useAlerts";
import { useMarketScope } from "@/context/market-scope";
import type { Alert, AlertSeverity, AlertType } from "@/app/api/alerts/summary/route";
import type { AuthUser } from "@/types";

const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium", "low"];

const SEVERITY_COLORS: Record<AlertSeverity, { bg: string; fg: string; dot: string }> = {
  critical: { bg: "#FFF4F4", fg: "#B91C1C", dot: "#D72C0D" },
  high: { bg: "#FFF8E6", fg: "#92400E", dot: "#B98900" },
  medium: { bg: "#EEF2FF", fg: "#3730A3", dot: "#4C6EF5" },
  low: { bg: "#F3F4F6", fg: "#374151", dot: "#6D7175" },
};

const TYPE_ICONS: Record<AlertType, LucideIcon> = {
  dispatch_failure: Truck,
  carrier_webhook_stale: AlertTriangle,
  overdue_callback: PhoneCall,
  unassigned_overflow: Inbox,
  return_bottleneck: PackageX,
  low_stock: PackageMinus,
  stock_depleted: PackageMinus,
  agent_inactive: UserX,
};

interface Agent {
  id: string;
  full_name: string;
  market_id: string | null;
  role: string;
}

export function AlertsClient({ user }: { user: AuthUser }) {
  const t = useTranslations("alerts");
  const isMobile = useIsMobile();
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? undefined;

  const { alerts, summary, totalCount, bySeverity, byType, isLoading, error, mutate } = useAlerts({
    marketId,
    realtime: true,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AlertType | "all">("all");
  const [actionBusy, setActionBusy] = useState<"ack" | "snooze" | "reassign" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  const agentParams = marketId ? `?market_id=${marketId}` : "";
  const { data: agentsPayload } = useSWR<{ data: Agent[] }>(`/api/agents${agentParams}`, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const agents = agentsPayload?.data ?? [];

  const filteredAlerts = useMemo(() => {
    if (!alerts) return [];
    return alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      return true;
    });
  }, [alerts, severityFilter, typeFilter]);

  const visibleIds = useMemo(() => filteredAlerts.map((a) => a.id), [filteredAlerts]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const selectedUnassignedOrderIds = useMemo(() => {
    if (!alerts) return [] as string[];
    const selected = alerts.filter((a) => selectedIds.has(a.id));
    return selected
      .filter((a) => a.type === "unassigned_overflow")
      .map((a) => a.entity_id);
  }, [alerts, selectedIds]);

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleAcknowledge = async () => {
    if (selectedIds.size === 0) return;
    setActionBusy("ack");
    setActionError(null);
    try {
      const res = await fetch("/api/alerts/acknowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alert_keys: Array.from(selectedIds),
          ...(marketId && user.role === "super_admin" ? { market_id: marketId } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      clearSelection();
      await mutate();
    } catch {
      setActionError(t("actionError"));
    } finally {
      setActionBusy(null);
    }
  };

  const handleSnooze = async (minutes: number) => {
    if (selectedIds.size === 0) return;
    setActionBusy("snooze");
    setActionError(null);
    try {
      const res = await fetch("/api/alerts/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alert_keys: Array.from(selectedIds),
          minutes,
          ...(marketId && user.role === "super_admin" ? { market_id: marketId } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      clearSelection();
      await mutate();
    } catch {
      setActionError(t("actionError"));
    } finally {
      setActionBusy(null);
    }
  };

  const handleBulkAssign = async (agentId: string) => {
    if (selectedUnassignedOrderIds.length === 0) return;
    setActionBusy("reassign");
    setActionError(null);
    try {
      const res = await fetch("/api/orders/bulk-assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_ids: selectedUnassignedOrderIds,
          agent_id: agentId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAgentPickerOpen(false);
      clearSelection();
      await mutate();
    } catch {
      setActionError(t("actionError"));
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div
      style={{
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
        padding: isMobile ? "64px 16px 48px" : "32px 32px 64px",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
            {t("title")}
          </h1>
          <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
            {totalCount === 0 ? t("subtitleZero") : t("subtitleCount", { count: totalCount })}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => mutate()}
            style={iconButtonStyle}
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            <RefreshCw size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            style={{
              ...iconButtonStyle,
              ...(showHistory ? { backgroundColor: "#F2F2F2", borderColor: "#C9CCCF" } : {}),
            }}
          >
            <History size={14} strokeWidth={1.75} />
            <span style={{ marginInlineStart: 6, fontSize: 12, fontWeight: 500 }}>
              {t("historyButton")}
            </span>
          </button>
        </div>
      </header>

      {/* Filter bar — matches dashboard FilterBar design */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {/* Severity summary strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
            gap: isMobile ? 6 : 8,
          }}
        >
          {SEVERITY_ORDER.map((sev) => (
            <SeverityTile
              key={sev}
              severity={sev}
              count={bySeverity?.[sev] ?? 0}
              active={severityFilter === sev}
              onClick={() =>
                setSeverityFilter((prev) => (prev === sev ? "all" : sev))
              }
              label={t(`severity.${sev}`)}
              compact={isMobile}
            />
          ))}
        </div>

        {/* Type chips */}
        {byType && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              background: "#F6F6F7",
              borderRadius: 8,
              padding: 2,
              border: "1px solid #E1E3E5",
              alignSelf: "flex-start",
            }}
          >
            <Chip
              label={t("filterAllTypes")}
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            />
            {(Object.keys(byType) as AlertType[])
              .filter((t0) => (byType[t0] ?? 0) > 0)
              .map((t0) => (
                <Chip
                  key={t0}
                  label={`${t(`types.${t0}.label`)} · ${byType[t0]}`}
                  active={typeFilter === t0}
                  onClick={() =>
                    setTypeFilter((prev) => (prev === t0 ? "all" : t0))
                  }
                />
              ))}
          </div>
        )}
      </div>

      {/* Error banner */}
      {(error || actionError) && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            backgroundColor: "#FEE2E2",
            color: "#B91C1C",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {actionError ?? t("loadError")}
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <BulkBar
          count={selectedIds.size}
          canReassign={selectedUnassignedOrderIds.length > 0 && selectedUnassignedOrderIds.length === selectedIds.size}
          onClear={clearSelection}
          onAck={handleAcknowledge}
          onSnooze={handleSnooze}
          onReassign={() => setAgentPickerOpen(true)}
          busy={actionBusy}
          agentPickerOpen={agentPickerOpen}
          onCloseAgentPicker={() => setAgentPickerOpen(false)}
          agents={agents}
          onPickAgent={handleBulkAssign}
          t={t}
        />
      )}

      {/* Main panel */}
      <Panel
        title={
          filteredAlerts.length === totalCount
            ? t("listTitle")
            : t("listTitleFiltered", {
                count: filteredAlerts.length,
                total: totalCount,
              })
        }
        actions={
          filteredAlerts.length > 0 ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#6D7175",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                style={{ cursor: "pointer" }}
              />
              {allSelected ? t("deselectAll") : t("selectAll")}
            </label>
          ) : undefined
        }
      >
        {isLoading && !alerts ? (
          <EmptyState label={t("loading")} />
        ) : filteredAlerts.length === 0 ? (
          <AllClear t={t} total={totalCount} hasFilter={severityFilter !== "all" || typeFilter !== "all"} />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                selected={selectedIds.has(alert.id)}
                onToggle={() => toggleOne(alert.id)}
                locale={user.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </Panel>

      {/* History panel */}
      {showHistory && (
        <div style={{ marginTop: 16 }}>
          <HistoryPanel marketId={marketId} t={t} summary={summary} />
        </div>
      )}
    </div>
  );
}

/* ───────────────── Subcomponents ───────────────── */

function SeverityTile({
  severity,
  count,
  active,
  onClick,
  label,
  compact,
}: {
  severity: AlertSeverity;
  count: number;
  active: boolean;
  onClick: () => void;
  label: string;
  compact?: boolean;
}) {
  const colors = SEVERITY_COLORS[severity];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "#F6F6F7" : "#F6F6F7",
        border: active ? `1px solid ${colors.dot}` : "1px solid #E1E3E5",
        borderRadius: 8,
        padding: compact ? "8px 10px" : "10px 12px",
        textAlign: "start",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 3 : 4,
        transition: "border-color 120ms ease",
      }}
      aria-pressed={active}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            backgroundColor: colors.dot,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "#6D7175",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: compact ? 20 : 24,
          fontWeight: 700,
          color: count > 0 ? "#1A1A1A" : "#6D7175",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "#FFFFFF" : "transparent",
        color: "#1A1A1A",
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        padding: "5px 12px",
        borderRadius: 6,
        cursor: "pointer",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

type AlertsTranslator = ReturnType<typeof useTranslations<"alerts">>;

function BulkBar({
  count,
  canReassign,
  onClear,
  onAck,
  onSnooze,
  onReassign,
  busy,
  agentPickerOpen,
  onCloseAgentPicker,
  agents,
  onPickAgent,
  t,
}: {
  count: number;
  canReassign: boolean;
  onClear: () => void;
  onAck: () => void;
  onSnooze: (minutes: number) => void;
  onReassign: () => void;
  busy: "ack" | "snooze" | "reassign" | null;
  agentPickerOpen: boolean;
  onCloseAgentPicker: () => void;
  agents: Agent[];
  onPickAgent: (agentId: string) => void;
  t: AlertsTranslator;
}) {
  return (
    <div
      style={{
        background: "#1A1A1A",
        color: "#FFFFFF",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={onClear}
        aria-label={t("clearSelection")}
        style={{
          background: "transparent",
          border: "none",
          color: "#FFFFFF",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={14} strokeWidth={1.75} />
      </button>
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {t("selectedCount", { count })}
      </span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onAck}
        disabled={busy !== null}
        style={darkBarButton(busy === "ack")}
      >
        <CheckCircle2 size={13} strokeWidth={1.75} />
        <span style={{ marginInlineStart: 6 }}>{t("actions.acknowledge")}</span>
      </button>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => onSnooze(60)}
          disabled={busy !== null}
          style={darkBarButton(busy === "snooze")}
          title={t("actions.snooze1h")}
        >
          <BellOff size={13} strokeWidth={1.75} />
          <span style={{ marginInlineStart: 6 }}>{t("actions.snooze1h")}</span>
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSnooze(60 * 24)}
        disabled={busy !== null}
        style={darkBarButton(false)}
        title={t("actions.snooze1d")}
      >
        <Clock size={13} strokeWidth={1.75} />
        <span style={{ marginInlineStart: 6 }}>{t("actions.snooze1d")}</span>
      </button>
      {canReassign && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={onReassign}
            disabled={busy !== null}
            style={darkBarButton(busy === "reassign")}
          >
            <UsersRound size={13} strokeWidth={1.75} />
            <span style={{ marginInlineStart: 6 }}>{t("actions.reassign")}</span>
          </button>
          {agentPickerOpen && (
            <div
              style={{
                position: "absolute",
                insetInlineEnd: 0,
                top: "calc(100% + 4px)",
                background: "#FFFFFF",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                padding: 6,
                minWidth: 220,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                zIndex: 10,
              }}
              onBlur={onCloseAgentPicker}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 6px 6px",
                  borderBlockEnd: "1px solid #F2F2F2",
                  marginBlockEnd: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1A1A" }}>
                  {t("pickAgent")}
                </span>
                <button
                  type="button"
                  onClick={onCloseAgentPicker}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#6D7175",
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                  }}
                  aria-label={t("close")}
                >
                  <X size={12} strokeWidth={1.75} />
                </button>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflow: "auto" }}>
                {agents.length === 0 ? (
                  <li style={{ padding: "8px 6px", fontSize: 12, color: "#6D7175" }}>
                    {t("noAgents")}
                  </li>
                ) : (
                  agents.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onPickAgent(a.id)}
                        style={{
                          width: "100%",
                          textAlign: "start",
                          padding: "8px 10px",
                          background: "transparent",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 13,
                          color: "#1A1A1A",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#F7F7F7")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        {a.full_name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  selected,
  onToggle,
  locale,
  t,
}: {
  alert: Alert;
  selected: boolean;
  onToggle: () => void;
  locale: string;
  t: AlertsTranslator;
}) {
  const colors = SEVERITY_COLORS[alert.severity];
  const Icon = TYPE_ICONS[alert.type] ?? Bell;
  const metaLabel = formatMeta(alert, t);
  const typeLabel = t(`types.${alert.type}.label`);
  const href = `/${locale}${alert.href}`;

  return (
    <li>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          border: selected ? "1px solid #1A1A1A" : "1px solid #E1E3E5",
          borderRadius: 6,
          backgroundColor: selected ? "#F7F7F7" : "#FFFFFF",
          transition: "background-color 120ms ease, border-color 120ms ease",
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={t("selectAlert", { title: alert.primary || typeLabel })}
          style={{ cursor: "pointer", flexShrink: 0 }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: colors.bg,
            color: colors.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <Link
          href={href}
          style={{
            flex: 1,
            minWidth: 0,
            textDecoration: "none",
            color: "#1A1A1A",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {alert.primary || typeLabel}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#6D7175",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontWeight: 500 }}>{typeLabel}</span>
            {alert.secondary ? ` · ${alert.secondary}` : null}
          </div>
        </Link>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: colors.fg,
            backgroundColor: colors.bg,
            padding: "3px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {metaLabel}
        </span>
      </div>
    </li>
  );
}

function AllClear({ t, total, hasFilter }: { t: AlertsTranslator; total: number; hasFilter: boolean }) {
  return (
    <div
      style={{
        minHeight: 180,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <CheckCircle2 size={28} strokeWidth={1.5} color="#008060" />
      <div style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}>
        {total === 0 ? t("allClearTitle") : t("noneMatchFilter")}
      </div>
      <div style={{ fontSize: 12, color: "#6D7175" }}>
        {total === 0 || !hasFilter ? t("allClearSubtitle") : t("adjustFilters")}
      </div>
    </div>
  );
}

function HistoryPanel({
  marketId,
  t,
}: {
  marketId: string | undefined;
  t: AlertsTranslator;
  summary: unknown;
}) {
  const qs = marketId ? `?market_id=${marketId}` : "";
  const { data, error, isLoading } = useSWR<{ history: HistoryRow[]; days: number }>(
    `/api/alerts/history${qs}`,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  return (
    <Panel title={t("historyTitle")}>
      {isLoading ? (
        <EmptyState label={t("loading")} />
      ) : error ? (
        <EmptyState label={t("loadError")} />
      ) : !data || data.history.length === 0 ? (
        <EmptyState label={t("historyEmpty")} />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {data.history.map((h) => (
            <li
              key={h.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                fontSize: 12,
                color: "#1A1A1A",
              }}
            >
              <span style={{ fontWeight: 500 }}>
                {t(`types.${h.alert_type as AlertType}.label` as never, {
                  default: h.alert_type,
                })}
              </span>
              <span style={{ color: "#6D7175" }}>
                {h.acknowledged_at
                  ? t("acknowledgedAt", { when: new Date(h.acknowledged_at).toLocaleString() })
                  : h.snoozed_until
                    ? t("snoozedUntil", { when: new Date(h.snoozed_until).toLocaleString() })
                    : ""}
              </span>
              <div style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: 10,
                  color: "#6D7175",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {new Date(h.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

interface HistoryRow {
  id: string;
  alert_key: string;
  alert_type: string;
  entity_id: string;
  market_id: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  actor_id: string;
  created_at: string;
  updated_at: string;
}

/* ───────────────── Helpers ───────────────── */

function formatMeta(alert: Alert, t: AlertsTranslator): string {
  const { type, meta } = alert;
  const value = meta.value;
  switch (type) {
    case "overdue_callback":
      return t("meta.overdueBy", { value: formatMinutes(value, t) });
    case "unassigned_overflow":
      return t("meta.ageSuffix", { value: formatMinutes(value, t) });
    case "dispatch_failure":
      return t("meta.stuckHours", { hours: value });
    case "carrier_webhook_stale":
      return t("meta.stuckDays", { days: value });
    case "return_bottleneck":
      return t("meta.pendingReturns", { count: value });
    case "low_stock":
      return t("meta.remaining", { count: value });
    case "stock_depleted":
      return t("meta.depleted");
    case "agent_inactive":
      return t("meta.inactiveFor", { value: formatMinutes(value, t) });
    default:
      return "";
  }
}

function formatMinutes(minutes: number, t: AlertsTranslator): string {
  if (minutes < 60) return t("minutesShort", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return t("hoursShort", { count: hours });
  return `${t("hoursShort", { count: hours })} ${t("minutesShort", { count: rem })}`;
}

/* ───────────────── Styles ───────────────── */

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  background: "#FFFFFF",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  padding: "6px 10px",
  color: "#1A1A1A",
  cursor: "pointer",
  fontSize: 12,
};

function darkBarButton(busy: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    background: "#2A2A2A",
    border: "1px solid #333333",
    color: "#FFFFFF",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: busy ? "progress" : "pointer",
    opacity: busy ? 0.7 : 1,
  };
}
