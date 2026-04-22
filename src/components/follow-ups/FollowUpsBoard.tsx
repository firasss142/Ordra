"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { KanbanBoard, type KanbanDensity } from "@/components/shared/KanbanBoard";
import { DensityToggle } from "@/components/shared/DensityToggle";
import { FollowUpCard, followUpCardAccent } from "./FollowUpCard";
import { FollowUpKpiCards } from "./FollowUpKpiCards";
import { FollowUpList } from "./FollowUpList";
import dynamic from "next/dynamic";

const NewFollowUpModal = dynamic(
  () => import("./NewFollowUpModal").then((m) => m.NewFollowUpModal),
  { ssr: false },
);
const NewCampaignWizard = dynamic(
  () => import("./NewCampaignWizard").then((m) => m.NewCampaignWizard),
  { ssr: false },
);
const CampaignPanel = dynamic(
  () => import("./CampaignPanel").then((m) => m.CampaignPanel),
  { ssr: false },
);
import { useFollowUps } from "@/hooks/useFollowUps";
import { useFollowUpCampaigns } from "@/hooks/useFollowUpCampaigns";
import {
  FOLLOW_UP_STATUSES,
  type FollowUpStatus,
  type OrderFollowUpWithOrder,
} from "@/types/follow-up";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  marketCode: "TN" | "LY";
}

const VIEW_STORAGE_KEY = "followUps.view";
const DENSITY_STORAGE_KEY = "followUps.density";
type FollowUpsView = "list" | "kanban";

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  fontSize: 13,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
};

