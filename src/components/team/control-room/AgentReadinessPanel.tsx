"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useAgentCapacity } from "@/hooks/useAgentCapacity";
import { summariseReadiness, type AgentReadiness } from "@/lib/team/readiness-summary";

/**
 * Who is actually taking orders right now — and who thinks they are.
 *
 * Built on `/api/agents/capacity` rather than a new `get_team_live` column, so
 * it needs no further migration: readiness, today's tally and the configured
 * share already travel on that endpoint.
 *
 * The panel exists because readiness introduced a failure mode that did not
 * exist before: an order can now land nowhere. If nobody is ready the pool
 * grows silently, and the first anyone would know is the next morning.
 */

interface Props {
  marketId: string | null;
  canForceOff?: boolean;
}

export function AgentReadinessPanel({ marketId, canForceOff = false }: Props) {
  const { agents, isLoading, mutate } = useAgentCapacity(marketId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = summariseReadiness(agents);

  async function forceOff(agentId: string) {
    setBusyId(agentId);
    try {
      await fetch("/api/agent/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_available: false,
          agent_id: agentId,
          reason: "forced by manager",
        }),
      });
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return <div aria-busy="true" className="h-32 animate-pulse rounded-xl bg-surface-subdued" />;
  }

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink-primary">Disponibilité</h3>
        <span className="text-[12px] text-ink-secondary">
          {summary.readyCount}/{agents.length} prêts · {summary.distributedToday} affectées
          aujourd&apos;hui
        </span>
      </header>

      {summary.nobodyReady && (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[12.5px] text-[#991B1B]"
        >
          Personne n&apos;est disponible : les nouvelles commandes restent dans « à
          affecter » jusqu&apos;à ce qu&apos;un agent se déclare prêt.
        </p>
      )}

      {summary.sharesIncomplete && (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-[#FEF6E7] px-3 py-2 text-[12.5px] text-[#92400E]"
        >
          La répartition par pourcentages ne totalise pas 100 % — corrigez-la dans
          Système › Paramètres › Équipe.
        </p>
      )}

      {agents.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">Aucun agent actif dans ce marché.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {summary.rows.map((row) => (
            <ReadinessRow
              key={row.agent.id}
              row={row}
              canForceOff={canForceOff}
              busy={busyId === row.agent.id}
              onForceOff={() => forceOff(row.agent.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReadinessRow({
  row,
  canForceOff,
  busy,
  onForceOff,
}: {
  row: AgentReadiness;
  canForceOff: boolean;
  busy: boolean;
  onForceOff: () => void;
}) {
  const { agent, ready, stale, target, drift } = row;

  const dot = ready ? "#16A34A" : stale ? "#B45309" : "#9CA3AF";
  const label = ready ? "Disponible" : stale ? "Session inactive" : "En pause";
  const labelColor = ready ? "text-[#166534]" : stale ? "text-[#92400E]" : "text-ink-secondary";

  return (
    <li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-surface-subdued">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <Avatar user={agent} size={26} />

      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-primary">
        {agent.full_name ?? agent.id}
      </span>

      <span className={`shrink-0 text-[12px] ${labelColor}`}>{label}</span>

      {target !== null && (
        <span
          className="shrink-0 tabular-nums text-[12px] text-ink-secondary"
          title={`Cible ${target} · part ${agent.share_pct} %`}
        >
          {agent.assigned_today}/{target}
          {drift !== null && drift !== 0 && (
            <span className={drift < 0 ? "ms-1 text-[#B45309]" : "ms-1 text-ink-tertiary"}>
              {drift > 0 ? `+${drift}` : drift}
            </span>
          )}
        </span>
      )}

      {target === null && (
        <span className="shrink-0 tabular-nums text-[12px] text-ink-secondary">
          {agent.assigned_today} auj.
        </span>
      )}

      {canForceOff && (ready || stale) && (
        <button
          type="button"
          onClick={onForceOff}
          disabled={busy}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-secondary hover:bg-surface-subdued disabled:opacity-50"
          // A manager needs this when a laptop dies mid-shift: the agent stays
          // "available" until the midnight reset, and their untouched orders
          // are stranded in a queue nobody is watching.
          title="Met l'agent en pause et rend ses commandes non entamées au pool"
        >
          {busy ? "…" : "Mettre en pause"}
        </button>
      )}
    </li>
  );
}
