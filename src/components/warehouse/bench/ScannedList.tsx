"use client";

import { useTranslations } from "next-intl";
import { ScannedCard } from "./ScannedCard";
import { useScannedActions } from "./useScannedActions";

/**
 * The parcels already scanned out — and what the carrier did with them.
 *
 * This list is the answer to "where did my parcel go after I scanned it". There
 * was none: the row left the bench and the only trace was a ledger line nobody
 * on the floor could read. Meanwhile eight of twenty parcels scanned on
 * 2026-09-08 were carrying a number Darb was not holding.
 *
 * Failures are rendered, never swallowed. A silent empty list here would be
 * indistinguishable from a clear bench, which is the exact defect that left the
 * returns screen showing a placeholder for weeks.
 */

export function ScannedList({ isLy }: { isLy: boolean }) {
  const t = useTranslations("warehouse.scanned");
  const { data, error, isLoading, mutate, busyId, flash, recheck, rebind, unscan } =
    useScannedActions();

  if (error) {
    return (
      <div className="mt-4 rounded-[14px] border border-wh-bad-edge bg-wh-bad-bg p-4 text-center">
        <p className="text-[15px] font-semibold text-wh-bad">{t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => void mutate()}
          className="mt-2 inline-flex min-h-[44px] items-center rounded-[12px] bg-wm-accent px-4 text-[14px] font-bold text-white"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (isLoading && !data) {
    return <p role="status" className="py-6 text-center text-[14px] text-wm-ink-2">{t("loading")}</p>;
  }

  const rows = data?.orders ?? [];

  return (
    <div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip label={t("awaitingPickup", { n: data?.awaitingPickup ?? 0 })} />
        <Chip label={t("atCarrier", { n: data?.atCarrier ?? 0 })} />
        {(data?.unconfirmed ?? 0) > 0 ? (
          <Chip label={t("unconfirmed", { n: data?.unconfirmed ?? 0 })} tone="warn" />
        ) : null}
      </div>

      {flash ? (
        <p
          role="status"
          data-testid="wh-scanned-flash"
          className={`mt-2.5 rounded-[12px] border px-3 py-2 text-[13.5px] ${
            flash.tone === "ok"
              ? "border-wh-ok-edge bg-wh-ok-bg text-wh-ok"
              : "border-wh-bad-edge bg-wh-bad-bg text-wh-bad"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-wm-ink-2">{t("empty")}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <ScannedCard
              key={row.id}
              row={row}
              isLy={isLy}
              busy={busyId === row.id}
              onRecheck={recheck}
              onRebind={rebind}
              onUnscan={unscan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone?: "warn" }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-3 py-1 text-[13px] font-semibold ${
        tone === "warn"
          ? "border-wh-warn-edge bg-wh-warn-bg text-wh-warn"
          : "border-wm-card-edge bg-wm-card text-wm-ink-2"
      }`}
    >
      {label}
    </span>
  );
}
