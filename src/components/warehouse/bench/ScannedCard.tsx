"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Package, RotateCcw, Undo2, XCircle } from "lucide-react";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";

/**
 * One parcel that has already been scanned out.
 *
 * The card exists to answer one question the bench could not ask before: is the
 * carrier holding the number we printed on this box? Three answers, three
 * different acts, so they never share a look:
 *
 *   confirmed      quiet green tick. Nothing to do.
 *   restickered    amber, and it NAMES Darb's number — "it failed" is not
 *                  actionable, "Darb is holding 1279049" is.
 *   not_registered red. The bind never took; re-send it.
 *
 * The un-scan sits behind a confirmation because it moves stock and frees a
 * sticker that is physically glued to a box.
 */

type BindState = ScannedRow["sticker_bind_state"];

const TONE: Record<string, string> = {
  confirmed: "border-wh-ok-edge bg-wh-ok-bg text-wh-ok",
  restickered: "border-wh-warn-edge bg-wh-warn-bg text-wh-warn",
  not_registered: "border-wh-bad-edge bg-wh-bad-bg text-wh-bad",
  unknown: "border-wm-card-edge bg-wm-card text-wm-ink-2",
};

function BindPill({ state, actual, t }: { state: BindState; actual: string | null; t: (k: string, v?: Record<string, string | number>) => string }) {
  const key = state ?? "unchecked";
  const Icon = state === "confirmed" ? Check : state === "not_registered" ? XCircle : AlertTriangle;
  return (
    <span
      data-testid="wh-bind-state"
      data-state={key}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12.5px] font-semibold ${
        state ? TONE[state] : TONE.unknown
      }`}
    >
      {state ? <Icon size={13} aria-hidden="true" /> : null}
      {state === "restickered" && actual ? (
        <>
          {t("bind.restickered")}
          <b dir="ltr" className="tabular-nums">{actual}</b>
        </>
      ) : (
        t(`bind.${key}`)
      )}
    </span>
  );
}

export function ScannedCard({
  row,
  isLy,
  busy,
  onRecheck,
  onRebind,
  onUnscan,
}: {
  row: ScannedRow;
  isLy: boolean;
  busy: boolean;
  onRecheck: (row: ScannedRow) => void;
  onRebind: (row: ScannedRow, sticker: string) => void;
  onUnscan: (row: ScannedRow) => void;
}) {
  const t = useTranslations("warehouse.scanned");
  const tStatus = useTranslations("orders.statuses");
  const [rebinding, setRebinding] = useState(false);
  const [sticker, setSticker] = useState("");

  const hex = isLy ? (row.zone?.colorHex ?? "") : "";
  // The carrier has not booked it yet, so it is still ours to take back.
  const canUnscan = row.status === "scanned" && (row.carrier_status_slug ?? "pending") === "pending";

  return (
    <article
      data-testid="wh-scanned-card"
      data-status={row.status}
      className={`relative rounded-[14px] border border-wm-card-edge bg-wm-card p-3 ${hex ? "ps-[18px]" : ""}`}
    >
      {hex ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 start-0 w-[6px] rounded-s-[13px]"
          style={{ background: hex }}
        />
      ) : null}

      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-wm-card-edge bg-wm-ground text-wm-ink-3"
        >
          {row.product_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.product_image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Package size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[16px] font-bold leading-tight text-wm-ink">
            <bdi>{row.customer_name}</bdi>
          </b>
          <span className="block truncate text-[13.5px] text-wm-ink-2">
            <bdi>{row.product_name}</bdi> × {row.quantity}
            {row.customer_city ? (
              <>
                {" · "}
                <bdi>{row.customer_city}</bdi>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span
          data-testid="wh-scanned-sticker"
          dir="ltr"
          className="rounded-[8px] border border-wm-card-edge bg-wm-ground px-2.5 py-1 text-[16px] font-bold tracking-[0.04em] tabular-nums text-wm-ink"
        >
          {row.carrier_sticker_ref ?? "—"}
        </span>
        <BindPill state={row.sticker_bind_state} actual={row.carrier_reference_actual} t={t} />
        <span className="rounded-pill border border-wm-card-edge px-2.5 py-1 text-[12.5px] text-wm-ink-2">
          {tStatus(row.status)}
        </span>
      </div>

      {row.scanned_at ? (
        <p className="mt-1.5 text-[12.5px] text-wm-ink-3">
          {t("scannedBy", {
            who: row.scanned_by_name ?? "—",
            when: new Date(row.scanned_at).toLocaleString(),
          })}
        </p>
      ) : null}

      {rebinding ? (
        <div className="mt-2.5 grid gap-2">
          <input
            value={sticker}
            onChange={(e) => setSticker(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            autoFocus
            aria-label={t("newSticker")}
            placeholder="1213123"
            className="min-h-[48px] w-full rounded-[12px] border border-wm-card-edge bg-wm-ground px-3.5 text-start text-[18px] font-semibold tracking-[0.06em] tabular-nums text-wm-ink outline-none focus:border-wm-accent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !sticker.trim()}
              onClick={() => {
                onRebind(row, sticker.trim());
                setRebinding(false);
                setSticker("");
              }}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] bg-wm-accent px-3 text-[14px] font-bold text-white disabled:opacity-40"
            >
              {t("sendSticker")}
            </button>
            <button
              type="button"
              onClick={() => setRebinding(false)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[12px] px-3 text-[14px] font-semibold text-wm-ink-2"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRecheck(row)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-wm-card-edge px-3 text-[13.5px] font-semibold text-wm-ink disabled:opacity-40"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t("recheck")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRebinding(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-wm-card-edge px-3 text-[13.5px] font-semibold text-wm-ink disabled:opacity-40"
          >
            {t("rebind")}
          </button>
          {canUnscan ? (
            <button
              type="button"
              data-testid="wh-unscan"
              disabled={busy}
              onClick={() => onUnscan(row)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-wh-bad-edge px-3 text-[13.5px] font-semibold text-wh-bad disabled:opacity-40"
            >
              <Undo2 size={14} aria-hidden="true" />
              {t("unscan")}
            </button>
          ) : (
            // Not a missing button: say why it is gone, or the agent hunts for it.
            <span className="inline-flex min-h-[44px] items-center text-[12.5px] text-wm-ink-3">
              {t("unscanClosed")}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
