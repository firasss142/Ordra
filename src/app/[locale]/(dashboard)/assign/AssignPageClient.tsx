"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import type { AssignmentAlgorithm } from "@/types/settings";
import { useUnassignedOrders } from "@/hooks/useUnassignedOrders";
import { useAgentCapacity } from "@/hooks/useAgentCapacity";
import { useAssignmentRule } from "@/hooks/useAssignmentRule";
import { AGE_BUCKET_ORDER, getAgeBucket, type AgeBucket } from "@/lib/assign/age-bucket";
import { OrderCard } from "@/components/assign/OrderCard";
import { AgeBucketSection } from "@/components/assign/AgeBucketSection";
import { AgentCapacityPanel } from "@/components/assign/AgentCapacityPanel";
import { AutoAssignBar } from "@/components/assign/AutoAssignBar";

interface Props {
  role: Role;
  marketId: string;
  marketCode: string;
  locale: Locale;
}

export function AssignPageClient({ role: _role, marketId, marketCode }: Props) {
  const t = useTranslations("assign");
  const specificMarketId = (!marketId || marketId === "all") ? null : marketId;
  const { orders, isLoading: ordersLoading, mutate: mutateOrders } = useUnassignedOrders(
    marketId || null
  );
  const { agents, isLoading: agentsLoading, mutate: mutateAgents } = useAgentCapacity(
    specificMarketId
  );
  const { rule, update: updateRule } = useAssignmentRule(specificMarketId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);

  const grouped = useMemo(() => {
    const groups: Record<AgeBucket, typeof orders> = {
      fresh: [],
      warning: [],
      urgent: [],
      critical: [],
    };
    for (const o of orders) {
      groups[getAgeBucket(o.created_at, now)].push(o);
    }
    return groups;
  }, [orders, now]);

  const toggleOrder = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(orders.map((o) => o.id)));
  }, [orders]);

  const selectBucket = useCallback((ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return next;
    });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const assignSelectedTo = useCallback(
    async (agentId: string) => {
      if (selectedIds.size === 0) return;
      setBusyAgentId(agentId);
      const ids = [...selectedIds];
      try {
        const res = await fetch("/api/orders/bulk-assign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order_ids: ids, agent_id: agentId }),
        });
        if (!res.ok) throw new Error("assign_failed");
        setSelectedIds(new Set());
        showToast(t("assignSuccess", { count: ids.length }));
        await Promise.all([mutateOrders(), mutateAgents()]);
      } catch {
        showToast(t("assignFailed"));
      } finally {
        setBusyAgentId(null);
      }
    },
    [selectedIds, mutateOrders, mutateAgents, showToast, t]
  );

  const runAutoAssign = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setAutoBusy(true);
    const ids = [...selectedIds];
    try {
      const res = await fetch("/api/orders/auto-assign-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_ids: ids }),
      });
      if (!res.ok) throw new Error("auto_failed");
      const json = await res.json();
      const assigned = (json.data?.assigned ?? []).length;
      const skipped = (json.data?.skipped ?? []).length;
      showToast(t("autoAssign.success", { assigned, skipped }));
      if (assigned > 0) {
        setSelectedIds(new Set());
        await Promise.all([mutateOrders(), mutateAgents()]);
      }
    } catch {
      showToast(t("autoAssign.failed"));
    } finally {
      setAutoBusy(false);
    }
  }, [selectedIds, mutateOrders, mutateAgents, showToast, t]);

  const onAlgorithmChange = useCallback(
    async (next: AssignmentAlgorithm) => {
      try {
        const patch: { algorithm: AssignmentAlgorithm; is_active?: boolean } = {
          algorithm: next,
        };
        if (next === "manual") {
          patch.is_active = false;
        } else if (!rule?.is_active) {
          patch.is_active = true;
        }
        await updateRule(patch);
        showToast(t("algorithm.saved"));
      } catch {
        showToast(t("algorithm.saveFailed"));
      }
    },
    [updateRule, showToast, t, rule?.is_active]
  );

  const onIsActiveChange = useCallback(
    async (next: boolean) => {
      try {
        await updateRule({ is_active: next });
        showToast(t("algorithm.saved"));
      } catch {
        showToast(t("algorithm.saveFailed"));
      }
    },
    [updateRule, showToast, t]
  );

  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: "100%",
      }}
    >
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>{t("subtitle")}</p>
      </header>

      <AutoAssignBar
        selectedCount={selectedIds.size}
        totalCount={orders.length}
        onAutoAssign={runAutoAssign}
        algorithm={(rule?.algorithm ?? "manual") as AssignmentAlgorithm}
        onAlgorithmChange={onAlgorithmChange}
        isActive={rule?.is_active ?? false}
        onIsActiveChange={onIsActiveChange}
        autoBusy={autoBusy}
        onClearSelection={clearSelection}
        onSelectAll={selectAll}
      />

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <main style={{ flex: 1, minWidth: 0 }}>
          {ordersLoading ? (
            <div style={{ color: "#6D7175", fontSize: 13, padding: 16 }}>
              {t("agents.loading")}
            </div>
          ) : orders.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "#6D7175",
                fontSize: 14,
                background: "#FFFFFF",
                border: "1px dashed #E1E3E5",
                borderRadius: 8,
              }}
            >
              {t("empty")}
            </div>
          ) : (
            AGE_BUCKET_ORDER.map((bucket) => {
              const bucketIds = grouped[bucket].map((o) => o.id);
              const selectedInBucket = bucketIds.filter((id) => selectedIds.has(id)).length;
              return (
                <AgeBucketSection
                  key={bucket}
                  bucket={bucket}
                  count={grouped[bucket].length}
                  selectedCount={selectedInBucket}
                  onToggleAll={(checked) => selectBucket(bucketIds, checked)}
                >
                  {grouped[bucket].map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      selected={selectedIds.has(order.id)}
                      onToggle={toggleOrder}
                      marketCode={marketCode}
                      now={now}
                    />
                  ))}
                </AgeBucketSection>
              );
            })
          )}
        </main>

        <AgentCapacityPanel
          agents={agents}
          selectedCount={selectedIds.size}
          onAssign={assignSelectedTo}
          busyAgentId={busyAgentId}
          loading={agentsLoading}
        />
      </div>

      {toast ? (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            insetInlineEnd: 24,
            padding: "10px 16px",
            background: "#1A1A1A",
            color: "#FFFFFF",
            fontSize: 13,
            borderRadius: 8,
            zIndex: 1000,
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
