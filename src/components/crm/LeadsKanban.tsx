"use client";

import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { KanbanBoard } from "@/components/shared/KanbanBoard";
import { LeadCard, leadCardAccent } from "./LeadCard";
import { NewLeadModal } from "./NewLeadModal";
import { useLeads } from "@/hooks/useLeads";
import { useStatusConfigs } from "@/hooks/useStatusConfigs";
import { accentForStatus, getStatusLabel } from "@/lib/statuses/label";
import type { Lead, LeadStatus } from "@/types/lead";
import type { Locale } from "@/types";

interface Props {
  marketId: string | null;
  locale: string;
  sourceFilter?: string;
  campaignId?: string | null;
  agentId?: string | null;
  density?: "comfortable" | "compact";
  isSuperAdmin?: boolean;
  /**
   * When provided, only columns for these statuses render. Used by the
   * LeadsPageClient bucket filter to narrow the board without re-querying.
   */
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
  visibleStatuses,
}: Props) {
  const tLeads = useTranslations("crm.leads");
  const tKanban = useTranslations("kanban");

  const { leads, isLoading, mutate } = useLeads({
    marketId: marketId ?? undefined,
    source: sourceFilter || undefined,
    campaignId: campaignId ?? undefined,
    agentId: agentId ?? undefined,
    limit: 200,
  });

  const { configs } = useStatusConfigs({
    marketId,
    scope: "prospect",
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | undefined>(undefined);

  const openAdd = (status: string) => {
    setPendingStatus(status as LeadStatus);
    setModalOpen(true);
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

  const handleMove = async (item: Lead, fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const fromConfig = configByKey[fromKey];
    if (!fromConfig) throw new Error(`Unknown source status: ${fromKey}`);
    if (!fromConfig.allowed_transitions.includes(toKey)) {
      throw new Error(`Invalid transition ${fromKey} → ${toKey}`);
    }
    // Block transitions to special-handling statuses — UI must use dedicated modals.
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
          items={leads}
          getItemId={(l) => l.id}
          groupBy={(l) => l.status as string}
          onMove={handleMove}
          cardAccent={leadCardAccent}
          density={density}
          emptyLabel={tLeads("emptyState")}
          renderCard={(l) => (
            <LeadCard lead={l} locale={locale} density={density} />
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
    </>
  );
}
