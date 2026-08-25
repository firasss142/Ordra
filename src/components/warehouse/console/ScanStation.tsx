"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, ScanLine, TriangleAlert, X } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { QrScanner } from "@/components/warehouse/QrScanner";
import { WH_LABEL } from "./tokens";
import { WhPill } from "./primitives";

/**
 * The scan bench.
 *
 * One component, two shapes. `panel` sits beside the queue on Préparation;
 * `station` is the full-screen mode for a tablet at the packing table, where
 * the operator's hands are on a parcel and the nearest thing they can read is
 * two feet away. Sharing the component is the point: the outcomes are subtle
 * enough (bound at Darb / refused here / refused there / bound but not
 * committed) that two implementations would drift and one would start lying.
 *
 * THE COLOUR IS THE LOUDEST THING ON THE PANEL. Darb hands out pre-printed
 * stickers on coloured rolls and routes by that colour, so reaching for the
 * wrong roll sends the parcel to the wrong city — and Darb accepts the number
 * without complaint, so nothing downstream catches it. Naming the colour before
 * the parcel is touched is the whole control; we deliberately do not track
 * which rolls are open, so there is nothing to check the scanned number against.
 */

export type ScanOutcome =
  | "bound"
  | "refused_here"
  | "refused_darb"
  | "bound_not_committed";

export interface ScanEntry {
  id: string;
  code: string;
  at: string;
  outcome: ScanOutcome;
  from?: number;
  to?: number;
  message?: string;
}

interface ScanResponse {
  stock_after?: number;
  message?: string;
  error_code?: string;
  error?: string;
  darb_bound?: boolean;
}

/** Which outcome a response represents. Only `bound` is a clean success. */
function outcomeFor(ok: boolean, body: ScanResponse): ScanOutcome {
  if (ok) return "bound";
  if (body.darb_bound) return "bound_not_committed";
  if (body.error_code === "DARB_BIND_FAILED" || body.error_code === "DARB_SHIPMENT_UNKNOWN") {
    return "refused_darb";
  }
  return "refused_here";
}

const OUTCOME_TONE: Record<ScanOutcome, { border: string; bg: string; ink: string }> = {
  bound: { border: "border-wh-ok-edge", bg: "bg-wh-ok-bg", ink: "text-wh-ok" },
  refused_here: { border: "border-wh-bad-edge", bg: "bg-wh-bad-bg", ink: "text-wh-bad" },
  refused_darb: { border: "border-wh-bad-edge", bg: "bg-wh-bad-bg", ink: "text-wh-bad" },
  bound_not_committed: {
    border: "border-wh-warn-edge",
    bg: "bg-wh-warn-bg",
    ink: "text-wh-warn",
  },
};

