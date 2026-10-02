/**
 * What a rejected order should *look* like — the colour and the words.
 *
 * "Rejeté" in red was the label on 28% of rows, and it answered nothing. The
 * agent queue fixed this for itself a while ago (`lib/queue/agent-status` —
 * *a rejection says why, not that it happened*), but the manager's Commandes
 * table, the archive and the detail panel all go through `OrderStatusBadge`,
 * which is handed an already-translated string and knows nothing about reasons.
 * This module is what they were missing.
 *
 * Three encodings, each doing one job:
 *
 *   hue    — none of its own. A rejected order keeps the quiet red of every
 *            unsuccessful ending. Groups used to wear amber, violet, teal and
 *            grey — and each of those already names a LIVE status, so an
 *            unreachable customer read as an attempt in progress and a fake
 *            order read as shipped.
 *   icon   — which *kind* of failure, from the group (REJECTION_GROUP_ICONS).
 *   words  — the sub-reason's short label, never the word "rejected". "Faux n°"
 *            fits the status column; "Numéro faux ou inexistant" does not, so
 *            the full sentence travels separately as `detail`, for the hover.
 *
 * React-free on purpose: a route handler imports it as cheaply as a client
 * component, and the label it returns is a description rather than a string, so
 * the caller resolves translations with its own `useTranslations`.
 */

import type { StatusIconName } from "./status-presentation";
import type { RejectionReasonConfig } from "@/types/rejection-config";
import { rejectionGroupIcon } from "./rejection-config";

export type RejectionLabel =
  /** Straight from the market's config — the normal case. */
  | { kind: "config"; text: string }
  /** The agent's own words, for `autre`. */
  | { kind: "note"; text: string }
  /** The config has not loaded; the caller translates this key itself. */
  | {
      kind: "i18n";
      ns: "orders.rejectionSubreasonsShort" | "orders.rejectionReasons";
      key: string;
    }
  /** Nothing is known — the caller falls back to its own "Rejeté". */
  | { kind: "status" };

export interface RejectionInput {
  reason?: string | null;
  subreason?: string | null;
  note?: string | null;
}

export interface RejectionPresentation {
  icon: StatusIconName;
  label: RejectionLabel;
  /**
   * Group and sub-reason in full, plus the agent's note — the sentence the
   * column has no room for. Null until the market's config has loaded.
   */
  detail: string | null;
}

const isAr = (locale: string) => locale.startsWith("ar");

const shortFor = (row: RejectionReasonConfig, locale: string) =>
  isAr(locale) ? row.short_ar : row.short_fr;

const fullFor = (row: RejectionReasonConfig, locale: string) =>
  isAr(locale) ? row.label_ar : row.label_fr;

/** One line, single-spaced — a note is pasted from a call, not typeset. */
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

export function presentRejection(
  { reason, subreason, note }: RejectionInput,
  rows: RejectionReasonConfig[] = [],
  locale = "fr",
): RejectionPresentation {
  const subRow = subreason
    ? (rows.find((r) => r.key === subreason && r.parent_key !== null) ?? null)
    : null;

  // The sub-reason knows its own parent, so a row whose `rejection_reason`
  // column was never filled in still resolves a group — and therefore an icon.
  const groupKey = reason ?? subRow?.parent_key ?? null;

  const groupRow = groupKey
    ? (rows.find((r) => r.key === groupKey && r.parent_key === null) ?? null)
    : null;

  return {
    icon: rejectionGroupIcon(groupKey),
    label: labelFor({ reason, subreason, note }, rows, locale, subRow, groupRow),
    detail: detailFor(note, locale, subRow, groupRow),
  };
}

function detailFor(
  note: string | null | undefined,
  locale: string,
  subRow: RejectionReasonConfig | null,
  groupRow: RejectionReasonConfig | null,
): string | null {
  if (!groupRow) return null;
  const parts = [fullFor(groupRow, locale)];
  if (subRow) parts.push(fullFor(subRow, locale));
  const text = note ? tidy(note) : "";
  if (text) parts.push(text);
  return parts.join(" · ");
}

function labelFor(
  { reason, subreason, note }: RejectionInput,
  rows: RejectionReasonConfig[],
  locale: string,
  subRow: RejectionReasonConfig | null,
  groupRow: RejectionReasonConfig | null,
): RejectionLabel {
  // 1. The specific reason, always preferred — including when it has since been
  //    retired, because a past order has to keep rendering what was recorded.
  if (subRow) return { kind: "config", text: shortFor(subRow, locale) };
  if (subreason) {
    return {
      kind: "i18n",
      ns: "orders.rejectionSubreasonsShort",
      key: subreason,
    };
  }

  // 2. `autre` carries no sub-reason; the note is the whole answer, and the
  //    mandatory note is the only reason the group is still allowed to exist.
  if (groupRow?.requires_note || reason === "autre") {
    const text = note ? tidy(note) : "";
    if (text) return { kind: "note", text };
  }

  // 3. The group on its own — a legacy row, or a group whose sub-reasons were
  //    all retired.
  if (groupRow) return { kind: "config", text: shortFor(groupRow, locale) };
  if (reason) {
    return { kind: "i18n", ns: "orders.rejectionReasons", key: reason };
  }

  // 4. 93 rows in the live table are `rejected` with a null reason. They predate
  //    the requirement and there is nothing honest to say about them.
  void rows;
  return { kind: "status" };
}
