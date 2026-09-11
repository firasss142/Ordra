"use client";

import { AgentAvatar } from "@/components/shared/AgentAvatar";
import type { PresenceRow } from "@/hooks/useOrderLocks";

interface Props {
  /** Everyone on this order except the agent themself. */
  rows: PresenceRow[];
  now?: Date;
  size?: number;
}

/**
 * The manager's head, on the agent's screen.
 *
 * Purely advisory: a manager standing on an order blocks the agent from
 * nothing, so this must not read as a warning. It answers one question — "is
 * someone looking over my shoulder, and are they touching it?" — and the ring
 * carries that: hairline = consulte, filled blue = modifie.
 *
 * Never a red or critical tone. The block only ever runs the other way.
 */
export function ManagerPresenceMark({ rows, now, size = 18 }: Props) {
  const at = (now ?? new Date()).getTime();
  const live = rows.filter((r) => new Date(r.expires_at).getTime() > at);
  if (live.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-center -space-x-1">
      {live.map((row) => {
        const who = row.full_name ?? "Un responsable";
        const verb = row.mode === "editing" ? "modifie" : "consulte";
        const minutes = Math.max(0, Math.round((at - new Date(row.opened_at).getTime()) / 60_000));
        const label = `${who} ${verb} cette commande depuis ${minutes} min`;

        return (
          <span
            key={`${row.order_id}:${row.user_id}`}
            role="img"
            aria-label={label}
            title={label}
            data-mode={row.mode}
            data-blocking="false"
            className={
              "relative inline-grid shrink-0 place-items-center rounded-full bg-agent-surface transition-colors duration-120 " +
              (row.mode === "editing" ? "ring-2 ring-status-action" : "ring-1 ring-oms-ink-3")
            }
            style={{ padding: 1.5 }}
          >
            {/* Never null: AgentAvatar draws null as the dashed "+" that means
                "unassigned" elsewhere — the opposite of "someone is in here". */}
            <AgentAvatar
              name={row.full_name ?? "??"}
              size={size}
              avatarUrl={row.avatar_url}
            />
          </span>
        );
      })}
    </span>
  );
}
