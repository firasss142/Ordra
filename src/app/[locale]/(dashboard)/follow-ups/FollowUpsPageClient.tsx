"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { FollowUpsFilterBar } from "@/components/follow-ups/FollowUpsFilterBar";
import { FollowUpsKanban, type FollowUpsKanbanColumn } from "@/components/follow-ups/FollowUpsKanban";
import { NewFollowUpsBanner } from "@/components/follow-ups/NewFollowUpsBanner";
import { useFollowUpsColumn } from "@/hooks/useFollowUpsColumn";
import { useFollowUpsSummary } from "@/hooks/useFollowUpsSummary";
import { useFollowUpsRealtime } from "@/hooks/useFollowUpsRealtime";
import { useFollowUpCampaigns } from "@/hooks/useFollowUpCampaigns";
import { fetcher } from "@/lib/swr-config";
import type { FollowUpsKanbanInitial } from "@/lib/follow-ups/list";
import type { FollowUpsSummary } from "@/lib/follow-ups/summary";
import type {
  FollowUpStatus,
  OrderFollowUpWithOrder,
} from "@/types/follow-up";
import type { Locale, Role } from "@/types";

const NewFollowUpModal = dynamic(
  () => import("@/components/follow-ups/NewFollowUpModal").then((m) => m.NewFollowUpModal),
  { ssr: false },
);
const NewCampaignWizard = dynamic(
  () => import("@/components/follow-ups/NewCampaignWizard").then((m) => m.NewCampaignWizard),
  { ssr: false },
);
const CampaignPanel = dynamic(
  () => import("@/components/follow-ups/CampaignPanel").then((m) => m.CampaignPanel),
  { ssr: false },
);

interface Market {
  id: string;
  name: string;
  code?: string;
}

interface Props {
  role: Role;
  userMarketId: string;
  userMarketLabel: string;
  locale: Locale;
  marketCode: "TN" | "LY";
  initialSummary: FollowUpsSummary;
  initialColumnPages: FollowUpsKanbanInitial;
}

const STATUS_ORDER: FollowUpStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
];

