"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useScanOut } from "@/components/warehouse/bench/useScanOut";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { RunRow } from "@/lib/warehouse/scan-buckets";
import { RunParcel } from "./RunParcel";
import { RunViewfinder } from "./RunViewfinder";
import { NextParcel, OutcomeCard, StockChip } from "./RunOutcome";
import { RING_MS } from "./motion";
import { BTN_GHOST, BTN_PRI, BTN_SEC, MONO, XL } from "./ui";

/**
 * The parcel in hand, the camera, and what the scan turned into
 * (`R.run`, `R.bound`, `R.wrongsite` in the v3 prototype).
 *
 * Mounted once per parcel (the run keys it by order id), so an outcome can
 * never be read against the wrong box.
 *
 * The run's point is that the agent never has to decide what happens next: a
 * clean bind shows the next parcel of the same roll and moves to it on its own
 * in 1.4 s. The amber outcomes deliberately do NOT advance, because each needs
 * a human to read it:
 *
 *   bind_unverified      Darb kept a different number, or dropped ours. The
 *                        parcel is live under a reference we do not hold.
 *   bound_not_committed  Live at Darb, no stock moved. A manager must know.
 *
 * The hardware gun is wired on the document: the agent's hands are on a parcel
 * and nothing guarantees focus is anywhere useful.
 */

