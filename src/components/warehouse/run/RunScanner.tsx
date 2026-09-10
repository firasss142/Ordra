"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, TriangleAlert, X } from "lucide-react";
import { QrScanner } from "@/components/warehouse/QrScanner";
import { ScanViewfinder } from "@/components/warehouse/mobile/ScanViewfinder";
import { useScanOut } from "@/components/warehouse/bench/useScanOut";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { ScanOutcome } from "@/lib/preparation/scan-outcome";
import type { RunRow } from "@/lib/warehouse/scan-buckets";

/**
 * Bind the sticker, then get out of the way.
 *
 * The run's whole point is that the agent never has to decide what happens
 * next: a good bind advances on its own. Two outcomes deliberately do NOT
 * advance, because both need a human to read them:
 *
 *   bind_unverified      Darb kept a different number. The parcel is leaving
 *                        under a reference we do not hold; scrolling past it is
 *                        how eight parcels went out untracked on 2026-09-08.
 *   bound_not_committed  Live at Darb, no stock moved. A manager must know.
 *
 * The hardware gun is wired here at last: `createScannerInputHandler` has been
 * implemented and tested since the first bench and was never mounted, so a
 * wedge only worked if the right field happened to hold focus.
 */

const TONE: Record<ScanOutcome, string> = {
  bound: "border-wh-ok",
  refused_here: "border-wh-bad",
  refused_darb: "border-wh-bad",
  bound_not_committed: "border-wh-warn bg-wh-warn-bg",
  bind_unverified: "border-wh-warn bg-wh-warn-bg",
};

/** Long enough to read the number and the stock, short enough to keep moving. */
const ADVANCE_MS = 1400;

export function RunScanner({
  market,
  row,
  hex,
  onBound,
  onNext,
  onSkip,
}: {
  market: "ly" | "tn";
  row: RunRow;
  hex: string | null;
  /** A parcel left the bench: the caller drops it and counts the scan. */
  onBound: () => void;
  /** Move to the next parcel of the batch. */
  onNext: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("warehouse.run");
  const tb = useTranslations("warehouse.bench");
  const ts = useTranslations("warehouse.scan");
  const isLy = market === "ly";

  const prefs = useMemo(() => readScannerPrefs(), []);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(prefs.cameraFirst);
  const [held, setHeld] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { submit, busy, last, clear } = useScanOut({
    market,
    hand: row,
    orders: [row],
    onScanned: onBound,
  });

  // A new parcel: forget the previous outcome, re-arm the camera.
  useEffect(() => {
    clear();
    setValue("");
    setHeld(false);
    setCamera(prefs.cameraFirst);
  }, [row.id, clear, prefs.cameraFirst]);

  const lastId = last?.id;
  useEffect(() => {
    if (lastId && last) signalOutcome(last.outcome, prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  /*
   * The hardware gun. Mounted on the document, not on an input, because the
   * agent's hands are on a parcel and nothing guarantees focus is anywhere
   * useful. Typing into the field still works: the handler only fires on a
   * burst faster than a human can type.
   */
  const onScan = useCallback((text: string) => void submit(text), [submit]);
  useEffect(() => {
    if (busy || last) return;
    const { handler, cleanup } = createScannerInputHandler(onScan);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      cleanup();
    };
  }, [onScan, busy, last]);

  const committed = last?.outcome === "bound";
  // Only a clean bind advances on its own. The two amber outcomes are exactly
  // the ones somebody has to read.
  useEffect(() => {
    if (!committed || held) return;
    const id = setTimeout(onNext, ADVANCE_MS);
    return () => clearTimeout(id);
  }, [committed, held, onNext]);

  if (busy) {
    return (
      <div
        role="status"
        className="grid min-h-[220px] place-items-center gap-2.5 rounded-[14px] border border-wm-card-edge bg-wm-card p-4 text-center"
      >
        <span
          aria-hidden="true"
          className="h-9 w-9 animate-spin rounded-full border-4 border-wm-track border-t-wm-accent motion-reduce:animate-none"
        />
        <span className="text-[16px] font-semibold text-wm-ink">{isLy ? ts("binding") : ts("bindingTn")}</span>
      </div>
    );
  }

  if (last) {
    const outcome = last.outcome;
    const warn = outcome === "bound_not_committed" || outcome === "bind_unverified";
    const moved = outcome === "bound" || outcome === "bind_unverified";
    const Icon = outcome === "bound" ? Check : warn ? TriangleAlert : X;
    const ink = outcome === "bound" ? "text-wh-ok" : warn ? "text-wh-warn" : "text-wh-bad";
    const heading: Record<ScanOutcome, string> = {
      bound: tb("bound", { name: row.customer_name }),
      refused_here: ts("errRefused"),
      refused_darb: ts("errCarrier"),
      bound_not_committed: ts("errBoundNotCommitted"),
      bind_unverified: ts("errBindUnverified"),
    };

    return (
      <div>
        <div
          data-testid="wh-run-result"
          data-outcome={outcome}
          className={`grid min-h-[200px] place-items-center gap-2 rounded-[14px] border bg-wm-card p-4 text-center ${TONE[outcome]}`}
        >
          <Icon size={40} strokeWidth={2} className={ink} aria-hidden="true" />
          <b dir="ltr" className="text-[26px] font-bold tracking-[0.06em] tabular-nums text-wm-ink">{last.code}</b>
          <p className="text-[16px] font-semibold text-wm-ink">{heading[outcome]}</p>
          {moved ? (
            <p className="text-[15px] tabular-nums text-wm-ink-2">
              {tb("stockEffect", { from: last.from ?? "—", to: last.to ?? "—" })}
            </p>
          ) : (
            <p className="text-[14px] text-wm-ink-2">{last.message}</p>
          )}
          {outcome === "bound_not_committed" ? (
            <p className="text-[14px] text-wm-ink-2">{tb("notCommittedHint")}</p>
          ) : null}
          {outcome === "bind_unverified" ? (
            <p data-testid="wh-run-unverified" className="text-[14px] text-wm-ink-2">
              {tb("unverifiedHint", { ref: last.carrierRef ?? "—" })}
            </p>
          ) : null}
        </div>

        <div className="mt-2.5 grid gap-2">
          {moved ? (
            <>
              <button
                type="button"
                onClick={onNext}
                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep"
              >
                {t("nextNow")}
              </button>
              {committed && !held ? (
                <button
                  type="button"
                  onClick={() => setHeld(true)}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[13.5px] font-semibold text-wm-ink-2"
                >
                  {t("stay")}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={clear}
                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep"
              >
                {tb("retry")}
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
              >
                {t("skip")}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="wh-run-scanner">
      {camera ? (
        <QrScanner active={camera} frameColor={hex} onScan={onScan} onClose={() => setCamera(false)} />
      ) : (
        <ScanViewfinder frameColor={hex}>
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

      <p className="mb-1.5 mt-3 text-[12.5px] text-wm-ink-3">{isLy ? tb("typeNumber") : tb("typeQr")}</p>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const code = value;
            setValue("");
            onScan(code);
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
        onClick={() => {
          const code = value;
          setValue("");
          onScan(code);
        }}
        className="mt-2.5 inline-flex min-h-[52px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep"
      >
        {tb("bind")}
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
      >
        {t("skip")}
      </button>
    </div>
  );
}
