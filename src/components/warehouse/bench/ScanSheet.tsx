"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Check, TriangleAlert, X } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { PrepRow } from "@/components/warehouse/console/PrepCard";
import { QrScanner } from "@/components/warehouse/QrScanner";
import { ScanViewfinder } from "@/components/warehouse/mobile/ScanViewfinder";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";
import type { ScanOutcome } from "@/lib/preparation/scan-outcome";
import { useScanOut } from "./useScanOut";

/**
 * The scan sheet: the parcel in hand, its roll, the camera, one outcome.
 *
 * It slides over the bench rather than being a screen of its own, so the
 * parcel the agent took is the parcel that gets bound; the old station forgot
 * the hand on every navigation. With nothing in hand it is a lookup: what does
 * the system know about this sticker.
 *
 * THE COLOUR IS THE LOUDEST THING HERE. Darb routes by the sticker colour and
 * binds any number without complaint, so the band names the roll before the
 * camera opens, and the viewfinder brackets take the same colour.
 */

interface Lookup {
  outcome: "found" | "wrong_status" | "ambiguous" | "not_found" | "empty";
  code: string;
  order?: WarehouseOrderRow;
  status?: string;
}

export function ScanSheet({
  open,
  market,
  hand,
  orders,
  currency: _currency,
  next,
  onTakeNext,
  onPutBack,
  onClose,
  onBound,
}: {
  open: boolean;
  market: "ly" | "tn";
  hand: PrepRow | null;
  orders: WarehouseOrderRow[];
  currency: string;
  /** The parcel to offer after a bind: same roll first. */
  next: PrepRow | null;
  onTakeNext: (row: PrepRow) => void;
  onPutBack: () => void;
  onClose: () => void;
  onBound: () => void;
}) {
  const t = useTranslations("warehouse.bench");
  const ts = useTranslations("warehouse.scan");
  const tStatus = useTranslations("orders.statuses");
  const locale = useLocale();
  const isLy = market === "ly";

  const prefs = useMemo(() => readScannerPrefs(), []);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { submit, busy, last, clear } = useScanOut({ market, hand, orders, onScanned: onBound });

  // The parcel a result is about. `hand` is cleared the moment a bind lands,
  // and the result must still name who it was for.
  const lastHandRef = useRef<PrepRow | null>(hand);
  if (hand) lastHandRef.current = hand;

  const handId = hand?.id ?? null;
  useEffect(() => {
    if (!handId) return;
    clear();
    setLookup(null);
    setValue("");
    setCamera(prefs.cameraFirst);
  }, [handId, clear, prefs.cameraFirst]);

  useEffect(() => {
    if (open) return;
    clear();
    setLookup(null);
    setValue("");
    setCamera(false);
  }, [open, clear]);

  const lastId = last?.id;
  useEffect(() => {
    if (lastId && last) signalOutcome(last.outcome, prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const doLookup = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || looking) return;
      setLooking(true);
      try {
        const res = await fetch(`/api/warehouse/returns/lookup?code=${encodeURIComponent(code)}`);
        const body = res.ok ? ((await res.json()) as Lookup) : { outcome: "not_found" as const };
        setLookup({ ...body, code });
        signalOutcome(body.outcome === "found" || body.outcome === "wrong_status" ? "lookup" : "refused_here", prefs);
      } catch {
        setLookup({ outcome: "not_found", code });
      } finally {
        setLooking(false);
      }
    },
    [looking, prefs],
  );

  const act = useCallback(
    (raw: string) => {
      setValue("");
      if (hand) void submit(raw);
      else void doLookup(raw);
    },
    [hand, submit, doLookup],
  );

  if (!open) return null;

  const zone = hand ? zoneLabels(hand.zone, locale) : { colour: null, name: null };
  const hex = isLy && hand ? (hand.zone.colorHex ?? "") : "";
  const plate = hand?.zone.branchGroup ?? "?";

  return (
    <>
      <div
        data-testid="wh-sheet-scrim"
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(26,26,26,.35)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("sheetTitle")}
        className="fixed inset-x-0 bottom-0 z-[61] max-h-[92vh] overflow-y-auto rounded-t-[20px] bg-wm-ground px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-2"
      >
        <span aria-hidden="true" className="mx-auto mb-2.5 block h-1 w-10 rounded-pill bg-wm-ink-3/50" />

        {hand ? (
          <p className="mb-2.5 text-[15px] font-semibold text-wm-ink">
            {`${t("handTitle")} ${hand.customer_name}${hand.customer_city ? ` · ${hand.customer_city}` : ""} · ${hand.product_name} × ${hand.quantity}`}
          </p>
        ) : (
          <p className="mb-2.5 text-[15px] text-wm-ink-2">{t("noHand")}</p>
        )}

        {isLy ? (
          <>
            <div
              data-testid="wh-sheet-band"
              data-roll={hex}
              className="flex min-h-[56px] items-center gap-3 rounded-[12px] px-3.5"
              style={{ background: hex || "var(--wm-track)" }}
            >
              {/* Solid white plates: over nine hues an alpha tint lands anywhere
                  between 1.1:1 and 12.9:1; opaque white is 16.97:1 on all. */}
              <span className="min-w-0 flex-1 truncate rounded-[8px] bg-white px-3 py-1 text-[16px] font-bold text-wm-ink">
                {!hand ? t("noRoll") : hex && zone.colour ? t("roll", { colour: zone.colour }) : t("zoneUnknown")}
              </span>
              <span
                data-testid="wh-sheet-plate"
                dir="ltr"
                className="shrink-0 rounded-[6px] bg-white px-2.5 py-0.5 text-[15px] font-bold tracking-[0.04em] text-wm-ink"
              >
                {plate}
              </span>
            </div>
            <p className="mb-3 mt-1.5 px-0.5 text-[14px] text-wm-ink-2">
              {!hand ? "" : hex && zone.name ? zone.name : t("unknownZoneHint")}
            </p>
          </>
        ) : (
          <div className="mb-3" />
        )}

        {busy ? (
          <div
            role="status"
            className="grid min-h-[200px] place-items-center gap-2.5 rounded-[12px] border border-wm-card-edge bg-wm-card p-4 text-center"
          >
            <span
              aria-hidden="true"
              className="h-9 w-9 animate-spin rounded-full border-4 border-wm-track border-t-wm-accent motion-reduce:animate-none"
            />
            <span className="text-[16px] font-semibold text-wm-ink">{isLy ? ts("binding") : ts("bindingTn")}</span>
          </div>
        ) : last ? (
          <Result
            outcome={last.outcome}
            code={last.code}
            from={last.from}
            to={last.to}
            message={last.message}
            forName={lastHandRef.current?.customer_name ?? ""}
            next={next}
            sameRoll={
              !!next && !!lastHandRef.current && next.zone.colorHex !== null && next.zone.colorHex === lastHandRef.current.zone.colorHex
            }
            onTakeNext={onTakeNext}
            onRetry={clear}
            onPutBack={onPutBack}
            onClose={onClose}
            t={t}
            ts={ts}
          />
        ) : (
          <>
            {camera ? (
              <QrScanner
                active={camera}
                frameColor={hex || null}
                onScan={(text) => act(text)}
                onClose={() => setCamera(false)}
              />
            ) : (
              <ScanViewfinder frameColor={hex || null}>
                <button
                  type="button"
                  data-testid="wh-camera-primary"
                  onClick={() => setCamera(true)}
                  className="absolute inset-x-0 bottom-5 mx-auto inline-flex min-h-[52px] w-max items-center justify-center gap-2.5 rounded-pill bg-wm-accent px-6 text-[15px] font-bold text-white active:bg-wm-accent-deep"
                >
                  <Camera size={20} aria-hidden="true" />
                  {ts("camera")}
                </button>
              </ScanViewfinder>
            )}

            <p className="mb-1.5 mt-3 text-[12.5px] text-wm-ink-3">{isLy ? t("typeNumber") : t("typeQr")}</p>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  act(value);
                }
              }}
              inputMode={isLy ? "numeric" : "text"}
              pattern={isLy ? "[0-9]*" : undefined}
              autoComplete="off"
              dir="ltr"
              aria-label={ts("stickerNumber")}
              placeholder={isLy ? "1213123" : ts("placeholderTn")}
              className="min-h-[48px] w-full rounded-[12px] border border-wm-card-edge bg-wm-card px-3.5 text-start text-[20px] font-semibold tracking-[0.06em] tabular-nums text-wm-ink outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent"
            />
            <button
              type="button"
              onClick={() => act(value)}
              disabled={looking}
              className="mt-2.5 inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep disabled:opacity-50"
            >
              {hand ? t("bind") : t("lookup")}
            </button>

            {lookup ? <LookupResult lookup={lookup} t={t} tStatus={tStatus} /> : null}

            {hand ? (
              <button
                type="button"
                onClick={onPutBack}
                className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
              >
                {t("putBack")}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
              >
                {t("close")}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

const TONE: Record<ScanOutcome, string> = {
  bound: "border-wh-ok",
  refused_here: "border-wh-bad",
  refused_darb: "border-wh-bad",
  bound_not_committed: "border-wh-warn bg-wh-warn-bg",
};

/**
 * The outcome, as a card the agent acts from. Four states, four looks: the
 * amber one is a parcel already live at Darb whose stock did not move, and it
 * must never read as a plain error, or the agent re-stickers it.
 */
function Result({
  outcome, code, from, to, message, forName, next, sameRoll, onTakeNext, onRetry, onPutBack, onClose, t, ts,
}: {
  outcome: ScanOutcome;
  code: string;
  from?: number;
  to?: number;
  message?: string;
  forName: string;
  next: PrepRow | null;
  sameRoll: boolean;
  onTakeNext: (row: PrepRow) => void;
  onRetry: () => void;
  onPutBack: () => void;
  onClose: () => void;
  t: Translate;
  ts: Translate;
}) {
  const heading: Record<ScanOutcome, string> = {
    bound: t("bound", { name: forName }),
    refused_here: ts("errRefused"),
    refused_darb: ts("errCarrier"),
    bound_not_committed: ts("errBoundNotCommitted"),
  };
  const Icon = outcome === "bound" ? Check : outcome === "bound_not_committed" ? TriangleAlert : X;
  const ink = outcome === "bound" ? "text-wh-ok" : outcome === "bound_not_committed" ? "text-wh-warn" : "text-wh-bad";

  return (
    <div>
      <div
        data-testid="wh-sheet-result"
        data-outcome={outcome}
        className={`grid min-h-[200px] place-items-center gap-2 rounded-[12px] border bg-wm-card p-4 text-center ${TONE[outcome]}`}
      >
        <Icon size={40} strokeWidth={2} className={ink} aria-hidden="true" />
        <b dir="ltr" className="text-[28px] font-bold tracking-[0.06em] tabular-nums text-wm-ink">{code}</b>
        <p className="text-[16px] font-semibold text-wm-ink">{heading[outcome]}</p>
        {outcome === "bound" ? (
          <p className="text-[15px] tabular-nums text-wm-ink-2">{t("stockEffect", { from: from ?? "—", to: to ?? "—" })}</p>
        ) : (
          <p className="text-[14px] text-wm-ink-2">{message}</p>
        )}
        {outcome === "bound_not_committed" ? (
          <p className="text-[14px] text-wm-ink-2">{t("notCommittedHint")}</p>
        ) : null}
      </div>

      <div className="mt-2.5 grid gap-2">
        {outcome === "bound" ? (
          <>
            {next ? (
              <button
                type="button"
                onClick={() => onTakeNext(next)}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep"
              >
                {t(sameRoll ? "nextSameRoll" : "nextAny", { name: next.customer_name, city: next.customer_city ?? "" })}
              </button>
            ) : (
              <p className="text-center text-[13px] text-wm-ink-2">{t("rollDone")}</p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
            >
              {t("close")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep"
            >
              {t("retry")}
            </button>
            <button
              type="button"
              onClick={onPutBack}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
            >
              {t("putBack")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** What the system knows about a sticker scanned with nothing in hand. */
function LookupResult({ lookup, t, tStatus }: { lookup: Lookup; t: Translate; tStatus: Translate }) {
  const known = (lookup.outcome === "found" || lookup.outcome === "wrong_status") && lookup.order;
  const status = lookup.outcome === "found" ? "to_be_returned" : (lookup.status ?? "");
  return (
    <div
      data-testid="wh-sheet-lookup"
      data-outcome={lookup.outcome}
      className={`mt-3 grid place-items-center gap-1.5 rounded-[12px] border bg-wm-card p-4 text-center ${known ? "border-wh-ok" : "border-wm-card-edge"}`}
    >
      <b dir="ltr" className="text-[22px] font-bold tracking-[0.06em] tabular-nums text-wm-ink">{lookup.code}</b>
      {known ? (
        <p className="text-[15px] font-semibold text-wm-ink">
          {t("lookupKnown", { name: lookup.order!.customer_name, status: status ? tStatus(status) : "" })}
        </p>
      ) : (
        <>
          <p className="text-[15px] font-semibold text-wm-ink">{t("lookupUnknown")}</p>
          <p className="text-[13px] text-wm-ink-2">{t("lookupUnknownHint")}</p>
        </>
      )}
    </div>
  );
}
