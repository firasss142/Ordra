"use client";

import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { TypingDots } from "@/components/shared/TypingDots";
import type { PresenceRow } from "@/hooks/useOrderLocks";

export interface PresencePerson {
  full_name: string | null;
  avatar_url: string | null;
}

interface Props {
  rows: PresenceRow[];
  assigneeName: string | null;
  assigneeAvatarUrl?: string | null;
  /** Resolves a presence row's user to a name + photo. */
  personOf: (userId: string) => PresencePerson | null;
  now?: Date;
  size?: number;
}

/**
 * Who is in this order, drawn ON the assignee rather than beside them.
 *
 * The assignee's own avatar IS the indicator: when they have the order open it
 * gains a ring and a live dot. That keeps the row at one face instead of two,
 * costs no extra width in a 110px fixed column, and reads correctly at a
 * glance — the person you see is the person who is in there.
 *
 * Anyone present who is NOT the assignee (a manager, an admin) stacks behind as
 * a small extra head, overlapped, so the common case adds nothing.
 *
 * Two rules from docs/design-system.md shape this:
 *  - §4.17 D — colour is never the only carrier of meaning. Every state carries
 *    an aria-label naming the person and how long they have been there, and the
 *    ring weight survives greyscale.
 *  - §7 — the only permitted transitions are 120ms colour fades. No pulsing:
 *    a live indicator does not need to animate to be read.
 */
export function PresenceIndicator({
  rows,
  assigneeName,
  assigneeAvatarUrl,
  personOf,
  now,
  size = 24,
}: Props) {
  const at = (now ?? new Date()).getTime();
  const live = rows.filter((r) => new Date(r.expires_at).getTime() > at);

  // The blocking agent is, by construction, the assignee: RLS confines an agent
  // to orders assigned to them, so nobody else can hold an agent row here.
  const assigneeRow = live.find((r) => r.role === "agent") ?? null;
  const others = live.filter((r) => r !== assigneeRow);

  const minutesOf = (row: PresenceRow) =>
    Math.max(0, Math.round((at - new Date(row.opened_at).getTime()) / 60_000));

  // The row's own identity wins: GET /api/orders/presence embeds it, which is
  // the only source that can name a MANAGER (/api/agents is role='agent' only).
  // personOf is the fallback for rows that predate that, and for the assignee
  // whose photo the table already has.
  const identityOf = (row: PresenceRow): PresencePerson | null =>
    row.full_name || row.avatar_url
      ? { full_name: row.full_name ?? null, avatar_url: row.avatar_url ?? null }
      : personOf(row.user_id);

  const labelFor = (row: PresenceRow, fallback: string) => {
    const who = identityOf(row)?.full_name ?? fallback;
    const verb = row.mode === "editing" ? "modifie" : "consulte";
    return `${who} ${verb} cette commande depuis ${minutesOf(row)} min`;
  };

  const assigneeLabel = assigneeRow
    ? labelFor(assigneeRow, assigneeName ?? "Un agent")
    : undefined;

  return (
    <span className="inline-flex items-center">
      <span
        data-testid="assignee-avatar"
        data-presence={assigneeRow ? "agent" : "none"}
        {...(assigneeRow
          ? { role: "img" as const, "aria-label": assigneeLabel, title: assigneeLabel }
          : {})}
        className={
          "relative inline-grid shrink-0 place-items-center rounded-full transition-colors duration-120 " +
          (assigneeRow ? "ring-2 ring-brand" : "")
        }
        style={{ padding: assigneeRow ? 1.5 : 0 }}
      >
        <AgentAvatar name={assigneeName} size={size} avatarUrl={assigneeAvatarUrl} />
        {assigneeRow?.mode === "editing" ? (
          // The corner holds ONE mark. While they are typing, the bubble is it.
          <TypingDots className="absolute -bottom-1 -end-2" />
        ) : assigneeRow ? (
          // Paired with the ring so the signal survives greyscale, and echoing
          // the control-room presence dot the console already uses.
          <span
            data-live-dot
            aria-hidden
            className="absolute -bottom-0.5 -end-0.5 rounded-full border-2 border-oms-surface bg-brand"
            style={{ width: 9, height: 9 }}
          />
        ) : null}
      </span>

      {others.map((row) => {
        const person = identityOf(row);
        const label = labelFor(row, "Un responsable");
        return (
          <span
            key={`${row.order_id}:${row.user_id}`}
            data-testid="extra-presence"
            data-mode={row.mode}
            role="img"
            aria-label={label}
            title={label}
            className={
              "relative -ms-1.5 inline-grid shrink-0 place-items-center rounded-full bg-oms-surface transition-colors duration-120 " +
              (row.mode === "editing" ? "ring-2 ring-status-action" : "ring-1 ring-oms-ink-3")
            }
            style={{ padding: 1.5 }}
          >
            {/* Never null: AgentAvatar draws null as the dashed "+" that means
                "unassigned, act on this" everywhere else — the opposite of
                "somebody is in here". */}
            <AgentAvatar
              name={person?.full_name ?? "??"}
              size={size - 6}
              avatarUrl={person?.avatar_url}
            />
            {row.mode === "editing" && (
              <TypingDots className="absolute -bottom-1 -end-2" />
            )}
          </span>
        );
      })}
    </span>
  );
}