export function RunScanner({
  market,
  row,
  hex,
  colourName,
  position,
  total,
  done,
  next,
  sameRoll,
  onBound,
  onUnresolved,
  onNext,
  onSkip,
  onSetAside,
  onClose,
}: {
  market: "ly" | "tn";
  row: RunRow;
  /** The roll's colour, for the viewfinder; null outside a roll. */
  hex: string | null;
  /** The roll's name, for the instruction; null when the roll is unknown. */
  colourName: string | null;
  /** « k / n » */
  position: number;
  total: number;
  /** Parcels of this batch already handled — the filled dots. */
  done: number;
  /** The parcel that follows a clean bind. */
  next: RunRow | null;
  sameRoll: boolean;
  /** A parcel left the bench: the caller drops it and counts the scan. */
  onBound: () => void;
  /** A parcel that did NOT leave, with the reason shown at the time. */
  onUnresolved: (message: string) => void;
  onNext: () => void;
  /** Put it down; it comes back once at the end of the batch. */
  onSkip: () => void;
  /** It belongs to the other building: out of this batch for good. */
  onSetAside: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("warehouse.run");
  const tb = useTranslations("warehouse.bench");
  const ts = useTranslations("warehouse.scan");
  const isLy = market === "ly";

  const prefs = useMemo(() => readScannerPrefs(), []);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(prefs.cameraFirst);

  const { submit, busy, last, clear } = useScanOut({ market, hand: row, orders: [row], onScanned: onBound });

  const lastId = last?.id;
  useEffect(() => {
    if (!lastId || !last) return;
    signalOutcome(last.outcome, prefs);
    if (last.outcome !== "bound") onUnresolved(last.message ?? last.outcome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const onScan = useCallback((text: string) => void submit(text), [submit]);

  /*
   * The gun, on the document. React flushes a keydown's state synchronously,
   * so once the sticker field has answered its own Enter this listener is
   * already gone (`busy`) before the event reaches the document: one bind,
   * not two.
   */
  useEffect(() => {
    if (busy || last) return;
    const { handler, cleanup } = createScannerInputHandler(onScan);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      cleanup();
    };
  }, [onScan, busy, last]);

  // The server moved stock: the parcel has left, whatever the sticker's fate.
  const moved = !!last && last.to !== undefined;
  const clean = moved && last?.outcome === "bound";
  // Only a clean bind with a parcel to go to advances on its own.
  useEffect(() => {
    if (!clean || !next) return;
    const id = setTimeout(onNext, RING_MS);
    return () => clearTimeout(id);
  }, [clean, next, onNext]);

  const sub = (
    <>
      <bdi>{row.product_name}</bdi>
      {row.customer_city ? (
        <>
          {" · "}
          <bdi>{row.customer_city}</bdi>
        </>
      ) : null}
    </>
  );

  if (last) {
    const outcome = last.outcome;

    // R.wrongsite — what to do, not the error code.
    if (last.errorCode === "WRONG_SITE") {
      return (
        <>
          <OutcomeCard
            tone="bad"
            outcome="wrong_site"
            title={tb("wrongT")}
            body={tb("wrongB", { warehouse: last.warehouseName ?? "—" })}
            code={last.code}
            codeSize={22}
            sub={sub}
          />
          <button type="button" onClick={onSetAside} className={`${BTN_SEC} ${XL} mt-[16px] w-full`}>
            {tb("ok")}
          </button>
        </>
      );
    }

    // R.bound — and its amber twin, when Darb kept another number.
    if (moved) {
      return (
        <>
          <OutcomeCard
            tone={clean ? "ok" : "warn"}
            outcome={outcome}
            title={clean ? t("bound") : ts("errBindUnverified")}
            code={last.code}
            sub={sub}
          >
            <StockChip from={last.from} to={last.to} />
            {outcome === "bind_unverified" ? (
              <p data-testid="wh-run-unverified" className="relative mt-[10px] text-[14px] text-wm-ink">
                {tb("unverifiedHint", { ref: last.carrierRef ?? "—" })}
              </p>
            ) : null}
          </OutcomeCard>
          {next ? (
            <NextParcel
              label={sameRoll ? t("next") : t("nextAny")}
              product={next.product_name}
              quantity={next.quantity}
              imageUrl={next.product_image_url}
              line={
                <>
                  {next.customer_city ? (
                    <>
                      <bdi>{next.customer_city}</bdi>
                      {" · "}
                    </>
                  ) : null}
                  <bdi>{next.customer_name}</bdi>
                </>
              }
              auto={clean}
            />
          ) : (
            <p className="mt-[20px] text-center text-[14px] text-wm-ink-2">{t("lastOne")}</p>
          )}
          <div className="mt-[16px] flex gap-[12px]">
            <button type="button" onClick={onClose} className={`${BTN_SEC} flex-1`}>
              {t("close")}
            </button>
            <button type="button" onClick={onNext} className={`${BTN_PRI} flex-1`}>
              {t("nextBtn")}
            </button>
          </div>
        </>
      );
    }

    // Nothing left: a refusal (here or at Darb), or amber with no stock moved.
    const warn = outcome === "bound_not_committed" || outcome === "bind_unverified";
    const title =
      outcome === "bound_not_committed"
        ? ts("errBoundNotCommitted")
        : outcome === "bind_unverified"
          ? ts("errBindUnverified")
          : outcome === "refused_darb"
            ? ts("errCarrier")
            : ts("errRefused");
    return (
      <>
        <OutcomeCard
          tone={warn ? "warn" : "bad"}
          outcome={outcome}
          title={title}
          body={outcome === "bound_not_committed" ? tb("notCommittedHint") : last.message}
          code={last.code}
          codeSize={22}
          sub={sub}
        />
        <button type="button" onClick={clear} className={`${BTN_PRI} mt-[16px] w-full`}>
          {tb("retry")}
        </button>
        <button type="button" onClick={onSkip} className={`${BTN_GHOST} mt-[6px] w-full`}>
          {t("skip")}
        </button>
      </>
    );
  }

  // R.run — the parcel in hand, with the scanner already under it.
  const dots = Math.max(0, Math.min(total, 40));
  const filled = total > 0 ? Math.round((done / total) * dots) : 0;
  const hint = !isLy ? t("stickHintTn") : colourName ? t("stickHint", { colour: colourName }) : tb("unknownZoneHint");
  const send = () => {
    const code = value;
    setValue("");
    onScan(code);
  };

  return (
    <div data-testid="wh-run-scanner">
      <div className="mb-[6px] flex items-center gap-[12px] text-[12.5px] text-wm-ink-2">
        <span className="flex-1">{t("inHand")}</span>
        <span
          data-testid="wh-run-progress"
          dir="ltr"
          aria-label={t("progressLabel", { done: position, total })}
          className="tabular-nums"
        >
          <b className="text-wm-ink">{position}</b> / {total}
        </span>
      </div>
      <div aria-hidden="true" className="mb-[14px] mt-[2px] flex gap-[4px]">
        {Array.from({ length: dots }, (_, i) => (
          <i
            key={i}
            data-testid="wh-run-dot"
            className={`h-[4px] flex-1 rounded-[2px] ${i < filled ? "bg-job" : "bg-line"}`}
          />
        ))}
      </div>

      <RunParcel row={row} />

      <p className="mt-[12px] text-[12.5px] text-wm-ink-2">{hint}</p>

      <RunViewfinder
        hex={isLy ? hex : null}
        camera={camera}
        onToggle={() => setCamera((c) => !c)}
        onScan={onScan}
        busyLabel={busy ? (isLy ? ts("binding") : ts("bindingTn")) : null}
      />

      <div className="mt-[12px] flex gap-[8px]">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          inputMode={isLy ? "numeric" : "text"}
          pattern={isLy ? "[0-9]*" : undefined}
          autoComplete="off"
          dir="ltr"
          disabled={busy}
          aria-label={isLy ? tb("typeNumber") : tb("typeQr")}
          placeholder={isLy ? tb("typeNumber") : tb("typeQr")}
          className={`h-[48px] min-w-0 flex-1 rounded-[12px] border border-[var(--border-strong)] bg-white px-[14px] text-start text-[16px] text-wm-ink outline-none placeholder:text-wm-ink-3 focus:border-brand ${MONO}`}
        />
        <button type="button" onClick={send} disabled={busy} className={BTN_SEC}>
          {tb("bind")}
        </button>
      </div>
      <button type="button" onClick={onSkip} className={`${BTN_GHOST} mt-[6px] w-full`}>
        {t("skip")}
      </button>
    </div>
  );
}
