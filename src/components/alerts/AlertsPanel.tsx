"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { History, RefreshCw, X } from "lucide-react";
import { useAlerts } from "@/hooks/useAlerts";
import { useMarketScope } from "@/context/market-scope";
import { SEVERITY_ORDER } from "@/lib/alerts/catalogue";
import type { Alert, AlertSeverity, AlertType } from "@/lib/alerts/types";
import type { AuthUser } from "@/types";
import { type AlertsAgent } from "./constants";
import { SeverityTile, SeverityBar, Chip } from "./AlertsSeverityTiles";
import { AlertBand, AlertRow, AllClear } from "./AlertsList";
import { AlertsBulkBar } from "./AlertsBulkBar";
import { AlertsHistory } from "./AlertsHistory";

export interface AlertsPanelFilter {
  type?: AlertType;
  severity?: AlertSeverity;
}

interface Props {
  user: AuthUser;
  initialFilter?: AlertsPanelFilter | null;
  onClose: () => void;
}

/**
 * Right-edge slide-over hosting the full alerts inbox: severity tiles, type
 * chips, bulk acknowledge/snooze/reassign, list, and history. Opened from the
 * sidebar bell or the dashboard attention bar.
 */
export function AlertsPanel({ user, initialFilter, onClose }: Props) {
  const t = useTranslations("alerts");
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? undefined;

  const { alerts, summary, totalCount, bySeverity, byType, isLoading, error, mutate } = useAlerts({
    marketId,
    realtime: true,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">(
    initialFilter?.severity ?? "all",
  );
  const [typeFilter, setTypeFilter] = useState<AlertType | "all">(initialFilter?.type ?? "all");
  const [actionBusy, setActionBusy] = useState<"ack" | "snooze" | "reassign" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [collapsedBands, setCollapsedBands] = useState<Set<AlertSeverity>>(new Set());

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel on open; Escape closes (capture phase so an order drawer
  // underneath doesn't also react — topmost surface wins).
  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  const agentParams = marketId ? `?market_id=${marketId}` : "";
  const { data: agentsPayload } = useSWR<{ data: AlertsAgent[] }>(`/api/agents${agentParams}`, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const agents = agentsPayload?.data ?? [];

  const filteredAlerts = useMemo(() => {
    if (!alerts) return [] as Alert[];
    return alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      return true;
    });
  }, [alerts, severityFilter, typeFilter]);

  /**
   * The list, banded by severity. Only bands with something in them are built,
   * so an empty severity costs no vertical space — the tile above already says
   * it is clear.
   */
  const bands = useMemo(() => {
    return SEVERITY_ORDER.map((severity) => ({
      severity,
      alerts: filteredAlerts.filter((a) => a.severity === severity),
    })).filter((band) => band.alerts.length > 0);
  }, [filteredAlerts]);

  const visibleIds = useMemo(() => filteredAlerts.map((a) => a.id), [filteredAlerts]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const selectedUnassignedOrderIds = useMemo(() => {
    if (!alerts) return [] as string[];
    return alerts
      .filter((a) => selectedIds.has(a.id))
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

  const toggleBand = (severity: AlertSeverity) => {
    setCollapsedBands((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

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
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[59] bg-[rgba(26,26,26,0.5)]"
      />
      {/* Slide-over */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="fixed top-0 end-0 z-[60] flex h-full w-full flex-col border-s border-oms-border bg-oms-bg shadow-panel sm:w-[460px]"
      >
        {/* Header. Given real weight: this is a page in its own right, and the
            old 56px strip made the busiest surface in the app look incidental. */}
        <div className="flex-shrink-0 border-b border-oms-border bg-oms-surface px-5 pb-4 pt-5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 truncate text-[27px] font-bold leading-tight tracking-[-0.02em] text-oms-ink-1">
                {t("title")}
              </h2>
              <p className="m-0 mt-0.5 truncate text-[14px] text-oms-ink-2">
                {totalCount === 0 ? (
                  t("subtitleZero")
                ) : (
                  <>
                    <span className="font-bold text-brand">{totalCount}</span>{" "}
                    {t("activeLabel", { count: totalCount })}
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => mutate()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] border border-oms-border bg-oms-surface text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
                aria-label={t("refresh")}
                title={t("refresh")}
              >
                <RefreshCw size={16} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                aria-pressed={showHistory}
                className={
                  "inline-flex h-9 w-9 items-center justify-center rounded-[11px] border transition-colors duration-fast " +
                  (showHistory
                    ? "border-oms-border-strong bg-oms-sunken text-oms-ink-1"
                    : "border-oms-border bg-oms-surface text-oms-ink-2 hover:bg-oms-sunken hover:text-oms-ink-1")
                }
                aria-label={t("historyButton")}
                title={t("historyButton")}
              >
                <History size={16} strokeWidth={1.9} />
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] border border-oms-border bg-oms-surface text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
                aria-label={t("close")}
              >
                <X size={17} strokeWidth={1.9} />
              </button>
            </div>
          </div>

          <div className="mt-3">
            <SeverityBar bySeverity={bySeverity} order={SEVERITY_ORDER} />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {/* Severity summary — one compact row of four, so the whole board is
              legible above the fold instead of a 2×2 block pushing the list down. */}
          <div className="grid grid-cols-4 gap-1.5">
            {SEVERITY_ORDER.map((sev) => (
              <SeverityTile
                key={sev}
                severity={sev}
                count={bySeverity?.[sev] ?? 0}
                active={severityFilter === sev}
                onClick={() => setSeverityFilter((prev) => (prev === sev ? "all" : sev))}
                label={t(`severity.${sev}`)}
                compact
              />
            ))}
          </div>

          {/* Type chips */}
          {byType && (
            <div className="flex flex-wrap gap-2 rounded-[16px] border border-oms-border bg-oms-surface p-3">
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
                    onClick={() => setTypeFilter((prev) => (prev === t0 ? "all" : t0))}
                  />
                ))}
            </div>
          )}

          {/* Error banner */}
          {(error || actionError) && (
            <div
              role="alert"
              className="rounded-[8px] border border-hue-red-edge-soft bg-hue-red-bg px-3.5 py-3 text-[13px] text-hue-red-ink"
            >
              {actionError ?? t("loadError")}
            </div>
          )}

          {/* Bulk action bar */}
          {someSelected && (
            <AlertsBulkBar
              count={selectedIds.size}
              canReassign={
                selectedUnassignedOrderIds.length > 0 &&
                selectedUnassignedOrderIds.length === selectedIds.size
              }
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

          {/* List */}
          {filteredAlerts.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[16px] border border-oms-border bg-oms-surface px-3.5 py-3 text-[13px] text-oms-ink-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer rounded-[4px]"
              />
              {allSelected ? t("deselectAll") : t("selectAll")}
            </label>
          ) : null}
          {isLoading && !alerts ? (
            <div className="text-[13px] text-ink-secondary px-1 py-4">{t("loading")}</div>
          ) : filteredAlerts.length === 0 ? (
            <AllClear
              t={t}
              total={totalCount}
              hasFilter={severityFilter !== "all" || typeFilter !== "all"}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {bands.map(({ severity, alerts: banded }) => (
                <AlertBand
                  key={severity}
                  severity={severity}
                  label={t(`severity.${severity}`)}
                  count={banded.length}
                  collapsed={collapsedBands.has(severity)}
                  onToggleCollapsed={() => toggleBand(severity)}
                  t={t}
                >
                  {banded.map((alert) => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      selected={selectedIds.has(alert.id)}
                      onToggle={() => toggleOne(alert.id)}
                      locale={user.locale}
                      t={t}
                      onNavigate={onClose}
                    />
                  ))}
                </AlertBand>
              ))}
            </div>
          )}

          {/* History */}
          {showHistory && <AlertsHistory marketId={marketId} t={t} />}
          {/* summary is fetched above; keep reference for future use */}
          {summary ? null : null}
        </div>
      </div>
    </>
  );
}
