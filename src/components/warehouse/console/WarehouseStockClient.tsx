"use client";

import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Boxes, Tally5, TriangleAlert } from "lucide-react";
import type { WarehouseStockResponse, WarehouseStockRow, StockWarehouse } from "@/app/api/warehouse/stock/route";
import { jsonFetcher } from "@/lib/fetchers";
import { StockCard } from "./StockCard";
import {
  Chip, Num, Sparkline, Thumb, countMinutes, lastCountedAt, neverCounted, shortDate,
} from "@/components/warehouse/product/stock-bits";

/**
 * Stock › Niveaux — what the market holds, product by product.
 *
 * Two drawings of one payload (/api/warehouse/stock), both straight from the
 * approved v3 prototypes, in px (Ordra's root font is 14px):
 *
 *  - `agent` — the phone, `R.stock` of entrepot-day-loop-agent-v3.html: the
 *    building and the day, the title, the truth said FIRST while nothing has
 *    been counted, then one card of product rows. No tabs, no search, no
 *    filters, no sort: seven products fit on a screen.
 *  - `desk` — `C.stock` of entrepot-day-loop-manager-v3.html: one line of
 *    truth with the way to fix it, then one table — a column per building,
 *    the unallocated stock, the last count, fourteen days of line. No search,
 *    no filter chips, no KPI tiles.
 *
 * « Jamais compté » is judged at the building in view — the agent's own, or
 * the one the desk's top bar chose — because a count is per building
 * (`record_stock_count` poses a SITE's value): Tripoli having counted says
 * nothing about Benghazi's shelf.
 *
 * Wears the Recevoir/Stock hue (`job-receive`): the sparklines draw in it.
 */

const STOCK_KEY = "/api/warehouse/stock";

