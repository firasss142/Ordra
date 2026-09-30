"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ChevronLeft, CalendarClock } from "lucide-react";
import {
  REJECTION_GROUPS,
  REJECTION_SUBREASONS,
} from "@/lib/orders/rejection-taxonomy";
import { buildRejectionTree } from "@/lib/orders/rejection-config";
import { useRejectionReasons } from "@/hooks/useRejectionReasons";

/** One option in either pane, once config and fallback are reconciled. */
interface Option {
  key: string;
  label: string;
}

interface RejectionReasonSelectProps {
  /**
   * Whose taxonomy to offer. The picker reads the very rows a manager edits in
   * Système › Paramètres › Motifs de rejet, so a reason added this morning is
   * pickable this afternoon. Omit it (or pass null) and the compiled taxonomy
   * is used — which is also what happens while the fetch is in flight.
   */
  marketId?: string | null;
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
  marketId = null,
  onSelect,
  onPostpone,
  defaultGroup,
}: RejectionReasonSelectProps) {
  const tGroups = useTranslations("orders.rejectionGroups");
  const tHints = useTranslations("orders.rejectionGroupHints");
  const tSubs = useTranslations("orders.rejectionSubreasons");
  const tQueue = useTranslations("queue");
  const locale = useLocale();
  const { rows } = useRejectionReasons(marketId);

  const [group, setGroup] = useState<string | null>(defaultGroup ?? null);
  const [sub, setSub] = useState<string | null>(null);
  const [note, setNote] = useState("");

  /**
   * The market's taxonomy, or the compiled one until it arrives.
   *
   * Both shapes collapse to the same `Option` list so the two panes below do
   * not care which they are rendering — the alternative was every label site
   * carrying a ternary, which is how the two lists would silently diverge.
   */
  const { groups, subsOf, noteOnly } = useMemo(() => {
    const tree = buildRejectionTree(rows, { activeOnly: true });

    if (tree.length > 0) {
      const pick = (labelFr: string, labelAr: string) =>
        locale.startsWith("ar") ? labelAr : labelFr;

      return {
        groups: tree.map((g) => ({
          key: g.key,
          label: pick(g.labelFr, g.labelAr),
        })) as Option[],
        subsOf: (k: string): Option[] =>
          (tree.find((g) => g.key === k)?.subreasons ?? []).map((sr) => ({
            key: sr.key,
            label: pick(sr.label_fr, sr.label_ar),
          })),
        noteOnly: (k: string) =>
          tree.find((g) => g.key === k)?.requiresNote ?? false,
      };
    }

    return {
      groups: REJECTION_GROUPS.map((g) => ({
        key: g as string,
        label: tGroups(g),
      })) as Option[],
      subsOf: (k: string): Option[] =>
        (
          REJECTION_SUBREASONS[k as keyof typeof REJECTION_SUBREASONS] ?? []
        ).map((sr) => ({ key: sr, label: tSubs(sr as never) })),
      // The compiled taxonomy has exactly one note-only group.
      noteOnly: (k: string) => k === "autre",
    };
  }, [rows, locale, tGroups, tSubs]);

  // The one-line explanation under a group name. Only the five seeded groups
  // have one; next-intl renders a missing key as its own path, which would put
  // "orders.rejectionGroupHints.sans_suite" under a manager's own group.
  function hintFor(key: string): string | null {
    const text = tHints(key as never);
    return text && !text.includes("rejectionGroupHints") ? text : null;
  }

  function chooseGroup(next: string) {
    // A group with nothing under it is a complete answer on its own, otherwise
    // retiring the last sub-reason would make the group unpickable.
    if (!noteOnly(next) && subsOf(next).length === 0) {
      setGroup(next);
      setSub(null);
      setNote("");
      onSelect(next, null, undefined);
      return;
    }
    setGroup(next);
    setSub(null);
    setNote("");
  }

  function chooseSub(next: string) {
    setSub(next);
    onSelect(group as string, next, undefined);
  }

  function changeNote(value: string) {
    setNote(value);
    // An empty note is not an answer — see the 440 orders that prove it.
    if (value.trim()) onSelect(group as string, null, value);
  }

  if (group === null) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-agent-ink-3">
          {tQueue("rejectionGroupLabel")}
        </span>

        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => chooseGroup(g.key)}
            className="flex flex-col items-start gap-0.5 rounded-lg border border-agent-outline-variant bg-agent-surface px-4 py-2.5 text-start transition-colors duration-fast hover:border-agent-outline hover:bg-agent-surface-low"
          >
            <span className="text-[14px] font-semibold text-agent-on-surface">
              {g.label}
            </span>
            {/* A hint exists only for the five seeded groups; one a manager
                named themselves simply has none. */}
            {hintFor(g.key) && (
              <span className="text-[12px] text-agent-ink-3">{hintFor(g.key)}</span>
            )}
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
          {groups.find((g) => g.key === group)?.label ?? group}
        </span>
      </div>

      {noteOnly(group) ? (
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
          {subsOf(group).map((sr) => (
            <button
              key={sr.key}
              type="button"
              aria-pressed={sub === sr.key}
              onClick={() => chooseSub(sr.key)}
              className={[
                "rounded-lg border px-4 py-2.5 text-start text-[14px] font-medium transition-colors duration-fast",
                sub === sr.key
                  ? "border-brand bg-brand-tint text-agent-on-surface"
                  : "border-agent-outline-variant bg-agent-surface text-agent-on-surface hover:border-agent-outline hover:bg-agent-surface-low",
              ].join(" ")}
            >
              {sr.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