export function FollowUpsBoard({ user, marketCode }: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");

  const [createOpen, setCreateOpen] = useState(false);
  const [campaignWizardOpen, setCampaignWizardOpen] = useState(false);
  const [campaignPanelOpen, setCampaignPanelOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<FollowUpStatus | undefined>(undefined);
  const [view, setView] = useState<FollowUpsView>("list");
  const [density, setDensity] = useState<KanbanDensity>("comfortable");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCampaignId, setFilterCampaignId] = useState<string>("");
  const [page, setPage] = useState(1);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "list" || stored === "kanban") setView(stored);
    const storedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (storedDensity === "comfortable" || storedDensity === "compact") {
      setDensity(storedDensity);
    }
  }, []);

  const switchView = (v: FollowUpsView) => {
    setView(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    }
  };

  const switchDensity = (d: KanbanDensity) => {
    setDensity(d);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, d);
    }
  };

  const marketId = user.role === "super_admin" ? null : user.market_id;
  const isManager = user.role === "market_manager" || user.role === "super_admin";

  const { campaigns, mutate: mutateCampaigns } = useFollowUpCampaigns(
    marketId ?? user.market_id
  );

  // List view: paginated with status filter. Kanban view: large limit, no filter.
  const listQuery = useFollowUps({
    marketId: marketId ?? undefined,
    status: view === "list" && filterStatus ? filterStatus : undefined,
    campaignId: filterCampaignId || undefined,
    page: view === "list" ? page : 1,
    limit: view === "list" ? 50 : 200,
  });

  const tKanban = useTranslations("kanban");
  const tCampaigns = useTranslations("crm.followUps.campaigns");

  const STATUS_ACCENT: Record<FollowUpStatus, "neutral" | "action" | "success" | "critical"> = {
    open: "neutral",
    in_progress: "action",
    resolved: "success",
    escalated: "critical",
  };

  const openAddFor = (status: FollowUpStatus) => {
    setPendingStatus(status);
    setCreateOpen(true);
  };

  const columns = FOLLOW_UP_STATUSES.map((s) => {
    const label = tStatuses(s);
    return {
      key: s,
      label,
      accent: STATUS_ACCENT[s],
      // "resolved" is terminal — no "+" button
      ...(s !== "resolved"
        ? {
            onAdd: () => openAddFor(s),
            addLabel: tKanban("addInColumn", { column: label }),
          }
        : {}),
    };
  });

  const handleMove = async (
    item: OrderFollowUpWithOrder,
    _fromKey: string,
    toKey: string
  ) => {
    const newStatus = toKey as FollowUpStatus;
    const res = await fetch(`/api/follow-ups/${item.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_status: newStatus }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error ?? "Transition failed");
    }
    await listQuery.mutate();
  };

  const totalPages = Math.max(
    1,
    Math.ceil(listQuery.total / (listQuery.limit || 50))
  );

  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
      }}
    >
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#1A1A1A",
            margin: "0 0 4px 0",
          }}
        >
          {t("title")}
        </h1>
        <div style={{ fontSize: 13, color: "#6D7175" }}>{t("subtitle")}</div>
      </div>

      {/* KPI cards */}
      <div style={{ marginBottom: 24 }}>
        <FollowUpKpiCards
          followUps={listQuery.followUps}
          isLoading={listQuery.isLoading}
        />
      </div>

      {/* Filters + view toggle + action bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {view === "list" && (
          <>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            >
              <option value="">{t("allStatuses")}</option>
              {FOLLOW_UP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tStatuses(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setFilterStatus("");
                setPage(1);
              }}
              style={{
                ...inputStyle,
                cursor: "pointer",
                padding: "0 12px",
              }}
            >
              {t("reset")}
            </button>
          </>
        )}

        {/* Campaign selector — visible to agents, managers, and super_admin */}
        {(isManager || campaigns.length > 0) && (
          <button
            type="button"
            onClick={() => setCampaignPanelOpen(true)}
            style={{
              ...inputStyle,
              padding: "0 12px",
              cursor: "pointer",
              fontWeight: filterCampaignId ? 500 : 400,
              borderColor: filterCampaignId ? "#1A1A1A" : "#D1D5DB",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>
              {filterCampaignId
                ? campaigns.find((c) => c.id === filterCampaignId)?.name ?? tCampaigns("allCampaigns")
                : tCampaigns("allCampaigns")}
            </span>
            <span style={{ fontSize: 10, color: "#6D7175" }}>▾</span>
          </button>
        )}

        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8 }}>
          {view === "kanban" && (
            <DensityToggle value={density} onChange={switchDensity} />
          )}
          <div
            role="tablist"
            aria-label="view"
            style={{
              display: "inline-flex",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => switchView("list")}
              style={{
                height: 32,
                padding: "0 10px",
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                background: view === "list" ? "#1A1A1A" : "white",
                color: view === "list" ? "white" : "#1A1A1A",
              }}
            >
              {t("view.list")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "kanban"}
              onClick={() => switchView("kanban")}
              style={{
                height: 32,
                padding: "0 10px",
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                background: view === "kanban" ? "#1A1A1A" : "white",
                color: view === "kanban" ? "white" : "#1A1A1A",
              }}
            >
              {t("view.kanban")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            style={{
              height: 32,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              background: "#1A1A1A",
              color: "white",
              cursor: "pointer",
            }}
          >
            + {t("newFollowUp")}
          </button>
        </div>
      </div>

      {view === "list" ? (
        <FollowUpList
          followUps={listQuery.followUps}
          isLoading={listQuery.isLoading}
          locale={user.locale}
          marketCode={marketCode}
          total={listQuery.total}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      ) : listQuery.isLoading && listQuery.followUps.length === 0 ? (
        <div style={{ fontSize: 13, color: "#6B7280" }}>{t("loading")}</div>
      ) : (
        <KanbanBoard<OrderFollowUpWithOrder>
          columns={columns}
          items={listQuery.followUps}
          getItemId={(f) => f.id}
          groupBy={(f) => f.status}
          onMove={handleMove}
          cardAccent={followUpCardAccent}
          density={density}
          emptyLabel={t("columnEmpty")}
          renderCard={(f) => (
            <FollowUpCard
              followUp={f}
              marketCode={marketCode}
              locale={user.locale}
              density={density}
            />
          )}
        />
      )}

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
            listQuery.mutate();
          }}
          marketId={user.market_id}
          marketCode={marketCode}
          initialStatus={pendingStatus}
        />
      )}

      {campaignPanelOpen && (
        <CampaignPanel
          open={campaignPanelOpen}
          onClose={() => setCampaignPanelOpen(false)}
          campaigns={campaigns}
          activeCampaignId={filterCampaignId}
          onSelect={(id) => { setFilterCampaignId(id); setPage(1); setCampaignPanelOpen(false); }}
          onNew={isManager ? () => { setCampaignPanelOpen(false); setCampaignWizardOpen(true); } : undefined}
          onMutate={isManager ? mutateCampaigns : undefined}
          readOnly={!isManager}
        />
      )}

      {isManager && campaignWizardOpen && (
        <NewCampaignWizard
          open={campaignWizardOpen}
          onClose={() => setCampaignWizardOpen(false)}
          marketId={user.market_id}
          onCreated={(campaignId, _count) => {
            setCampaignWizardOpen(false);
            mutateCampaigns();
            listQuery.mutate();
            // Auto-select the newly created campaign in the filter pill
            setFilterCampaignId(campaignId);
          }}
        />
      )}
    </div>
  );
}
