"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { validateShares, sharesTotal, SHARES_TOTAL } from "@/lib/orders/agent-shares";
import { inputClass } from "./SectionShell";

/**
 * The per-agent percentage split.
 *
 * Saves through its own endpoint rather than the page's monolithic settings
 * PATCH — same shape as the rejection taxonomy, because this owns rows in a
 * table keyed by agent.
 *
 * The Save button is disabled by exactly the function the PUT route refuses
 * with, so the manager is never told a split is acceptable that the server
 * then rejects.
 */

interface ShareRow {
  agent_id: string;
  full_name: string | null;
  avatar_url: string | null;
  share_pct: number | null;
}

interface Props {
  marketId: string;
  readOnly?: boolean;
}

export function AgentSharesEditor({ marketId, readOnly }: Props) {
  const { data, mutate, isLoading } = useSWR<{ data: ShareRow[] }>(
    marketId ? `/api/settings/agent-shares?market_id=${marketId}` : null,
  );

  const rows = useMemo(() => data?.data ?? [], [data]);

  // `null` for an agent with no stored share stays an empty input rather than
  // becoming 0 — "nobody has decided yet" and "deliberately excluded" are
  // different, and only the first should block saving.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setDraft(
      Object.fromEntries(
        rows.map((r) => [r.agent_id, r.share_pct === null ? "" : String(r.share_pct)]),
      ),
    );
  }, [rows]);

  const numeric = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, raw] of Object.entries(draft)) {
      if (raw.trim() === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) out[id] = n;
    }
    return out;
  }, [draft]);

  const activeIds = rows.map((r) => r.agent_id);
  const validation = validateShares(numeric, activeIds);
  const total = sharesTotal(numeric);
  const remainder = Math.round((SHARES_TOTAL - total) * 100) / 100;

  const uncovered = validation.errors
    .filter((e) => e.code === "AGENT_UNCOVERED")
    .map((e) => (e as { agentId: string }).agentId);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/agent-shares", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, shares: numeric }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setMessage({ kind: "err", text: body.error ?? "Erreur lors de l'enregistrement" });
      } else {
        setMessage({ kind: "ok", text: "Répartition enregistrée" });
        await mutate();
        setTimeout(() => setMessage(null), 3000);
      }
    } catch {
      setMessage({ kind: "err", text: "Erreur réseau" });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div aria-busy="true" className="h-24 animate-pulse rounded-lg bg-surface-subdued" />
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-ink-secondary">
        Aucun agent actif dans ce marché. Ajoutez un agent avant de définir une répartition.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const isUncovered = uncovered.includes(row.agent_id);
          return (
            <li key={row.agent_id} className="flex items-center gap-3">
              <span className="min-w-[180px] text-[13px] text-ink-primary">
                {row.full_name ?? row.agent_id}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                aria-label={`Part de ${row.full_name ?? row.agent_id}`}
                aria-invalid={isUncovered || undefined}
                value={draft[row.agent_id] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [row.agent_id]: e.target.value }))
                }
                disabled={readOnly}
                className={`${inputClass} w-24 text-right`}
              />
              <span className="text-[13px] text-ink-secondary">%</span>
              {isUncovered && (
                <span className="text-[12px] text-[#B42318]">à renseigner</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 border-t border-line pt-3">
        <span className="text-[13px] text-ink-secondary">Total</span>
        <span
          className={`text-[13px] font-medium ${
            total === SHARES_TOTAL ? "text-ink-primary" : "text-[#B42318]"
          }`}
        >
          {total} %
        </span>
        {remainder !== 0 && (
          <span className="text-[12px] text-[#B42318]">
            {remainder > 0 ? `Reste ${remainder} %` : `${-remainder} % de trop`}
          </span>
        )}
      </div>

      <p className="text-[12px] text-ink-secondary">
        Les parts sont des cibles absolues sur le volume du jour, pas des poids : un agent
        absent ne redistribue pas sa part, il la rattrape à son retour. C&apos;est pourquoi
        le total doit faire exactement 100&nbsp;%.
      </p>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!validation.valid || saving}
            className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer la répartition"}
          </button>
          {message && (
            <span
              role="status"
              className={`text-[13px] ${
                message.kind === "ok" ? "text-[#15803D]" : "text-[#B42318]"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
