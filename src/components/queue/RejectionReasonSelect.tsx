"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, CalendarClock } from "lucide-react";
import {
  REJECTION_GROUPS,
  REJECTION_SUBREASONS,
  type RejectionGroup,
} from "@/lib/orders/rejection-taxonomy";

interface RejectionReasonSelectProps {
  /**
   * Fires only on a complete answer: a group plus its sub-reason, or `autre`
   * plus a non-empty note. A bare group is never a valid outcome.
   */
  onSelect: (group: string, sub: string | null, note?: string) => void;
  /**
   * "The customer wants it later" — offered here because that is where the
   * agent is when they hear it, but it is not a rejection. When omitted the
   * escape is hidden (the caller has no way to reschedule).
   */
  onPostpone?: () => void;
  defaultGroup?: string;
}

/**
 * Two panes: which kind of no, then which no.
 *
 * The flat seven-item list this replaces had `autre` as its most-used answer —
 * 36% of all rejections, 68% of those with no note — because picking the vaguest
 * option was always the fastest way to close the sheet. Splitting the choice
 * costs one extra keystroke and buys a reason you can actually act on: "bought
 * elsewhere" and "wrong number" both used to land in the same bucket.
 *
 * The group pane never reports a selection. `onSelect` fires on the second
 * click, so an interrupted flow records nothing rather than a half-answer.
 */
export function RejectionReasonSelect({
  onSelect,
  onPostpone,
  defaultGroup,
}: RejectionReasonSelectProps) {
  const tGroups = useTranslations("orders.rejectionGroups");
  const tHints = useTranslations("orders.rejectionGroupHints");
  const tSubs = useTranslations("orders.rejectionSubreasons");
  const tQueue = useTranslations("queue");

  const [group, setGroup] = useState<RejectionGroup | null>(
    (defaultGroup as RejectionGroup) ?? null,
  );
  const [sub, setSub] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function chooseGroup(next: RejectionGroup) {
    setGroup(next);
    setSub(null);
    setNote("");
  }

  function chooseSub(next: string) {
    setSub(next);
    onSelect(group as RejectionGroup, next, undefined);
  }

  function changeNote(value: string) {
    setNote(value);
    // An empty note is not an answer — see the 440 orders that prove it.
    if (value.trim()) onSelect("autre", null, value);
  }

  if (group === null) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-agent-ink-3">
          {tQueue("rejectionGroupLabel")}
        </span>

        {REJECTION_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => chooseGroup(g)}
            className="flex flex-col items-start gap-0.5 rounded-lg border border-agent-outline-variant bg-agent-surface px-4 py-2.5 text-start transition-colors duration-fast hover:border-agent-outline hover:bg-agent-surface-low"
          >
            <span className="text-[14px] font-semibold text-agent-on-surface">
              {tGroups(g)}
            </span>
            <span className="text-[12px] text-agent-ink-3">{tHints(g)}</span>
          </button>
        ))}

        {onPostpone && (
          <button
            type="button"
            onClick={onPostpone}
            className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-agent-outline px-4 py-2.5 text-start transition-colors duration-fast hover:bg-agent-surface-low"
          >
            <CalendarClock
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-agent-ink-3"
            />
            <span className="flex flex-col">
              <span className="text-[13.5px] font-semibold text-agent-on-surface">
                {tQueue("rejectionPostpone")}
              </span>
              <span className="text-[12px] text-agent-ink-3">
                {tQueue("rejectionPostponeHint")}
              </span>
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setGroup(null)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-agent-ink-3 transition-colors duration-fast hover:bg-agent-surface-low hover:text-agent-on-surface"
        >
          {/* Logical rotation: the chevron must point back, not left. */}
          <ChevronLeft
            size={14}
            strokeWidth={2.25}
            aria-hidden="true"
            className="rtl:rotate-180"
          />
          {tQueue("rejectionBack")}
        </button>
        <span className="text-[13px] font-semibold text-agent-on-surface">
          {tGroups(group)}
        </span>
      </div>

      {group === "autre" ? (
        <input
          type="text"
          autoFocus
          placeholder={tQueue("rejectionNotePlaceholder")}
          value={note}
          onChange={(e) => changeNote(e.target.value)}
          className="w-full rounded-lg border border-agent-outline-variant bg-agent-surface px-3 py-2 text-[14px] text-agent-on-surface placeholder:text-agent-ink-3"
        />
      ) : (
        <>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-agent-ink-3">
            {tQueue("rejectionSubLabel")}
          </span>
          {REJECTION_SUBREASONS[group].map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sub === s}
              onClick={() => chooseSub(s)}
              className={[
                "rounded-lg border px-4 py-2.5 text-start text-[14px] font-medium transition-colors duration-fast",
                sub === s
                  ? "border-brand bg-brand-tint text-agent-on-surface"
                  : "border-agent-outline-variant bg-agent-surface text-agent-on-surface hover:border-agent-outline hover:bg-agent-surface-low",
              ].join(" ")}
            >
              {tSubs(s)}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
