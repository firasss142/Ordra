"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QrScanner } from "@/components/warehouse/QrScanner";
import { useScanOut } from "@/components/warehouse/bench/useScanOut";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { ScanOutcome } from "@/lib/preparation/scan-outcome";
import type { RunRow } from "@/lib/warehouse/scan-buckets";
import { Ic } from "@/components/warehouse/desk/ui";

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
 * The hardware gun is mounted on the document: the agent's hands are on a
 * parcel and nothing guarantees focus is anywhere useful.
 *
 * The camera opens first only where there is a camera to aim — a phone. At the
 * desk the gun or the keyboard is the tool, and a webcam lighting up on every
 * parcel is noise.
 */

const TONE: Record<ScanOutcome, "ok" | "warn" | "bad"> = {
  bound: "ok",
  refused_here: "bad",
  refused_darb: "bad",
  bound_not_committed: "warn",
  bind_unverified: "warn",
};

/** Long enough to read the number and the stock, short enough to keep moving. */
const ADVANCE_MS = 1400;

/** A coarse pointer means a phone or a tablet; jsdom and old browsers count as one. */
function cameraByDefault(pref: boolean): boolean {
  if (!pref) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function RunScanner({
  market,
  row,
  hex,
  onBound,
  onUnresolved,
  onNext,
  onSkip,
}: {
  market: "ly" | "tn";
  row: RunRow;
  hex: string | null;
  /** A parcel left the bench: the caller drops it and counts the scan. */
  onBound: () => void;
  /**
   * A parcel that did NOT leave: refused here or at Darb, or bound without a
   * commit. The batch summary names these, because a count tells the agent
   * something went wrong while a list tells them which box is still on the table.
   */
  onUnresolved: (message: string) => void;
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
  const [camera, setCamera] = useState(() => cameraByDefault(prefs.cameraFirst));
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
    setCamera(cameraByDefault(prefs.cameraFirst));
  }, [row.id, clear, prefs.cameraFirst]);

  // Ready to scan: the field takes the keyboard, so typing just works.
  useEffect(() => {
    if (!busy && !last && !camera) inputRef.current?.focus();
  }, [busy, last, camera]);

  const lastId = last?.id;
  useEffect(() => {
    if (!lastId || !last) return;
    signalOutcome(last.outcome, prefs);
    // Anything that is not a clean bind is reported once, when it happens: the
    // result card is about to be replaced by the next parcel and the agent
    // needs it back at the end of the batch.
    if (last.outcome !== "bound") {
      onUnresolved(last.message ?? last.outcome);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

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

  // Enter on the result: the next parcel, or another try.
  useEffect(() => {
    if (!last) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      // A focused button already answers Enter with its own click; acting here
      // too would advance twice and skip a parcel.
      if ((e.target as HTMLElement | null)?.closest?.("button,input,a")) return;
      e.preventDefault();
      if (last.outcome === "bound" || last.outcome === "bind_unverified") onNext();
      else clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [last, onNext, clear]);

  if (busy) {
    return (
      <div role="status" className="card run-card run-busy">
        <span className="spin" aria-hidden="true" />
        <b>{isLy ? ts("binding") : ts("bindingTn")}</b>
      </div>
    );
  }

  if (last) {
    const outcome = last.outcome;
    const tone = TONE[outcome];
    const moved = outcome === "bound" || outcome === "bind_unverified";
    const heading: Record<ScanOutcome, string> = {
      bound: tb("bound", { name: row.customer_name }),
      refused_here: ts("errRefused"),
      refused_darb: ts("errCarrier"),
      bound_not_committed: ts("errBoundNotCommitted"),
      bind_unverified: ts("errBindUnverified"),
    };

    return (
      <>
        <div data-testid="wh-run-result" data-outcome={outcome} className={`card run-card outc ${tone}`}>
          <span className="res-ic"><Ic n={tone === "ok" ? "check" : tone === "warn" ? "alert" : "x"} /></span>
          <b dir="ltr" className="res-code num">{last.code}</b>
          <p className="res-h">{heading[outcome]}</p>
          {moved ? (
            <p className="res-stock num">{t("stockMove", { from: last.from ?? "—", to: last.to ?? "—" })}</p>
          ) : (
            <p className="res-why" dir="auto">{last.message}</p>
          )}
          {outcome === "bound_not_committed" ? <p className="res-why">{tb("notCommittedHint")}</p> : null}
          {outcome === "bind_unverified" ? (
            <p data-testid="wh-run-unverified" className="res-why">{tb("unverifiedHint", { ref: last.carrierRef ?? "—" })}</p>
          ) : null}
          {committed && !held ? (
            <span className="auto" aria-hidden="true"><i style={{ animationDuration: `${ADVANCE_MS}ms` }} /></span>
          ) : null}
        </div>

        <div className="run-acts">
          {moved ? (
            <>
              {committed && !held ? (
                <button type="button" className="btn2 xl" onClick={() => setHeld(true)}>
                  {t("stay")}
                </button>
              ) : null}
              <button type="button" className="btn xl" onClick={onNext}>
                {t("nextNow")}
                <Ic n="arrowr" className="flip" />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn2 xl" onClick={onSkip}>
                {t("skip")}
              </button>
              <button type="button" className="btn xl" onClick={clear}>
                <Ic n="refresh" />
                {tb("retry")}
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  const send = () => {
    const code = value;
    setValue("");
    onScan(code);
  };

  return (
    <div data-testid="wh-run-scanner" className="run-scan">
      {camera ? (
        <div className="cam run-cam">
          <QrScanner active={camera} frameColor={hex} onScan={onScan} onClose={() => setCamera(false)} />
        </div>
      ) : (
        <div className="card run-zone" style={hex ? ({ "--c": hex } as React.CSSProperties) : undefined}>
          <span className="rz-ic"><Ic n="scan" /></span>
          <b>{t("bindTitle")}</b>
          <small>{isLy ? t("scanReady") : t("scanReadyTn")}</small>
          <span className="beam" aria-hidden="true" />
          <button type="button" data-testid="wh-camera-primary" className="btn2" onClick={() => setCamera(true)}>
            <Ic n="camera" />
            {ts("camera")}
          </button>
        </div>
      )}

      <div className="card run-type">
        <span className="eb2">{isLy ? tb("typeNumber") : tb("typeQr")}</span>
        <div className="rt-row">
          <label className="scanin xl">
            <Ic n="scan" />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // The document-level gun handler sees the same keys; stop here so one Enter is one scan.
                  e.stopPropagation();
                  send();
                }
              }}
              inputMode={isLy ? "numeric" : "text"}
              pattern={isLy ? "[0-9]*" : undefined}
              autoComplete="off"
              dir="ltr"
              aria-label={ts("stickerNumber")}
              placeholder={isLy ? "1213123" : ts("placeholderTn")}
            />
          </label>
          <button type="button" className="btn xl" onClick={send} disabled={!value.trim()}>
            <Ic n="check" />
            {tb("bind")}
          </button>
        </div>
      </div>

      <div className="run-acts one">
        <button type="button" className="btn2 xl" onClick={onSkip}>
          <Ic n="right" className="flip" />
          {t("skip")}
        </button>
      </div>
    </div>
  );
}