export function ScanStation({
  variant = "panel",
  market,
  hand,
  handZone,
  orders,
  onScanned,
}: {
  variant?: "panel" | "station";
  market: "ly" | "tn";
  /** The parcel the operator took off the queue. Libya cannot resolve without it. */
  hand: WarehouseOrderRow | null;
  handZone: OrderZone | null;
  /** Tunisia scans our own QR, which IS the order id, so it resolves itself. */
  orders: WarehouseOrderRow[];
  onScanned: () => void;
}) {
  const t = useTranslations("warehouse.scan");
  const isLy = market === "ly";
  const isStation = variant === "station";

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!camera) inputRef.current?.focus();
  }, [hand, camera]);

  const submit = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || busy) return;
      setValue("");

      // Libya: the code is Darb's sticker, which the OMS cannot resolve on its
      // own — the row the operator took IS the order. Tunisia: the QR is the
      // order id, so it resolves itself.
      const target = isLy
        ? hand
        : orders.find((o) => o.id === code || o.id.startsWith(code)) ?? null;

      if (!target) {
        setScans((s) =>
          [
            {
              id: `${Date.now()}`,
              code,
              at: new Date().toISOString(),
              outcome: "refused_here" as const,
              message: t("errNotFound"),
            },
            ...s,
          ].slice(0, 8),
        );
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

        setScans((s) =>
          [
            {
              id: `${Date.now()}`,
              code,
              at: new Date().toISOString(),
              outcome,
              from: res.ok ? before : undefined,
              to: res.ok ? body.stock_after ?? before - target.quantity : undefined,
              message: res.ok
                ? undefined
                : errorLabel(body.error_code, t) ?? body.message ?? body.error,
            },
            ...s,
          ].slice(0, 8),
        );

        if (res.ok) onScanned();
      } finally {
        setBusy(false);
        if (!camera) inputRef.current?.focus();
      }
    },
    [busy, isLy, hand, orders, onScanned, camera, t],
  );

  const last = scans[0];
  const armed = Boolean(hand) || !isLy;

  return (
    <div className={isStation ? "mx-auto w-full max-w-[720px]" : ""}>
      {/* The colour to reach for. First thing on the panel, biggest thing on
          the station — it is the decision made before the parcel is touched. */}
      {isLy && hand ? <RollStrip zone={handZone} big={isStation} t={t} /> : null}

      <div className={`rounded-wh border border-wh-border bg-wh-surface ${isStation ? "" : "shadow-sm"}`}>
        <div className="flex items-center gap-2 border-b border-wh-border px-4 py-3">
          <ScanLine size={16} className="text-wh-ink-3" aria-hidden="true" />
          <h2 className="text-[14px] font-bold text-wh-ink-1">
            {isLy ? t("title") : t("titleTn")}
          </h2>
          <span className="ms-auto text-[12px] text-wh-ink-3">{t("oneSticker")}</span>
        </div>

        {/* The parcel in hand. Without it Libya has nothing to bind the sticker to. */}
        <div className="m-4 rounded-[11px] border border-wh-border bg-wh-sunken p-3.5">
          <div className={`flex items-center ${WH_LABEL}`}>
            {hand ? t("handLabel") : t("handNone")}
            {hand && handZone?.nameFr ? (
              <span className="ms-auto">
                <WhPill tone="scan">{handZone.nameFr}</WhPill>
              </span>
            ) : null}
          </div>
          {hand ? (
            <>
              <div
                className={`mt-1.5 font-bold text-wh-ink-1 ${isStation ? "text-[24px]" : "text-[16px]"}`}
              >
                <bdi>{hand.customer_name}</bdi>
              </div>
              <div className={`mt-0.5 text-wh-ink-2 ${isStation ? "text-[14px]" : "text-[12.5px]"}`}>
                <span className="font-mono tabular-nums">{hand.id.slice(0, 8).toUpperCase()}</span>
                {hand.customer_city ? <> · <bdi>{hand.customer_city}</bdi></> : null}
                {" · "}
                <bdi>{hand.product_name}</bdi> × {hand.quantity}
              </div>
            </>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-wh-ink-2">{t("handNoneHint")}</p>
          )}
        </div>

        <div className="mx-4 flex items-center gap-2">
          <label
            className={`flex flex-1 items-center gap-2.5 rounded-[12px] border-2 bg-wh-surface px-4 ${
              isStation ? "py-5" : "py-3.5"
            } ${armed ? "border-wh-ok shadow-wh-glow" : "border-wh-border bg-wh-sunken"}`}
          >
            <ScanLine
              size={isStation ? 24 : 18}
              className={armed ? "text-wh-ok" : "text-wh-ink-3"}
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit(value);
                }
              }}
              disabled={busy || !armed}
              autoComplete="off"
              aria-label={isLy ? t("placeholder") : t("placeholderTn")}
              placeholder={armed ? (isLy ? t("placeholder") : t("placeholderTn")) : t("placeholderIdle")}
              className={`w-full border-none bg-transparent font-mono font-semibold tracking-wide outline-none placeholder:font-sans placeholder:font-normal disabled:cursor-not-allowed ${
                isStation ? "text-[26px]" : "text-[16px]"
              }`}
            />
          </label>
          {/* At a desk the wedge scanner leads and the camera is a compact
              fallback: a gun is faster and cannot mistype. On a phone there is
              no gun, so that reasoning inverts and the camera gets the primary
              button below — same state, two affordances. */}
          <button
            type="button"
            data-testid="wh-camera-toggle"
            onClick={() => setCamera((v) => !v)}
            aria-pressed={camera}
            aria-label={t("camera")}
            className={`hidden shrink-0 place-items-center rounded-[12px] border md:grid ${
              isStation ? "h-[62px] w-[62px]" : "h-[50px] w-[50px]"
            } ${
              camera
                ? "border-wh-ok bg-wh-ok-bg text-wh-ok"
                : "border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
            }`}
          >
            <Camera size={isStation ? 22 : 18} aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 md:hidden">
          <button
            type="button"
            data-testid="wh-camera-primary"
            onClick={() => setCamera((v) => !v)}
            aria-pressed={camera}
            className={`mt-2.5 inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-pill border text-[15px] font-semibold transition-colors ${
              camera
                ? "border-wh-ok bg-wh-ok-bg text-wh-ok"
                : "border-wh-ok bg-wh-ok text-white shadow-[0_2px_10px_rgba(14,122,69,.3)]"
            }`}
          >
            <Camera size={20} aria-hidden="true" />
            {camera ? t("cameraStop") : t("camera")}
          </button>
        </div>

        {camera ? (
          <div className="mx-4 mt-3">
            <QrScanner
              active={camera}
              onScan={(text) => void submit(text)}
              onClose={() => setCamera(false)}
            />
          </div>
        ) : null}

        {last ? <ResultTile entry={last} big={isStation} t={t} /> : null}

        <div className="m-4">
          <div className={`mb-1.5 ${WH_LABEL}`}>{t("recent")}</div>
          {scans.length === 0 ? (
            <p className="py-3 text-[12.5px] text-wh-ink-3">{t("recentEmpty")}</p>
          ) : (
            scans.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2.5 border-t border-wh-border py-2 font-mono text-[12px] tabular-nums first:border-t-0"
              >
                {s.outcome === "bound" ? (
                  <Check size={15} className="text-wh-ok" aria-hidden="true" />
                ) : (
                  <X size={15} className="text-wh-bad" aria-hidden="true" />
                )}
                <span className="font-semibold">{s.code}</span>
                <span className="ms-auto text-end text-wh-ink-3">
                  {new Date(s.at).toLocaleTimeString("fr-FR")}
                  {s.outcome === "bound" ? (
                    <span className="ms-1.5 text-wh-ok">
                      {s.from} → {s.to}
                    </span>
                  ) : (
                    <span className="ms-1.5 text-wh-bad">{s.message}</span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2.5 border-t border-wh-border px-4 py-3 text-[12px] text-wh-ink-2">
          <TriangleAlert size={16} className="shrink-0 text-wh-warn" aria-hidden="true" />
          {t("neverType")}
        </div>
      </div>
    </div>
  );
}

/**
 * Which colour to reach for, before the parcel is touched.
 *
 * Two states only: a colour Darb published for this destination, or none it
 * could resolve. There is no third state about our own stock — we do not track
 * which rolls are open, and inventing a "roll missing" warning from nothing
 * would be worse than silence.
 */
function RollStrip({
  zone,
  big,
  t,
}: {
  zone: OrderZone | null;
  big: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (!zone || !zone.colorHex) {
    return (
      <div className="mb-3 flex items-center gap-3 rounded-[12px] border border-dashed border-wh-border-strong bg-wh-sunken px-4 py-3">
        <span
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-dashed border-wh-border-strong"
          aria-hidden="true"
        />
        <span className="text-[13px] text-wh-ink-2">{t("colourUnknown")}</span>
      </div>
    );
  }

  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border-2 bg-wh-surface px-4 ${
        big ? "py-4" : "py-3"
      }`}
      style={{ borderColor: zone.colorHex }}
    >
      <span
        className={`shrink-0 rounded-full border border-black/10 ${big ? "h-9 w-9" : "h-6 w-6"}`}
        style={{ background: zone.colorHex }}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <b className={`block font-bold uppercase tracking-[0.06em] text-wh-ink-1 ${big ? "text-[19px]" : "text-[14px]"}`}>
          {t("rollLabel", { colour: zone.colourFr ?? "" })}
        </b>
        <span className="block text-[12px] text-wh-ink-2">
          <bdi>{zone.nameFr}</bdi>
          {zone.nameAr ? <> · <bdi>{zone.nameAr}</bdi></> : null}
        </span>
      </span>
    </div>
  );
}

/**
 * The last scan, in four distinguishable states.
 *
 * `bound_not_committed` is the one that earns the extra state: the parcel IS
 * live at Darb, and an operator shown a plain "erreur" would re-sticker it and
 * bind a second number to a shipment already moving.
 */
function ResultTile({
  entry,
  big,
  t,
}: {
  entry: ScanEntry;
  big: boolean;
  t: (key: string) => string;
}) {
  const tone = OUTCOME_TONE[entry.outcome];
  const heading: Record<ScanOutcome, string> = {
    bound: t("okBound"),
    refused_here: t("errRefused"),
    refused_darb: t("errCarrier"),
    bound_not_committed: t("errBoundNotCommitted"),
  };

  return (
    <div className={`mx-4 mt-3.5 rounded-[11px] border p-3.5 ${tone.border} ${tone.bg}`}>
      <div
        className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] ${tone.ink}`}
      >
        {entry.outcome === "bound" ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <X size={16} aria-hidden="true" />
        )}
        {heading[entry.outcome]}
      </div>
      <div
        className={`mt-1.5 font-mono font-bold tabular-nums tracking-wide text-wh-ink-1 ${
          big ? "text-[30px]" : "text-[19px]"
        }`}
      >
        {entry.code}
      </div>
      <div className="mt-1 font-mono text-[12.5px] tabular-nums text-wh-ink-2">
        {entry.outcome === "bound"
          ? `${entry.from ?? "—"} → ${entry.to ?? "—"}`
          : entry.message}
      </div>
    </div>
  );
}

/** Operator-facing wording for every refusal the API can return. */
function errorLabel(code: string | undefined, t: (k: string) => string): string | null {
  switch (code) {
    case "STICKER_ALREADY_USED": return t("errStickerUsed");
    case "DARB_SHIPMENT_UNKNOWN": return t("errShipmentUnknown");
    case "DARB_BIND_FAILED": return t("errBindFailed");
    case "NO_LABEL_PRINTED": return t("errNoLabel");
    case "INVALID_STATUS": return t("errStatus");
    case "MARKET_MISMATCH": return t("errMarket");
    case "STOCK_UNDERFLOW": return t("errStock");
    case "CARRIER_WAREHOUSE_ORDER": return t("errCarrierWarehouse");
    case "ORDER_NOT_FOUND": return t("errNotFound");
    default: return null;
  }
}
