"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import type { ScannedPage, ScannedRow } from "@/app/api/warehouse/scanned/route";

/**
 * The three things you can do to a parcel that has already been scanned out.
 *
 * Shared by the phone list and the desk table so the two can never disagree
 * about what "re-check" means or when an un-scan is still possible — the kind
 * of drift that put two different roll-colour rules on two screens.
 *
 * None of these moves the order forward: they settle which number the carrier
 * is holding, or put the parcel back on the bench. That is the whole surface.
 */

export interface ScannedFlash {
  tone: "ok" | "bad";
  text: string;
}

export function useScannedActions(warehouseId?: string | null) {
  const t = useTranslations("warehouse.scanned");
  const key = `/api/warehouse/scanned?limit=100${warehouseId ? `&warehouse_id=${warehouseId}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<ScannedPage>(key, jsonFetcher, {
    revalidateOnFocus: true,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<ScannedFlash | null>(null);

  const call = useCallback(
    async (
      row: ScannedRow,
      path: string,
      body: Record<string, unknown>,
      okText: (r: Record<string, unknown>) => string,
    ) => {
      setBusyId(row.id);
      setFlash(null);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: row.id, ...body }),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          // The carrier's own words when there are any: ours would be a guess.
          setFlash({ tone: "bad", text: String(json.message ?? json.error ?? t("failed")) });
        } else {
          setFlash({ tone: "ok", text: okText(json) });
          await mutate();
        }
      } finally {
        setBusyId(null);
      }
    },
    [mutate, t],
  );

  const recheck = useCallback(
    (row: ScannedRow) =>
      call(row, "/api/warehouse/rebind", {}, (j) =>
        j.sticker_bind_state === "confirmed"
          ? t("recheckConfirmed")
          : t("recheckStill", { ref: String(j.carrier_reference ?? "—") }),
      ),
    [call, t],
  );

  const rebind = useCallback(
    (row: ScannedRow, sticker: string) =>
      call(row, "/api/warehouse/rebind", { sticker_ref: sticker }, (j) =>
        j.sticker_bind_state === "confirmed" ? t("rebindDone", { ref: sticker }) : t("rebindRefused"),
      ),
    [call, t],
  );

  const unscan = useCallback(
    (row: ScannedRow) => {
      // A reason, not a confirmation dialog: "are you sure?" records nothing,
      // and the ledger still has to explain this movement in six months.
      const note = window.prompt(t("unscanReason"));
      if (!note || !note.trim()) return;
      return call(row, "/api/warehouse/unscan", { note: note.trim() }, (j) =>
        t("unscanDone", { n: Number(j.stock_after ?? 0) }),
      );
    },
    [call, t],
  );

  return { data, error, isLoading, mutate, busyId, flash, recheck, rebind, unscan };
}

/** The carrier has not booked it yet, so it is still ours to take back. */
export function canUnscan(row: ScannedRow): boolean {
  return row.status === "scanned" && (row.carrier_status_slug ?? "pending") === "pending";
}
