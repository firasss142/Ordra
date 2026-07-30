"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { History, RefreshCw, X } from "lucide-react";
import { useAlerts } from "@/hooks/useAlerts";
import { useMarketScope } from "@/context/market-scope";
import type { Alert, AlertSeverity, AlertType } from "@/app/api/alerts/summary/route";
import type { AuthUser } from "@/types";
import { SEVERITY_ORDER, type AlertsAgent } from "./constants";
import { SeverityTile, Chip } from "./AlertsSeverityTiles";
import { AlertRow, AllClear } from "./AlertsList";
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
        className="fixed inset-0 z-[59]"
        style={{ background: "rgba(26,26,26,0.5)" }}
      />
      {/* Slide-over */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="fixed top-0 end-0 h-full w-full sm:w-[440px] bg-surface-card border-s border-line-subtle shadow-panel z-[60] flex flex-col"
      >
        {/* Sticky header */}
        <div className="h-[56px] flex-shrink-0 flex items-center gap-2 px-4 border-b border-line-subtle">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink-primary m-0 truncate">
              {t("title")}
            </h2>
            <p className="text-[11px] text-ink-secondary m-0 truncate">
              {totalCount === 0 ? t("subtitleZero") : t("subtitleCount", { count: totalCount })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center justify-center w-7 h-7 rounded-[6px] border border-line bg-surface-card text-ink-primary hover:bg-surface-hover"
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            <RefreshCw size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            className={
              "inline-flex items-center justify-center w-7 h-7 rounded-[6px] border text-ink-primary hover:bg-surface-hover " +
              (showHistory ? "bg-surface-selected border-line-strong" : "bg-surface-card border-line")
            }
            aria-label={t("historyButton")}
            title={t("historyButton")}
          >
            <History size={13} strokeWidth={1.75} />
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-7 h-7 rounded-[6px] border border-line bg-surface-card text-ink-primary hover:bg-surface-hover"
            aria-label={t("close")}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {/* Severity summary — 2×2 compact grid */}
          <div className="grid grid-cols-2 gap-2">
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
            <div
              className="flex flex-wrap gap-0.5 self-start rounded-[8px] border border-line p-0.5"
              style={{ background: "#F6F6F7" }}
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
                    onClick={() => setTypeFilter((prev) => (prev === t0 ? "all" : t0))}
                  />
                ))}
            </div>
          )}

          {/* Error banner */}
          {(error || actionError) && (
            <div
              role="alert"
              className="rounded-[6px] px-3.5 py-3 text-[13px]"
              style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}
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
            <label className="flex items-center gap-1.5 self-end text-[12px] text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="cursor-pointer"
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
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {filteredAlerts.map((alert) => (
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
            </ul>
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
