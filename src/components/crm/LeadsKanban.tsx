"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { KanbanBoard, type KanbanAccent } from "@/components/shared/KanbanBoard";
import { LeadCard, leadCardAccent } from "./LeadCard";
import { NewLeadModal } from "./NewLeadModal";
import { useLeads } from "@/hooks/useLeads";
import type { Lead, LeadStatus } from "@/types/lead";
import { isValidLeadTransition } from "@/types/lead";

interface Props {
  marketId: string | null;
  locale: string;
  sourceFilter?: string;
  agentId?: string | null;
  density?: "comfortable" | "compact";
  isSuperAdmin?: boolean;
}

const BUCKETS: Array<{
  key: string;
  statuses: LeadStatus[];
  accent: KanbanAccent;
  addStatus: LeadStatus | null;
}> = [
  {
    key: "nouveau",
    statuses: ["new", "assigned"],
    accent: "neutral",
    addStatus: "new",
  },
  {
    key: "tentative",
    statuses: ["attempt_1", "attempt_2", "attempt_3"],
    accent: "action",
    addStatus: "attempt_1",
  },
  {
    key: "rappel",
    statuses: ["callback_scheduled"],
    accent: "warning",
    addStatus: "callback_scheduled",
  },
  {
    key: "qualifie",
    statuses: ["qualified"],
    accent: "success",
    addStatus: "qualified",
  },
  // Terminal bucket — no "+" button
  {
    key: "fermees",
    statuses: ["won", "lost", "archived"],
    accent: "neutral",
    addStatus: null,
  },
];

function bucketOf(status: LeadStatus): string {
  for (const b of BUCKETS) {
    if (b.statuses.includes(status)) return b.key;
  }
  return "nouveau";
}

function resolveTarget(from: LeadStatus, toBucket: string): LeadStatus | null {
  switch (toBucket) {
    case "nouveau":
      return "assigned";
    case "tentative":
      if (from === "attempt_1") return "attempt_2";
      if (from === "attempt_2") return "attempt_3";
      return "attempt_1";
    case "rappel":
      return "callback_scheduled";
    case "qualifie":
      return "qualified";
    case "fermees":
      return "lost";
  }
  return null;
}

export function LeadsKanban({
  marketId,
  locale,
  sourceFilter,
  agentId,
  density = "comfortable",
  isSuperAdmin,
}: Props) {
  const t = useTranslations("crm.queue.buckets");
  const tLeads = useTranslations("crm.leads");
  const tKanban = useTranslations("kanban");
  const { leads, isLoading, mutate } = useLeads({
    marketId: marketId ?? undefined,
    source: sourceFilter || undefined,
    agentId: agentId ?? undefined,
    limit: 200,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | undefined>(undefined);

  const openAdd = (status: LeadStatus) => {
    setPendingStatus(status);
    setModalOpen(true);
  };

  const columns = BUCKETS.map((b) => ({
    key: b.key,
    label: t(b.key),
    accent: b.accent,
    ...(b.addStatus
      ? {
          onAdd: () => openAdd(b.addStatus!),
          addLabel: tKanban("addInColumn", { column: t(b.key) }),
        }
      : {}),
  }));

  const handleMove = async (item: Lead, _fromKey: string, toKey: string) => {
    const from = item.status as LeadStatus;
    const target = resolveTarget(from, toKey);
    if (!target || !isValidLeadTransition(from, target)) {
      throw new Error(`invalid transition ${from} → ${target}`);
    }
    if (target === "lost") {
      throw new Error("Use the lost-reason modal to mark a lead lost");
    }

    const res = await fetch(`/api/leads/${item.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_status: target }),
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
          groupBy={(l) => bucketOf(l.status as LeadStatus)}
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