export function WarehouseStockClient({
  locale,
  variant,
  siteId,
  eyebrow = null,
}: {
  locale: string;
  variant: "agent" | "desk";
  /** The building in view: the agent's own, or the desk's `?warehouse_id=`. Null = every building. */
  siteId: string | null;
  /** « Benghazi · jeudi 2 octobre » — the phone's line above the title. */
  eyebrow?: string | null;
}) {
  const t = useTranslations("warehouse.stock");
  const { data, error, isLoading } = useSWR<WarehouseStockResponse>(STOCK_KEY, jsonFetcher, {
    revalidateOnFocus: true,
  });
  const rows = data?.rows ?? [];
  const warehouses = data?.warehouses ?? [];
  const uncounted = rows.filter((r) => neverCounted(r, siteId, warehouses));
  // « Aucun produit n'a encore été compté » is a claim about EVERY product: it
  // is said only while it is true.
  const nothingCounted = rows.length > 0 && uncounted.length === rows.length;
  const countBase = `/${locale}/warehouse/count`;

  const status = error ? (
    <p className="px-[16px] py-[32px] text-center text-[13px] text-status-critical">{t("loadError")}</p>
  ) : isLoading ? (
    <div className="space-y-[8px] p-[14px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[44px] rounded-[8px] bg-wh-sunken" />
      ))}
    </div>
  ) : rows.length === 0 ? (
    <p className="px-[16px] py-[32px] text-center text-[13px] text-wh-ink-2">{t("empty")}</p>
  ) : null;

  if (variant === "agent") {
    return (
      <div className="job-receive px-[16px] pb-[24px] pt-[18px] text-[14px] leading-[1.5] text-wh-ink-1">
        <header className="mb-[18px]">
          {eyebrow ? (
            <p className="text-[12.5px] font-semibold text-wh-ink-2" dir="auto">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em]">{t("title")}</h1>
        </header>

        {nothingCounted ? (
          <div
            data-testid="wh-stock-truth"
            className="mb-[14px] flex items-start gap-[12px] rounded-[12px] border border-wh-warn-edge bg-wh-warn-bg p-[14px] text-wh-warn"
          >
            <TriangleAlert size={20} strokeWidth={2} className="mt-[2px] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-bold">{t("truthTitle")}</p>
              <p className="mt-[2px] text-[12.5px]">{t("truthBody")}</p>
              <Link
                href={countBase}
                className="mt-[10px] inline-flex min-h-[40px] items-center justify-center gap-[8px] whitespace-nowrap rounded-[12px] bg-wh-ink-1 px-[18px] text-[13.5px] font-bold text-white no-underline"
              >
                {t("truthStart", { n: uncounted.length, min: countMinutes(uncounted.length) })}
              </Link>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface">
          {status ?? rows.map((r) => <StockCard key={r.product_id} row={r} locale={locale} />)}
        </div>
      </div>
    );
  }

  return (
    <>
      {nothingCounted ? (
        <div
          data-testid="wh-stock-truth"
          className="mb-[16px] flex items-center gap-[14px] rounded-[16px] border border-wh-warn-edge bg-wh-warn-bg px-[18px] py-[14px] text-wh-warn"
        >
          <TriangleAlert size={20} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <b className="font-bold">{t("deskTruthTitle")}</b>{" "}
            {/* The building columns are only promised where they exist. */}
            <span className="text-[12.5px]">{warehouses.length > 1 ? t("deskTruthBody") : t("truthBody")}</span>
          </p>
          <Link
            href={siteId ? `${countBase}?warehouse_id=${siteId}` : countBase}
            className="inline-flex h-[36px] shrink-0 items-center justify-center gap-[8px] whitespace-nowrap rounded-[12px] bg-wh-ink-1 px-[14px] text-[13.5px] font-semibold text-white no-underline"
          >
            <Tally5 size={16} strokeWidth={2} aria-hidden="true" />
            {t("deskTruthStart")}
          </Link>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface">
        {status ?? (
          <div className="overflow-x-auto">
            <StockTable rows={rows} warehouses={warehouses} siteId={siteId} locale={locale} />
          </div>
        )}
      </div>
    </>
  );
}

/** The prototype's `th`: 11px uppercase, .05em — no capitals or tracking in Arabic. */
const TH =
  "sticky top-0 whitespace-nowrap border-b border-line-subtle bg-wh-surface px-[14px] py-[11px] text-start text-[11px] font-semibold uppercase tracking-[0.05em] text-wh-ink-2 rtl:text-[12px] rtl:normal-case rtl:tracking-normal";
const TD = "border-b border-line-subtle px-[14px] py-[12px] align-middle group-last:border-b-0";

function StockTable({
  rows,
  warehouses,
  siteId,
  locale,
}: {
  rows: WarehouseStockRow[];
  warehouses: StockWarehouse[];
  siteId: string | null;
  locale: string;
}) {
  const t = useTranslations("warehouse.stock");
  const intlLocale = useLocale();
  const site = siteId ? `&warehouse_id=${siteId}` : "";
  // One building is not a breakdown: Tunisia gets no building column and no
  // « Non ventilé », which would only repeat the register.
  const split = warehouses.length > 1;

  return (
    <table className="w-full border-collapse text-[14px]">
      <thead>
        <tr>
          <th className={`${TH} min-w-[260px]`}>{t("colProduct")}</th>
          <th className={`${TH} text-end`}>{t("colRegister")}</th>
          <th className={`${TH} text-end`}>{t("colEngaged")}</th>
          <th className={`${TH} text-end`}>{t("colFree")}</th>
          {split
            ? warehouses.map((w) => (
                <th key={w.id} className={`${TH} text-end`}>
                  <bdi>{w.name}</bdi>
                </th>
              ))
            : null}
          {split ? <th className={`${TH} text-end`}>{t("colUnallocated")}</th> : null}
          <th className={TH}>{t("colLastCount")}</th>
          <th className={TH}>{t("colDays14")}</th>
          <th className={`${TH} text-end`} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const counted = lastCountedAt(r, siteId, warehouses);
          return (
            <tr key={r.product_id} data-testid={`wh-stock-row-${r.product_id}`} className="group hover:bg-wh-surface-2">
              <td className={TD}>
                <Link
                  href={`/${locale}/warehouse/stock/${r.product_id}`}
                  className="flex items-center gap-[12px] text-start text-wh-ink-1 no-underline"
                >
                  <Thumb src={r.image_url} size={34} radius={9} icon={<Boxes size={16} strokeWidth={2} />} />
                  <span className="min-w-0">
                    <span className="block font-semibold" dir="auto">{r.name}</span>
                    {r.sku ? (
                      <span className="block font-mono text-[12.5px] text-wh-ink-2" dir="ltr">{r.sku}</span>
                    ) : null}
                  </span>
                </Link>
              </td>
              <td className={`${TD} text-end`}><Num>{r.current_stock}</Num></td>
              <td className={`${TD} text-end ${r.engaged ? "" : "text-ink-muted"}`}>
                {r.engaged ? <Num>{r.engaged}</Num> : "—"}
              </td>
              <td className={`${TD} text-end`}>
                <b className={`text-[15px] font-bold ${r.free < 0 ? "text-status-critical" : ""}`}>
                  <Num>{r.free}</Num>
                </b>
              </td>
              {split
                ? warehouses.map((w) => {
                    // A building with no row holds no ventilated share: « — »,
                    // never a 0 that would read as an empty shelf.
                    const line = r.sites.find((s) => s.warehouse_id === w.id);
                    return (
                      <td key={w.id} className={`${TD} text-end ${line ? "" : "text-ink-muted"}`}>
                        {line ? <Num>{line.current_stock}</Num> : "—"}
                      </td>
                    );
                  })
                : null}
              {split ? (
                <td className={`${TD} text-end text-wh-ink-2`}><Num>{r.unallocated}</Num></td>
              ) : null}
              <td className={TD}>
                {counted ? (
                  <span className="whitespace-nowrap text-[12.5px] text-wh-ink-2">{shortDate(counted, intlLocale)}</span>
                ) : (
                  <Chip tone="warn" dense>{t("never")}</Chip>
                )}
              </td>
              <td className={TD}>
                <Sparkline values={r.series} width={64} />
              </td>
              <td className={`${TD} text-end`}>
                <div className="flex items-center justify-end gap-[6px]">
                  <Link
                    href={`/${locale}/warehouse/stock?tab=journal&product=${r.product_id}${site}`}
                    className="inline-flex h-[30px] items-center whitespace-nowrap rounded-[8px] px-[10px] text-[12.5px] font-semibold text-wh-ink-2 no-underline hover:bg-wh-surface-2"
                  >
                    {t("movements")}
                  </Link>
                  <Link
                    href={`/${locale}/warehouse/count?product=${r.product_id}${site}`}
                    className="inline-flex h-[30px] items-center whitespace-nowrap rounded-[8px] border border-wh-border-strong bg-wh-surface px-[10px] text-[12.5px] font-semibold text-wh-ink-1 no-underline hover:bg-wh-surface-2"
                  >
                    {t("count")}
                  </Link>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
