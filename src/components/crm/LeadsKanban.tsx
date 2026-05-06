"use client";

import React, { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { KanbanBoard } from "@/components/shared/KanbanBoard";
import { LeadCard, leadCardAccent } from "./LeadCard";
import { NewLeadModal } from "./NewLeadModal";
import { useLeads } from "@/hooks/useLeads";
import { useStatusConfigs } from "@/hooks/useStatusConfigs";
import { accentForStatus, getStatusLabel } from "@/lib/statuses/label";
import type { Lead, LeadStatus } from "@/types/lead";
import type { Locale } from "@/types";

const MarkLostModal = dynamic(
  () => import("./MarkLostModal").then((m) => m.MarkLostModal),
  { ssr: false },
);
const ScheduleCallbackModal = dynamic(
  () => import("./ScheduleCallbackModal").then((m) => m.ScheduleCallbackModal),
  { ssr: false },
);
const ConvertLeadModal = dynamic(
  () => import("./ConvertLeadModal").then((m) => m.ConvertLeadModal),
  { ssr: false },
);
const ReassignLeadModal = dynamic(
  () => import("./ReassignLeadModal").then((m) => m.ReassignLeadModal),
  { ssr: false },
);

type ActiveModal = "callback" | "convert" | "lost" | "reassign" | null;

interface Props {
  marketId: string | null;
  locale: string;
  sourceFilter?: string;
  campaignId?: string | null;
  agentId?: string | null;
  density?: "comfortable" | "compact";
  isSuperAdmin?: boolean;
  hotOnly?: boolean;
  visibleStatuses?: LeadStatus[];
}

export function LeadsKanban({
  marketId,
  locale,
  sourceFilter,
  campaignId,
  agentId,
  density = "comfortable",
  isSuperAdmin,
  hotOnly,
  visibleStatuses,
}: Props) {
  const tLeads = useTranslations("crm.leads");
  const tKanban = useTranslations("kanban");

  const { leads, isLoading, mutate } = useLeads({
    marketId: marketId ?? undefined,
    source: sourceFilter || undefined,
    campaignId: campaignId ?? undefined,
    agentId: agentId ?? undefined,
    hotOnly,
    statuses: visibleStatuses,
    limit: 200,
  });

  const { configs } = useStatusConfigs({
    marketId,
    scope: "prospect",
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | undefined>(undefined);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const openAdd = (status: string) => {
    setPendingStatus(status as LeadStatus);
    setModalOpen(true);
  };

  const openModal = (modal: ActiveModal, lead: Lead) => {
    setActiveLead(lead);
    setActiveModal(modal);
  };
  const closeModal = () => {
    setActiveLead(null);
    setActiveModal(null);
  };

  const sortedConfigs = useMemo(() => {
    const sorted = [...configs].sort((a, b) => a.sort_order - b.sort_order);
    if (!visibleStatuses) return sorted;
    const visible = new Set(visibleStatuses);
    return sorted.filter((c) => visible.has(c.key as LeadStatus));
  }, [configs, visibleStatuses]);

  const columns = sortedConfigs.map((c) => ({
    key: c.key,
    label: getStatusLabel(c, locale as Locale),
    accent: accentForStatus(c),
    ...(c.is_terminal
      ? {}
      : {
          onAdd: () => openAdd(c.key),
          addLabel: tKanban("addInColumn", { column: getStatusLabel(c, locale as Locale) }),
        }),
  }));

  const configByKey = useMemo(
    () => Object.fromEntries(sortedConfigs.map((c) => [c.key, c])),
    [sortedConfigs]
  );

  // Hot leads sort first within each column
  const sortedLeads = useMemo(
    () => [...leads].sort((a, b) => {
      if (a.status !== b.status) return 0;
      if (a.is_hot && !b.is_hot) return -1;
      if (!a.is_hot && b.is_hot) return 1;
      return 0;
    }),
    [leads]
  );

  const handleMove = async (item: Lead, fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setMoveError(null);
    const fromConfig = configByKey[fromKey];
    const toConfig = configByKey[toKey];
    const fromLabel = fromConfig
      ? getStatusLabel(fromConfig, locale as Locale)
      : fromKey;
    const toLabel = toConfig ? getStatusLabel(toConfig, locale as Locale) : toKey;
    if (!fromConfig) {
      const message = tLeads("moveErrors.invalidTransition", {
        from: fromLabel,
        to: toLabel,
      });
      setMoveError(message);
      throw new Error(message);
    }
    if (!fromConfig.allowed_transitions.includes(toKey)) {
      throw new Error(`Invalid transition ${fromKey} → ${toKey}`);
    }
    if (toKey === "won") {
      if (fromKey !== "qualified") {
        throw new Error(`Invalid transition ${fromKey} → ${toKey}`);
      }
      openModal("convert", item);
      return;
    }
    if (toKey === "lost") {
      throw new Error("Use the lost-reason modal to mark a lead lost");
    }

    const res = await fetch(`/api/leads/${item.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_status: toKey }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error ?? "Transition failed");
    }
    await mutate();
    setMoveError(null);
  };

  const handleMoveWithFeedback = async (
    item: Lead,
    fromKey: string,
    toKey: string,
  ) => {
    try {
      await handleMove(item, fromKey, toKey);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const fromConfig = configByKey[fromKey];
      const toConfig = configByKey[toKey];
      const fromLabel = fromConfig
        ? getStatusLabel(fromConfig, locale as Locale)
        : fromKey;
      const toLabel = toConfig ? getStatusLabel(toConfig, locale as Locale) : toKey;
      const message = raw.startsWith("Invalid transition")
        ? tLeads("moveErrors.invalidTransition", { from: fromLabel, to: toLabel })
        : raw.includes("lost-reason")
          ? tLeads("moveErrors.lostRequiresModal")
          : raw.includes("conversion flow")
            ? tLeads("moveErrors.wonRequiresConversion")
            : raw || tLeads("moveErrors.transitionFailed");
      setMoveError(message);
      throw error;
    }
  };

  return (
    <>
      {isLoading && leads.length === 0 ? (
        <div style={{ fontSize: 13, color: "#6B7280" }}>…</div>
      ) : (
        <>
          {moveError && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                marginBottom: 10,
                background: "#FFF4F4",
                border: "1px solid #F0B6B4",
                borderRadius: 8,
                color: "#8E1F0B",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <span>{moveError}</span>
              <button
                type="button"
                onClick={() => setMoveError(null)}
                aria-label="Dismiss"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                x
              </button>
            </div>
          )}
        <KanbanBoard<Lead>
          columns={columns}
          items={sortedLeads}
          getItemId={(l) => l.id}
          groupBy={(l) => l.status as string}
          onMove={handleMoveWithFeedback}
          cardAccent={leadCardAccent}
          density={density}
          emptyLabel={tLeads("emptyState")}
          renderCard={(l) => (
            <LeadCard
              lead={l}
              locale={locale}
              density={density}
              onCallback={() => openModal("callback", l)}
              onMarkLost={() => openModal("lost", l)}
              onReassign={() => openModal("reassign", l)}
            />
          )}
        />
        </>
      )}

      <NewLeadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          mutate();
        }}
        defaultMarketId={marketId}
        isSuperAdmin={isSuperAdmin}
        locale={locale}
        initialStatus={pendingStatus}
      />

      {activeModal === "callback" && activeLead && (
        <ScheduleCallbackModal
          open
          leadId={activeLead.id}
          locale={locale}
          onClose={closeModal}
          onDone={() => { closeModal(); mutate(); }}
        />
      )}
      {activeModal === "convert" && activeLead && (
        <ConvertLeadModal
          open
          lead={activeLead}
          locale={locale}
          onClose={closeModal}
          onConverted={() => { closeModal(); mutate(); }}
        />
      )}
      {activeModal === "lost" && activeLead && (
        <MarkLostModal
          open
          leadId={activeLead.id}
          locale={locale}
          onClose={closeModal}
          onDone={() => { closeModal(); mutate(); }}
        />
      )}
      {activeModal === "reassign" && activeLead && marketId && (
        <ReassignLeadModal
          open
          lead={activeLead}
          marketId={marketId}
          onClose={closeModal}
          onDone={() => { closeModal(); mutate(); }}
        />
      )}
    </>
  );
}
