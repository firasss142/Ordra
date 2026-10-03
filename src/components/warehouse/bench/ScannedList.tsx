"use client";

import { useTranslations } from "next-intl";
import { ScannedCard } from "./ScannedCard";
import { ScannedFilters } from "./ScannedFilters";
import { useScannedActions } from "./useScannedActions";
import { useScannedView } from "./useScannedView";

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
 *
 * The filters and the ORDER come from `useScannedView`, shared with the desk
 * table: the same hundred rows used to read in two different orders depending
 * on which device you were holding, and neither could be narrowed at all.
 */

export function ScannedList({ isLy }: { isLy: boolean }) {
  const t = useTranslations("warehouse.scanned");
  const tf = useTranslations("warehouse.scanned.filters");
  const { data, error, isLoading, mutate, busyId, flash, recheck, rebind, unscan } =
    useScannedActions();
  const rows = data?.orders ?? [];
  const view = useScannedView(rows);

  if (error) {
    return (
      <div className="rounded-[16px] border border-wh-bad-edge bg-wh-bad-bg p-[16px] text-center">
        <p className="text-[15px] font-semibold text-wh-bad">{t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => void mutate()}
          className="mt-[8px] inline-flex min-h-[44px] items-center rounded-[12px] bg-brand px-[16px] text-[14px] font-bold text-white"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (isLoading && !data) {
    return <p role="status" className="py-[24px] text-center text-[14px] text-wm-ink-2">{t("loading")}</p>;
  }

  return (
    <div>
      <div>
        <ScannedFilters
          isLy={isLy}
          filter={view.filter}
          facets={view.facets}
          active={view.active}
          patch={view.patch}
          clear={view.clear}
        />
      </div>

      {flash ? (
        <p
          role="status"
          data-testid="wh-scanned-flash"
          className={`mt-[10px] rounded-[12px] border px-[12px] py-[8px] text-[13.5px] ${
            flash.tone === "ok"
              ? "border-wh-ok-edge bg-wh-ok-bg text-wh-ok"
              : "border-wh-bad-edge bg-wh-bad-bg text-wh-bad"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-[24px] text-center text-[14px] text-wm-ink-2">{t("empty")}</p>
      ) : view.shown.length === 0 ? (
        // Not the same fact as an empty list: the bench has parcels, these
        // filters just hide them. Say which, and offer the way back.
        <div className="py-[24px] text-center">
          <p className="text-[14px] text-wm-ink-2">{tf("noMatch")}</p>
          <button
            type="button"
            onClick={view.clear}
            className="mt-[8px] inline-flex min-h-[44px] items-center rounded-[12px] border border-[var(--border-strong)] px-[16px] text-[14px] font-semibold text-wm-ink"
          >
            {tf("clear")}
          </button>
        </div>
      ) : (
        <div className="mt-[12px] flex flex-col gap-[8px]">
          {view.shown.map((row) => (
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
          {/* The counts above describe the page that was loaded, not the whole
              history. Saying so beats a filter that silently misses rows. */}
          {data?.nextCursor ? (
            <p className="pt-[4px] text-center text-[12.5px] text-wm-ink-3">
              {tf("partial", { n: rows.length })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

