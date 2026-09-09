"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { isDarbStickerPayload } from "@/lib/preparation/sticker-payload";
import {
  errorLabelKey,
  outcomeFor,
  refusal,
  type ScanEntry,
  type ScanResponse,
} from "@/lib/preparation/scan-outcome";

/**
 * The scan-out act, without a screen around it.
 *
 * Libya binds Darb's pre-printed sticker to the parcel in hand; Tunisia scans
 * our own QR, which IS the order id and resolves itself. Both refuse locally
 * before touching the network where they can: nothing in hand, or a payload
 * that is not a bare sticker number (Darb would bind a URL without complaint).
 */
export function useScanOut({
  market,
  hand,
  orders,
  onScanned,
}: {
  market: "ly" | "tn";
  hand: WarehouseOrderRow | null;
  orders: WarehouseOrderRow[];
  onScanned: () => void;
}) {
  const t = useTranslations("warehouse.scan");
  const isLy = market === "ly";
  const [busy, setBusy] = useState(false);
  const [scans, setScans] = useState<ScanEntry[]>([]);

  const push = useCallback((entry: ScanEntry) => {
    setScans((s) => [entry, ...s].slice(0, 8));
  }, []);

  const submit = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || busy) return;

      const target = isLy
        ? hand
        : orders.find((o) => o.id === code || o.id.startsWith(code)) ?? null;

      if (!target) {
        // Libya: the camera can fire with nothing in hand. That is not a
        // missing order, it is a scan with nothing to bind to.
        push(refusal(code, isLy ? t("errNoHand") : t("errNotFound")));
        return;
      }
      if (isLy && !isDarbStickerPayload(code)) {
        push(refusal(code, t("errNotNumeric")));
        return;
      }

      setBusy(true);
      const before = target.current_stock ?? 0;
      try {
        const res = await fetch("/api/warehouse/scan-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: target.id, sticker_ref: isLy ? code : null }),
        });
        const body = (await res.json().catch(() => ({}))) as ScanResponse;
        const outcome = outcomeFor(res.ok, body);

        // The row's stock is a cached page; "from" is derived from the
        // server's stock_after, never read off the row.
        const after = typeof body.stock_after === "number" ? body.stock_after : before - target.quantity;
        const key = errorLabelKey(body.error_code);
        // WRONG_SITE names the building it belongs to; every other refusal takes
        // no parameter, and next-intl ignores extras.
        const label = key ? t(key, { warehouse: body.warehouse_name ?? "" }) : null;
        // Darb's own wording beats anything we could invent; keep it beside ours.
        const detail = body.error_code === "DARB_BIND_FAILED" && body.message ? body.message : null;

        push({
          id: `${Date.now()}`,
          code,
          at: new Date().toISOString(),
          outcome,
          carrierRef: body.carrier_reference,
          from: res.ok ? after + target.quantity : undefined,
          to: res.ok ? after : undefined,
          message: res.ok
            ? undefined
            : label
              ? detail
                ? `${label} ${detail}`
                : label
              : body.message ?? body.error,
        });

        if (res.ok) onScanned();
      } finally {
        setBusy(false);
      }
    },
    [busy, isLy, hand, orders, onScanned, push, t],
  );

  const clear = useCallback(() => setScans([]), []);

  return { submit, busy, scans, last: scans[0] ?? null, clear };
}
