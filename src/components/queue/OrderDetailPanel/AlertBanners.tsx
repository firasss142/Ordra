"use client";

import { useLocale, useTranslations } from "next-intl";
import { Ic, useWhen } from "@/components/orders/commandes/ui";
import { CALLING_STATUSES, SHIPPED_STATUSES } from "@/lib/orders/row-signals";

export type NoteKind = "outOfStock" | "noCity" | "dupShipped" | "locked" | "callback" | "dispatch";

export interface NoteInput {
  status: string;
  /** No delivery city — the carrier upload cannot proceed. */
  cityMissing: boolean;
  /** A product on the order has no stock left. */
  outOfStock: boolean;
  /** A duplicate of this order is already with the carrier. */
  dupShipped: boolean;
  /** The order can no longer be edited without reopening it. */
  editBlocked: boolean;
  callbackScheduledAt: string | null;
  dispatchScheduledAt: string | null;
}

/**
 * Which notices the panel pins above its footer (prototypes/commandes-v4.html
 * `notesOf`), blockers first. Pure — the panel and its tests read one rule.
 */
export function panelNotes(i: NoteInput): NoteKind[] {
  const calling = CALLING_STATUSES.has(i.status);
  const notes: NoteKind[] = [];
  if (i.outOfStock && calling) notes.push("outOfStock");
  if (i.cityMissing && (calling || i.status === "confirmed" || i.status === "dispatch_scheduled")) notes.push("noCity");
  if (i.dupShipped && !SHIPPED_STATUSES.has(i.status)) notes.push("dupShipped");
  if (i.editBlocked) notes.push("locked");
  if (i.status === "callback_scheduled" && i.callbackScheduledAt) notes.push("callback");
  if (i.status === "dispatch_scheduled" && i.dispatchScheduledAt) notes.push("dispatch");
  return notes;
}

/** A transient line the panel adds itself — an upload result, a failed save. */
export interface ExtraNote {
  key: string;
  hue: "red" | "amber" | "green" | "neutral";
  icon: string;
  text: string;
  /** Announced as an alert rather than a status. */
  alert?: boolean;
}

const LOOK: Record<NoteKind, { hue: string; icon: string }> = {
  outOfStock: { hue: "red", icon: "alert" },
  noCity: { hue: "amber", icon: "pin" },
  dupShipped: { hue: "red", icon: "copy" },
  locked: { hue: "neutral", icon: "lock" },
  callback: { hue: "violet", icon: "clock" },
  dispatch: { hue: "teal", icon: "cal" },
};

/**
 * The notices pinned above the footer (`.notes`): one short line per problem,
 * in its hue, then the panel's own feedback. Renders nothing when all is well.
 */
export function AlertBanners({
  notes,
  extra = [],
  marketId,
  callbackScheduledAt = null,
  dispatchScheduledAt = null,
  dispatchScheduledAuto = false,
}: {
  notes: NoteKind[];
  extra?: ExtraNote[];
  marketId: string | null;
  callbackScheduledAt?: string | null;
  dispatchScheduledAt?: string | null;
  dispatchScheduledAuto?: boolean;
}) {
  const t = useTranslations("orders.detail");
  const locale = useLocale();
  const when = useWhen(marketId, locale);

  if (notes.length === 0 && extra.length === 0) return null;

  const text = (k: NoteKind): string => {
    switch (k) {
      case "outOfStock":
        return t("noteOutOfStock");
      case "noCity":
        return t("noteNoCity");
      case "dupShipped":
        return t("noteDupShipped");
      case "locked":
        return t("editBlockedStatus");
      case "callback":
        return `${t("scheduledCallbackBanner")} · ${when(callbackScheduledAt)}`;
      case "dispatch":
        return `${dispatchScheduledAuto ? t("scheduledDispatchAutoBanner") : t("scheduledDispatchBanner")} · ${when(dispatchScheduledAt)}`;
    }
  };

  return (
    <div className="notes">
      {notes.map((k) => (
        <div key={k} className={`note h-${LOOK[k].hue}`} role="status" data-note={k}>
          <Ic n={LOOK[k].icon} />
          <span>{text(k)}</span>
        </div>
      ))}
      {extra.map((n) => (
        <div key={n.key} className={`note h-${n.hue}`} role={n.alert ? "alert" : "status"}>
          <Ic n={n.icon} />
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}
