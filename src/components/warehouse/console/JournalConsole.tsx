"use client";

import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";
import type { WarehouseHistoryKind } from "@/lib/warehouse/list-filters";
import type { HistoryCounts } from "@/app/api/warehouse/history/counts/route";
import type { WarehouseStockResponse } from "@/app/api/warehouse/stock/route";
import { jsonFetcher } from "@/lib/fetchers";
import { Chip, Num, eventKey, signed, whenLabel } from "@/components/warehouse/product/stock-bits";

/**
 * Stock › Mouvements — the append-only ledger, as `C.journal` of
 * prototypes/entrepot-day-loop-manager-v3.html draws it: « Filtré : » with
 * the product, the family chips with their counts, then one table — Quand,
 * Événement, Produit, Qui, Δ → solde. Px sizes, Ordra tokens.
 *
 * What it no longer carries, and why: the three KPI cards (today's events,
 * anomalies, traceability), the day bands, the search box, the copy button
 * and the client-side CSV export are not in the prototype, and none of them
 * guarded anything — the anomaly tags were a hint computed on the visible page
 * only. The server CSV (/api/warehouse/history/export.csv) still exists for
 * whoever needs the raw ledger.
 *
 * FAMILIES. A chip stays visible whatever its count: « Retours 0 » is a fact,
 * and a chip that appears and disappears makes the row jump. « Remises » and
 * « Impressions » have a source (order_history, label_prints) but no product,
 * so they show only when no product narrows the view. « Transferts » has no
 * source in the data model and is absent rather than permanently empty.
 *
 * The balance after each row is the product's MARKET total on every ledger row
 * (variants and buildings never change it), which is why this ledger is not
 * narrowed by building: a Benghazi-only view would show a balance that jumps
 * with every Tripoli movement in between. The building is named in « Qui ».
 */

type Family = Extract<WarehouseHistoryKind, keyof HistoryCounts>;

const LEDGER_FAMILIES: Family[] = ["all", "scan", "return", "reception", "count", "adjust"];
const PRODUCTLESS: Family[] = ["handover", "print"];

const FAMILY_LABEL: Record<Family, string> = {
  all: "filterAll",
  scan: "filterScan",
  return: "filterReturn",
  reception: "filterReception",
  count: "filterCount",
  adjust: "filterAdjust",
  handover: "filterHandover",
  print: "filterPrint",
};

const PAGE = 100;

const TH =
  "sticky top-0 whitespace-nowrap border-b border-line-subtle bg-wh-surface px-[14px] py-[11px] text-start text-[11px] font-semibold uppercase tracking-[0.05em] text-wh-ink-2 rtl:text-[12px] rtl:normal-case rtl:tracking-normal";
const TD = "border-b border-line-subtle px-[14px] py-[12px] align-middle group-last:border-b-0";

export function JournalConsole({
  productId = null,
  kind,
  onKindChange,
  onClearProduct,
}: {
  locale: string;
  /** One product's movements — « Mouvements » on a stock row or a product page. */
  productId?: string | null;
  /** The family in view, from the address (`?kind=`). */
  kind: WarehouseHistoryKind;
  onKindChange: (kind: WarehouseHistoryKind) => void;
  onClearProduct?: () => void;
}) {
  const t = useTranslations("warehouse.journal");
  const intlLocale = useLocale();
  const productParam = productId ? `&product_id=${encodeURIComponent(productId)}` : "";

  const { data } = useSWR<{ rows: WarehouseHistoryRow[]; nextCursor: string | null }>(
    `/api/warehouse/history?limit=${PAGE}&kind=${kind}${productParam}`,
    jsonFetcher,
    { revalidateOnFocus: true },
  );
  const { data: counts } = useSWR<HistoryCounts>(
    `/api/warehouse/history/counts${productId ? `?product_id=${encodeURIComponent(productId)}` : ""}`,
    jsonFetcher,
  );
  // The product's NAME for the « Filtré : » chip, even before it has moved:
  // the stock list is the one place every product of the market is named (and
  // it is already in cache when the reader came from Stock).
  const { data: stock } = useSWR<WarehouseStockResponse>(productId ? "/api/warehouse/stock" : null, jsonFetcher);

  const rows = data?.rows ?? [];
  const productName = productId
    ? (stock?.rows.find((r) => r.product_id === productId)?.name ??
      rows.find((r) => r.product_id === productId)?.product_name ??
      null)
    : null;
  const families = productId ? LEDGER_FAMILIES : [...LEDGER_FAMILIES, ...PRODUCTLESS];

  return (
    <div className="text-[14px] leading-[1.5] text-wh-ink-1">
      {productId ? (
        <div data-testid="wh-journal-product" className="mb-[12px] flex items-center gap-[12px]">
          <span className="text-[12.5px] text-wh-ink-2">{t("filteredBy")}</span>
          <Chip tone="info" dense>
            <bdi>{productName ?? "…"}</bdi>
            {onClearProduct ? (
              <button
                type="button"
                onClick={onClearProduct}
                aria-label={t("clearFilter")}
                className="inline-grid place-items-center"
              >
                <X size={13} strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : null}
          </Chip>
        </div>
      ) : null}

      <div role="group" aria-label={t("families")} className="mb-[14px] flex flex-wrap gap-[6px]">
        {families.map((f) => {
          const on = kind === f;
          return (
            <button
              key={f}
              type="button"
              data-testid={`wh-filter-${f}`}
              aria-pressed={on}
              onClick={() => onKindChange(f)}
              className={`rounded-full border px-[12px] py-[6px] text-[13px] font-semibold ${
                on ? "border-wh-ink-1 bg-wh-ink-1 text-white" : "border-line bg-wh-surface text-wh-ink-2 hover:text-wh-ink-1"
              }`}
            >
              {t(FAMILY_LABEL[f])}
              <span className="ms-[5px] text-[11.5px] opacity-75">
                <Num>{counts?.[f] ?? "…"}</Num>
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>{t("colWhen")}</th>
                <th className={TH}>{t("colEvent")}</th>
                <th className={`${TH} min-w-[260px]`}>{t("colProduct")}</th>
                <th className={TH}>{t("colWho")}</th>
                <th className={`${TH} text-end`}>{t("colDelta")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-[14px] py-[32px] text-center text-[13px] text-wh-ink-2">
                    {data ? t("empty") : "…"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} data-testid={`wh-row-${r.id}`} className="group hover:bg-wh-surface-2">
                    <td className={`${TD} whitespace-nowrap text-wh-ink-2`}>{whenLabel(r.at, intlLocale)}</td>
                    <td className={TD}>
                      <Chip tone="mute" dense>{t(`event.${eventKey(r)}`)}</Chip>
                    </td>
                    <td className={`${TD} font-semibold`}>
                      {r.product_name ? <bdi>{r.product_name}</bdi> : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <bdi>{r.actor?.full_name ?? "—"}</bdi>
                      {r.warehouse_name ? (
                        <>
                          {" · "}
                          <span className="text-wh-ink-2"><bdi>{r.warehouse_name}</bdi></span>
                        </>
                      ) : null}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-end`}>
                      {r.qty_change === null ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <>
                          <b className="font-bold"><Num>{signed(r.qty_change)}</Num></b>{" "}
                          <span className="text-wh-ink-2">
                            <Num>→ {r.balance_after ?? "—"}</Num>
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
