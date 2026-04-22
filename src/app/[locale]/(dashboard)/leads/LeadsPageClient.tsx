"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { LeadsFilterBar, BUCKET_STATUSES, type LeadBucket } from "@/components/crm/LeadsFilterBar";
import { LeadsKpiStrip } from "@/components/crm/LeadsKpiStrip";
import { LeadsKanban } from "@/components/crm/LeadsKanban";
import { fetcher } from "@/lib/swr-config";
import type { LeadsMetrics } from "@/lib/leads/metrics";
import type { LeadSource, LeadStatus } from "@/types/lead";
import type { Locale, Role } from "@/types";

const NewLeadModal = dynamic(
  () => import("@/components/crm/NewLeadModal").then((m) => m.NewLeadModal),
  { ssr: false },
);
const CsvImportModal = dynamic(
  () => import("@/components/crm/CsvImportModal").then((m) => m.CsvImportModal),
  { ssr: false },
);
const ProspectCampaignPanel = dynamic(
  () => import("@/components/crm/ProspectCampaignPanel").then((m) => m.ProspectCampaignPanel),
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
  initialMetrics: LeadsMetrics;
}

export function LeadsPageClient({
  role,
  userMarketId,
  userMarketLabel,
  locale,
  initialMetrics,
}: Props) {
  const t = useTranslations("crm.leads");

  const isSuperAdmin = role === "super_admin";

  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? "all" : userMarketId,
  );
  const effectiveMarketId =
    !isSuperAdmin
      ? userMarketId
      : selectedMarketId === "all"
        ? null
        : selectedMarketId;

  const [bucket, setBucket] = useState<LeadBucket>("all");
  const [source, setSource] = useState<LeadSource | null>(null);

  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isSuperAdmin ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  const metricsKey = effectiveMarketId
    ? `/api/leads/metrics?market_id=${effectiveMarketId}`
    : "/api/leads/metrics";

  const { data: metricsResponse, mutate: mutateMetrics } = useSWR<{ data: LeadsMetrics }>(
    metricsKey,
    fetcher,
    {
      fallbackData: { data: initialMetrics },
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );
  const metrics = metricsResponse?.data ?? initialMetrics;

  const visibleStatuses: LeadStatus[] | undefined = useMemo(() => {
    if (bucket === "all") return undefined;
    return BUCKET_STATUSES[bucket];
  }, [bucket]);

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    if (selectedMarketId === "all") return t("allMarkets");
    return markets.find((m) => m.id === selectedMarketId)?.name ?? "—";
  }, [isSuperAdmin, selectedMarketId, markets, userMarketLabel, t]);

  const hasActiveFilters = bucket !== "all" || source !== null;

  const handleReset = useCallback(() => {
    setBucket("all");
    setSource(null);
  }, []);

  const footerCount = visibleStatuses
    ? visibleStatuses.reduce((sum, s) => sum + (metrics.byStatus[s] ?? 0), 0)
    : metrics.total;

  const onAfterMutate = useCallback(() => {
    void mutateMetrics();
  }, [mutateMetrics]);

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

      <LeadsFilterBar
        markets={markets}
        selectedMarketId={selectedMarketId}
        onMarketChange={setSelectedMarketId}
        lockMarket={!isSuperAdmin}
        lockedMarketLabel={userMarketLabel}
        bucket={bucket}
        onBucketChange={setBucket}
        source={source}
        onSourceChange={setSource}
        onReset={handleReset}
        hasActiveFilters={hasActiveFilters}
        onOpenCampaigns={() => setCampaignOpen(true)}
        onOpenCsvImport={() => setCsvOpen(true)}
        onNewLead={() => setNewLeadOpen(true)}
      />

      <LeadsKpiStrip metrics={metrics} />

      <LeadsKanban
        marketId={effectiveMarketId}
        locale={locale}
        sourceFilter={source ?? undefined}
        visibleStatuses={visibleStatuses}
        isSuperAdmin={isSuperAdmin}
      />

      <div style={{ fontSize: 13, color: "#6D7175", textAlign: "end" }}>
        {t("footerCount", { count: footerCount })}
      </div>

      {newLeadOpen && (
        <NewLeadModal
          open={newLeadOpen}
          onClose={() => setNewLeadOpen(false)}
          onCreated={() => {
            setNewLeadOpen(false);
            onAfterMutate();
          }}
          defaultMarketId={effectiveMarketId}
          isSuperAdmin={isSuperAdmin}
          locale={locale}
        />
      )}
      {csvOpen && (
        <CsvImportModal
          open={csvOpen}
          locale={locale}
          defaultMarketId={effectiveMarketId}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setCsvOpen(false)}
          onImported={() => onAfterMutate()}
        />
      )}
      {campaignOpen && (
        <ProspectCampaignPanel
          open={campaignOpen}
          onClose={() => setCampaignOpen(false)}
          marketId={effectiveMarketId}
          onSpawn={() => onAfterMutate()}
        />
      )}
    </div>
  );
}
