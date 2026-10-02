"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  presentRejection,
  type RejectionLabel,
} from "@/lib/orders/rejection-presentation";
import type { StatusIconName } from "@/lib/orders/status-presentation";
import { useRejectionReasons } from "./useRejectionReasons";

/** The three columns any surface needs to explain a rejection. */
export interface RejectableOrder {
  status: string;
  rejection_reason?: string | null;
  rejection_subreason?: string | null;
  rejection_note?: string | null;
}

export interface RejectionBadge {
  /** The group's mark. The badge's colour stays the rejected red. */
  icon: StatusIconName;
  /** The short words the column has room for. */
  text: string;
  /** The whole sentence — group, sub-reason, note — for the hover. */
  detail: string | null;
}

/**
 * Turns a rejected order into the mark and the few words a status badge shows.
 *
 * The thin adapter over `presentRejection`: that module decides *what* to say
 * (and is tested on its own), this one resolves the market's config, the active
 * locale and the bundled translations that stand in until the config loads.
 *
 * Returns a stable callback so a memoised table row is not repainted by the
 * identity of this function changing on every render.
 */
export function useRejectionBadge(marketId: string | null) {
  const { rows } = useRejectionReasons(marketId);
  const locale = useLocale();
  const tShort = useTranslations("orders.rejectionSubreasonsShort");
  const tReasons = useTranslations("orders.rejectionReasons");

  return useCallback(
    (order: RejectableOrder): RejectionBadge | null => {
      if (order.status !== "rejected") return null;

      const { icon, label, detail } = presentRejection(
        {
          reason: order.rejection_reason,
          subreason: order.rejection_subreason,
          note: order.rejection_note,
        },
        rows,
        locale,
      );

      const text = resolve(label, tShort, tReasons);
      return text ? { icon, text, detail } : null;
    },
    [rows, locale, tShort, tReasons],
  );
}

type T = ReturnType<typeof useTranslations>;

function resolve(label: RejectionLabel, tShort: T, tReasons: T): string | null {
  switch (label.kind) {
    case "config":
    case "note":
      return label.text;

    case "i18n": {
      // A key that is in neither the config nor the message bundle — a
      // sub-reason hard-deleted after an order used it, or one written by an
      // older deploy. next-intl renders the missing key as its own path, and
      // "orders.rejectionSubreasonsShort.motif_invente" in a 120px column is
      // worse than the plain red "Rejeté" this replaced.
      const t = label.ns === "orders.rejectionSubreasonsShort" ? tShort : tReasons;
      const text = t(label.key as never);
      return text && !text.includes(label.ns) ? text : null;
    }

    // Nothing is known about this rejection; the caller keeps its own "Rejeté".
    case "status":
      return null;
  }
}
