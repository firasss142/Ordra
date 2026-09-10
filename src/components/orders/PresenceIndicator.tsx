"use client";

import { AgentAvatar } from "@/components/shared/AgentAvatar";
import type { PresenceRow } from "@/hooks/useOrderLocks";

interface Props {
  rows: PresenceRow[];
  /** Names are already on the page (OrdersTable builds agentNameById). */
  nameOf: (userId: string) => string | null;
  now?: Date;
  size?: number;
}

/**
 * Who has this order open, drawn small enough to live in a table row.
 *
 * Two rules from docs/design-system.md shape this:
 *  - §4.17 D — a colour signal must never be the only carrier of meaning. Every
 *    indicator therefore carries an aria-label naming the person and how long
 *    they have been there, and stays legible in greyscale via the ring weight.
 *  - §7 — the only permitted transitions are 120ms colour fades. No pulsing,
 *    no breathing dot: a live indicator does not need to animate to be read.
 *
 * A blocking agent gets a solid brand ring; a manager merely reading gets a
 * hairline neutral ring. That difference is what tells an agent, at a glance,
 * whether the manager on their order is looking or touching.
 */
export function PresenceIndicator({ rows, nameOf, now, size = 22 }: Props) {
  const at = (now ?? new Date()).getTime();

  const live = rows
    .filter((r) => new Date(r.expires_at).getTime() > at)
    // The blocking agent leads: it is the one that changes what a manager can do.
    .sort((a, b) => Number(b.role === "agent") - Number(a.role === "agent"));

  if (live.length === 0) return null;

  return (
    <span className="inline-flex items-center -space-x-1.5">
      {live.map((row) => {
        const name = nameOf(row.user_id);
        const blocking = row.role === "agent";
        const minutes = Math.max(0, Math.round((at - new Date(row.opened_at).getTime()) / 60_000));
        const who = name ?? (blocking ? "Un agent" : "Un responsable");
        const verb = row.mode === "editing" ? "modifie" : "consulte";
        const label = `${who} ${verb} cette commande depuis ${minutes} min`;

        return (
          <span
            key={`${row.order_id}:${row.user_id}`}
            role="img"
            aria-label={label}
            title={label}
            data-blocking={String(blocking)}
            data-mode={row.mode}
            className={
              "relative inline-grid place-items-center rounded-full bg-oms-surface transition-colors duration-120 " +
              (blocking
                ? "ring-2 ring-brand"
                : row.mode === "editing"
                  ? "ring-2 ring-status-action"
                  : "ring-1 ring-oms-ink-3")
            }
            style={{ padding: 1.5 }}
          >
            <AgentAvatar name={name} size={size} />
          </span>
        );
      })}
    </span>
  );
}
