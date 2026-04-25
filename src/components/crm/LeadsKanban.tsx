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
    const fromConfig = configByKey[fromKey];
    if (!fromConfig) throw new Error(`Unknown source status: ${fromKey}`);
    if (!fromConfig.allowed_transitions.includes(toKey)) {
      throw new Error(`Invalid transition ${fromKey} → ${toKey}`);
    }
    if (toKey === "lost") {
      throw new Error("Use the lost-reason modal to mark a lead lost");
    }
    if (toKey === "won") {
      throw new Error("Use the conversion flow to mark a lead won");
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
  };

  return (
    <>
      {isLoading && leads.length === 0 ? (
        <div style={{ fontSize: 13, color: "#6B7280" }}>…</div>
      ) : (
        <KanbanBoard<Lead>
          columns={columns}
          items={sortedLeads}
          getItemId={(l) => l.id}
          groupBy={(l) => l.status as string}
          onMove={handleMove}
          cardAccent={leadCardAccent}
          density={density}
          emptyLabel={tLeads("emptyState")}
          renderCard={(l) => (
            <LeadCard
              lead={l}
              locale={locale}
              density={density}
              onCallback={() => openModal("callback", l)}
              onConvert={() => openModal("convert", l)}
              onMarkLost={() => openModal("lost", l)}
              onReassign={() => openModal("reassign", l)}
            />
          )}
        />
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
