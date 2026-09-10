"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, RotateCcw, Undo2, XCircle } from "lucide-react";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";
import { useScannedActions, canUnscan } from "@/components/warehouse/bench/useScannedActions";
import { useScannedView } from "@/components/warehouse/bench/useScannedView";
import { ScannedFilters } from "@/components/warehouse/bench/ScannedFilters";

/**
 * The scanned parcels, at a desk.
 *
 * Same data, same three actions and now the same FILTERS as the phone list —
 * they share `useScannedActions` and `useScannedView` — but laid out for
 * someone scanning a column rather than holding a box. The manager's question
 * is "which of these is wrong", so the bind state is a column, not a detail,
 * and the parcels the carrier is not holding our number for sort to the top.
 *
 * That sort used to live here alone, so the same hundred rows read in one order
 * at a desk and another on a phone. It now lives in `sortScanned`.
 */

const TONE: Record<string, string> = {
  confirmed: "border-wh-ok-edge bg-wh-ok-bg text-wh-ok",
  restickered: "border-wh-warn-edge bg-wh-warn-bg text-wh-warn",
  not_registered: "border-wh-bad-edge bg-wh-bad-bg text-wh-bad",
  unchecked: "border-wh-border bg-wh-surface text-wh-ink-2",
};

export function ScannedTable({ warehouseId, isLy = true }: { warehouseId?: string | null; isLy?: boolean }) {
  const t = useTranslations("warehouse.scanned");
  const tf = useTranslations("warehouse.scanned.filters");
  const tStatus = useTranslations("orders.statuses");
  const locale = useLocale();
  const { data, error, isLoading, mutate, busyId, flash, recheck, rebind, unscan } =
    useScannedActions(warehouseId);
  const view = useScannedView(data?.orders ?? []);
  const [rebindFor, setRebindFor] = useState<string | null>(null);
  const [sticker, setSticker] = useState("");

  if (error) {
    return (
      <div className="rounded-[8px] border border-wh-bad-edge bg-wh-bad-bg p-5 text-center">
        <p className="text-[14px] font-semibold text-wh-bad">{t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => void mutate()}
          className="mt-2 rounded-[6px] bg-brand px-4 py-2 text-[13px] font-semibold text-white"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (isLoading && !data) {
    return <p role="status" className="py-8 text-center text-[14px] text-wh-ink-2">{t("loading")}</p>;
  }

  // Anything the carrier is not holding our number for comes first: it is the
  // only reason a manager opens this list. `sortScanned` decides, for both
  // surfaces at once.
  const rows = view.shown;
  const loaded = data?.orders ?? [];

  return (
    <div>
      <div className="mb-3">
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
          className={`mb-3 rounded-[6px] border px-3 py-2 text-[13px] ${
            flash.tone === "ok"
              ? "border-wh-ok-edge bg-wh-ok-bg text-wh-ok"
              : "border-wh-bad-edge bg-wh-bad-bg text-wh-bad"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      {loaded.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-wh-ink-2">{t("empty")}</p>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[14px] text-wh-ink-2">{tf("noMatch")}</p>
          <button
            type="button"
            onClick={view.clear}
            className="mt-2 inline-flex h-9 items-center rounded-[6px] border border-wh-border px-3 text-[13px] font-semibold text-wh-ink-1"
          >
            {tf("clear")}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[8px] border border-wh-border bg-wh-surface">
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr className="border-b border-wh-border text-start">
                <Th>{t("colParcel")}</Th>
                <Th>{t("colSticker")}</Th>
                <Th>{t("colBind")}</Th>
                <Th>{t("colStatus")}</Th>
                <Th>{t("colScanned")}</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = row.sticker_bind_state ?? "unchecked";
                const Icon =
                  state === "confirmed" ? Check : state === "not_registered" ? XCircle : AlertTriangle;
                return (
                  <tr key={row.id} className="border-b border-wh-border last:border-0 align-top">
                    <td className="px-4 py-3">
                      <Link
                        href={`/${locale}/orders/${row.id}`}
                        className="block text-[14px] font-semibold text-wh-ink-1 underline-offset-2 hover:underline"
                      >
                        <bdi>{row.customer_name}</bdi>
                      </Link>
                      <span className="block text-[12.5px] text-wh-ink-2">
                        <bdi>{row.product_name}</bdi> × {row.quantity}
                        {row.customer_city ? (
                          <>
                            {" · "}
                            <bdi>{row.customer_city}</bdi>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span dir="ltr" className="text-[14px] font-semibold tabular-nums text-wh-ink-1">
                        {row.carrier_sticker_ref ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        data-testid="wh-bind-state"
                        data-state={state}
                        className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[12.5px] font-medium ${TONE[state]}`}
                      >
                        {row.sticker_bind_state ? <Icon size={12} aria-hidden="true" /> : null}
                        {state === "restickered" && row.carrier_reference_actual ? (
                          <>
                            {t("bind.restickered")}
                            <b dir="ltr" className="tabular-nums">{row.carrier_reference_actual}</b>
                          </>
                        ) : (
                          t(`bind.${state}`)
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-wh-ink-2">{tStatus(row.status)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-wh-ink-3">
                      {row.scanned_at
                        ? t("scannedBy", {
                            who: row.scanned_by_name ?? "—",
                            when: new Date(row.scanned_at).toLocaleDateString(),
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {rebindFor === row.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={sticker}
                            onChange={(e) => setSticker(e.target.value)}
                            inputMode="numeric"
                            dir="ltr"
                            autoFocus
                            aria-label={t("newSticker")}
                            className="h-9 w-[130px] rounded-[6px] border border-wh-border px-2 text-[13px] tabular-nums"
                          />
                          <button
                            type="button"
                            disabled={busyId === row.id || !sticker.trim()}
                            onClick={() => {
                              void rebind(row, sticker.trim());
                              setRebindFor(null);
                              setSticker("");
                            }}
                            className="h-9 rounded-[6px] bg-brand px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"
                          >
                            {t("sendSticker")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRebindFor(null)}
                            className="h-9 rounded-[6px] px-2 text-[12.5px] text-wh-ink-2"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RowButton disabled={busyId === row.id} onClick={() => void recheck(row)}>
                            <RotateCcw size={12} aria-hidden="true" />
                            {t("recheck")}
                          </RowButton>
                          <RowButton disabled={busyId === row.id} onClick={() => setRebindFor(row.id)}>
                            {t("rebind")}
                          </RowButton>
                          {canUnscan(row) ? (
                            <RowButton
                              danger
                              disabled={busyId === row.id}
                              onClick={() => void unscan(row)}
                              testId="wh-unscan"
                            >
                              <Undo2 size={12} aria-hidden="true" />
                              {t("unscan")}
                            </RowButton>
                          ) : (
                            <span className="text-[12px] text-wh-ink-3">{t("unscanClosed")}</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-start text-[12px] font-medium uppercase tracking-[0.05em] text-wh-ink-3">
      {children}
    </th>
  );
}

function RowButton({
  children,
  onClick,
  disabled,
  danger,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-1.5 rounded-[6px] border px-2.5 text-[12.5px] font-medium disabled:opacity-40 ${
        danger ? "border-wh-bad-edge text-wh-bad" : "border-wh-border text-wh-ink-1"
      }`}
    >
      {children}
    </button>
  );
}