export function FollowUpsPageClient({
  role,
  userMarketId,
  userMarketLabel,
  locale,
  marketCode,
  initialSummary,
  initialColumnPages,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");

  const isSuperAdmin = role === "super_admin";
  const isManager = role === "market_manager" || role === "super_admin";

  // ---------- Filter state (local, not URL synced for v1) ----------
  const [selectedMarketRaw, setSelectedMarketRaw] = useState<string | "all" | null>(
    isSuperAdmin ? "all" : userMarketId,
  );
  const selectedMarketId = isSuperAdmin
    ? selectedMarketRaw
    : userMarketId;
  const effectiveMarketId =
    isSuperAdmin
      ? selectedMarketId === "all"
        ? null
        : (selectedMarketId as string | null)
      : userMarketId;

  const [statusFilter, setStatusFilter] = useState<FollowUpStatus | "all">("all");
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // ---------- Modals ----------
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<FollowUpStatus | undefined>(undefined);
  const [campaignPanelOpen, setCampaignPanelOpen] = useState(false);
  const [campaignWizardOpen, setCampaignWizardOpen] = useState(false);

  // ---------- Lazy markets load (super_admin only) ----------
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isSuperAdmin ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  // ---------- Lazy campaigns load (open panel or chip) ----------
  const [campaignsRequested, setCampaignsRequested] = useState(false);
  const { campaigns, mutate: mutateCampaigns } = useFollowUpCampaigns(
    effectiveMarketId ?? userMarketId,
    { enabled: campaignsRequested },
  );

  // ---------- Summary ----------
  const { summary, mutate: mutateSummary } = useFollowUpsSummary({
    marketId: effectiveMarketId,
    agentId: null,
    campaignId,
    fallback: initialSummary,
  });

  // ---------- Column data ----------
  const isFallbackValid =
    // Initial prefetch was scoped to the user's default market for managers,
    // or to the super_admin's initial (all markets). Once filters change
    // client-side, SWR fetches fresh data with the correct key — the fallback
    // is still served for the *initial* key only.
    true;

  const openCol = useFollowUpsColumn({
    status: "open",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId,
    fallbackFirstPage: isFallbackValid ? initialColumnPages.open : undefined,
  });
  const inProgressCol = useFollowUpsColumn({
    status: "in_progress",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId,
    fallbackFirstPage: isFallbackValid ? initialColumnPages.in_progress : undefined,
  });
  const resolvedCol = useFollowUpsColumn({
    status: "resolved",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId,
    fallbackFirstPage: isFallbackValid ? initialColumnPages.resolved : undefined,
  });
  const escalatedCol = useFollowUpsColumn({
    status: "escalated",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId,
    fallbackFirstPage: isFallbackValid ? initialColumnPages.escalated : undefined,
  });

  const columnData = {
    open: openCol,
    in_progress: inProgressCol,
    resolved: resolvedCol,
    escalated: escalatedCol,
  } as const;

  // ---------- Realtime ----------
  const mutators = useMemo(
    () => ({
      open: openCol.mutate,
      in_progress: inProgressCol.mutate,
      resolved: resolvedCol.mutate,
      escalated: escalatedCol.mutate,
    }),
    [openCol.mutate, inProgressCol.mutate, resolvedCol.mutate, escalatedCol.mutate],
  );

  const { newCount, reveal, dismiss } = useFollowUpsRealtime({
    marketId: effectiveMarketId,
    columnMutators: mutators,
    mutateSummary,
  });

  // ---------- Handlers ----------
  const handleMarketChange = useCallback((id: string | "all") => {
    setSelectedMarketRaw(id);
  }, []);

  const handleOpenAddFor = useCallback((status: FollowUpStatus) => {
    setPendingStatus(status);
    setCreateOpen(true);
  }, []);

  const handleMove = useCallback(
    async (
      item: OrderFollowUpWithOrder,
      fromStatus: FollowUpStatus,
      toStatus: FollowUpStatus,
    ) => {
      // Optimistic: remove from source column, prepend to destination.
      columnData[fromStatus].mutate(
        (pages) => {
          if (!pages) return pages;
          return pages.map((p) => ({
            ...p,
            rows: p.rows.filter((r) => r.id !== item.id),
          }));
        },
        { revalidate: false },
      );
      columnData[toStatus].mutate(
        (pages) => {
          if (!pages || pages.length === 0) return pages;
          const [first, ...rest] = pages;
          if (first.rows.some((r) => r.id === item.id)) return pages;
          return [
            {
              ...first,
              rows: [{ ...item, status: toStatus }, ...first.rows],
            },
            ...rest,
          ];
        },
        { revalidate: false },
      );

      try {
        const res = await fetch(`/api/follow-ups/${item.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_status: toStatus }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? "Transition failed");
        }
        // Revalidate both columns to resync with the server-authoritative state.
        await Promise.all([
          columnData[fromStatus].mutate(),
          columnData[toStatus].mutate(),
          mutateSummary(),
        ]);
      } catch (err) {
        // Roll back: revalidate to restore truth.
        await Promise.all([
          columnData[fromStatus].mutate(),
          columnData[toStatus].mutate(),
        ]);
        throw err;
      }
    },
    [columnData, mutateSummary],
  );

  // ---------- Derived ----------
  const visibleStatuses: FollowUpStatus[] =
    statusFilter === "all" ? STATUS_ORDER : [statusFilter];

  const kanbanColumns: FollowUpsKanbanColumn[] = visibleStatuses.map((s) => ({
    status: s,
    label: tStatuses(s),
    data: columnData[s],
    count: summary[s],
    ...(s !== "resolved" ? { onAdd: () => handleOpenAddFor(s) } : {}),
  }));

  const totalRows =
    openCol.rows.length +
    inProgressCol.rows.length +
    resolvedCol.rows.length +
    escalatedCol.rows.length;

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    if (selectedMarketId === "all" || !selectedMarketId) return t("allMarkets");
    return markets.find((m) => m.id === selectedMarketId)?.name ?? "—";
  }, [isSuperAdmin, selectedMarketId, markets, userMarketLabel, t]);

  const hasFilters =
    statusFilter !== "all" || campaignId !== null;

  const handleReset = useCallback(() => {
    setStatusFilter("all");
    setCampaignId(null);
  }, []);

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle")} · {activeMarketLabel}
        </p>
      </div>

      <FollowUpsFilterBar
        markets={markets}
        selectedMarketId={selectedMarketId}
        onMarketChange={handleMarketChange}
        lockMarket={!isSuperAdmin}
        lockedMarketLabel={userMarketLabel}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        campaignId={campaignId}
        campaigns={campaigns}
        onCampaignsOpen={() => {
          if (!campaignsRequested) setCampaignsRequested(true);
        }}
        onCampaignChange={setCampaignId}
        onOpenCampaignPanel={
          isManager
            ? () => {
                if (!campaignsRequested) setCampaignsRequested(true);
                setCampaignPanelOpen(true);
              }
            : undefined
        }
        onReset={handleReset}
        onNewFollowUp={() => setCreateOpen(true)}
        hasActiveFilters={hasFilters}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <KpiCard label={t("metrics.total")} value={String(summary.total)} />
        <KpiCard label={t("metrics.open")} value={String(summary.open)} />
        <KpiCard label={t("metrics.inProgress")} value={String(summary.in_progress)} />
        <KpiCard
          label={t("metrics.resolved")}
          value={String(summary.resolved)}
          deltaTone="success"
        />
        <KpiCard
          label={t("metrics.escalated")}
          value={String(summary.escalated)}
          deltaTone="critical"
        />
      </div>

      <NewFollowUpsBanner count={newCount} onReveal={reveal} onDismiss={dismiss} />

      <FollowUpsKanban
        columns={kanbanColumns}
        marketCode={marketCode}
        locale={locale}
        onMove={handleMove}
      />

      <div style={{ fontSize: 13, color: "#6D7175", textAlign: "end" }}>
        {t("footerCount", { count: totalRows })}
      </div>

      {createOpen && (
        <NewFollowUpModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setPendingStatus(undefined);
          }}
          onCreated={() => {
            setCreateOpen(false);
            setPendingStatus(undefined);
            void Promise.all([
              openCol.mutate(),
              inProgressCol.mutate(),
              resolvedCol.mutate(),
              escalatedCol.mutate(),
              mutateSummary(),
            ]);
          }}
          marketId={userMarketId}
          marketCode={marketCode}
          initialStatus={pendingStatus}
        />
      )}

      {campaignPanelOpen && (
        <CampaignPanel
          open={campaignPanelOpen}
          onClose={() => setCampaignPanelOpen(false)}
          campaigns={campaigns}
          activeCampaignId={campaignId ?? ""}
          onSelect={(id: string) => {
            setCampaignId(id || null);
            setCampaignPanelOpen(false);
          }}
          onNew={
            isManager
              ? () => {
                  setCampaignPanelOpen(false);
                  setCampaignWizardOpen(true);
                }
              : undefined
          }
          onMutate={isManager ? mutateCampaigns : undefined}
          readOnly={!isManager}
        />
      )}

      {isManager && campaignWizardOpen && (
        <NewCampaignWizard
          open={campaignWizardOpen}
          onClose={() => setCampaignWizardOpen(false)}
          marketId={userMarketId}
          onCreated={(createdCampaignId: string) => {
            setCampaignWizardOpen(false);
            void mutateCampaigns();
            setCampaignId(createdCampaignId);
            void Promise.all([
              openCol.mutate(),
              inProgressCol.mutate(),
              resolvedCol.mutate(),
              escalatedCol.mutate(),
              mutateSummary(),
            ]);
          }}
        />
      )}
    </div>
  );
}
