"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, Package, Tally5 } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";

/**
 * Entrepôt › Stock › one product.
 *
 * Where « Mouvements » finally lands (it used to point at a redirect that
 * dropped the product). The free figure first — what can be promised — then
 * the split by building, told honestly: a building that has never counted says
 * so instead of showing 0, and the stock no building has counted yet is named
 * (« non ventilé »). Then the product's own movements, and the way to count it.
 *
 * Reads the stock route rather than a new one: one definition of engaged and
 * free across the warehouse.
 */

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

export function ProductStockView({ productId, locale }: { productId: string; locale: string }) {
  const t = useTranslations("warehouse.product");
  const format = useFormatter();
  const { data: stock, isLoading } = useSWR<{ rows: WarehouseStockRow[] }>("/api/warehouse/stock", jsonFetcher);
  const { data: sitesData } = useSWR<WarehouseSitesResponse>("/api/warehouse/sites", jsonFetcher);
  const { data: history } = useSWR<{ rows: WarehouseHistoryRow[] }>(
    `/api/warehouse/history?product_id=${encodeURIComponent(productId)}&limit=20`,
    jsonFetcher,
  );
  const [countAt, setCountAt] = useState<string | null>(null);

  const row = stock?.rows.find((r) => r.product_id === productId) ?? null;
  const sites = sitesData?.sites ?? [];
  const pinned = sitesData?.pinned ?? false;
  const chosen = countAt ?? sites[0]?.id ?? null;

  const back = (
    <Link
      href={`/${locale}/warehouse/stock`}
      className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-wh-ink-2 no-underline"
    >
      <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden="true" />
      {t("back")}
    </Link>
  );

  if (!row) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-4 py-5 md:px-6">
        {back}
        {isLoading ? null : <p className="py-8 text-center text-[14px] text-wh-ink-2">{t("notFound")}</p>}
      </div>
    );
  }

  const never = row.last_counted_at === null;
  const countHref = `/${locale}/warehouse/count?product=${row.product_id}${
    !pinned && sites.length > 1 && chosen ? `&warehouse_id=${chosen}` : ""
  }`;
  const total = Math.max(row.current_stock + (row.incoming ?? 0), 1);
  const multiSite = sites.length > 1;

  return (
    <div className="job-receive mx-auto w-full max-w-[1100px] px-4 py-5 md:px-6">
      {back}

      <header className="mb-5 flex flex-wrap items-center gap-4">
        {row.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.image_url} alt="" className="h-20 w-20 shrink-0 rounded-[16px] object-cover" />
        ) : (
          <span className="grid h-20 w-20 shrink-0 place-items-center rounded-[16px] bg-job-bg text-job-ink">
            <Package size={30} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {row.sku ? <p className="font-mono text-[12.5px] text-wh-ink-2" dir="ltr">{row.sku}</p> : null}
          <h1 className="text-[22px] font-bold leading-snug text-wh-ink-1" dir="auto">{row.name}</h1>
          {never ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-pill bg-wh-warn-bg px-2.5 py-0.5 text-[12px] font-semibold text-wh-warn">
              <i className="h-1.5 w-1.5 rounded-full bg-wh-warn" aria-hidden="true" />
              {t("neverCounted")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!pinned && multiSite ? (
            <label className="flex items-center gap-2 text-[13px] text-wh-ink-2">
              <span>{t("countAt")}</span>
              <select
                aria-label={t("countAt")}
                value={chosen ?? ""}
                onChange={(e) => setCountAt(e.target.value)}
                className="h-10 rounded-[10px] border border-wh-border bg-wh-surface px-2.5 text-[14px] font-semibold text-wh-ink-1"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <Link
            href={countHref}
            className="job-count inline-flex min-h-[40px] items-center gap-2 rounded-[10px] bg-job px-4 text-[14px] font-bold text-white no-underline"
          >
            <Tally5 size={16} aria-hidden="true" />
            {t("count")}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* ── What can be promised ─────────────────────────────── */}
          <section className="rounded-[14px] border border-wh-border bg-wh-surface p-5">
            <p className="text-[12px] font-semibold text-wh-ink-2">{t("free")}</p>
            <p data-testid="product-free" className="mt-2 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums text-wh-ink-1">
              {row.free}
            </p>
            <div className="mt-4 flex h-2.5 gap-[3px] overflow-hidden rounded-pill" aria-hidden="true">
              <i className="block h-full bg-wh-ink-1" style={{ width: `${(Math.max(row.engaged, 0) / total) * 100}%` }} />
              <i className="block h-full bg-job" style={{ width: `${(Math.max(row.free, 0) / total) * 100}%` }} />
              {row.incoming ? (
                <i className="block h-full bg-wh-border-strong" style={{ width: `${(row.incoming / total) * 100}%` }} />
              ) : null}
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-wh-ink-2">
              <div className="flex gap-1.5"><dt>{t("engaged")}</dt><dd className="font-bold tabular-nums text-wh-ink-1">{row.engaged}</dd></div>
              <div className="flex gap-1.5"><dt>{t("free")}</dt><dd className="font-bold tabular-nums text-wh-ink-1">{row.free}</dd></div>
              <div className="flex gap-1.5"><dt>{t("register")}</dt><dd className="font-bold tabular-nums text-wh-ink-1">{row.current_stock}</dd></div>
              {row.incoming ? (
                <div className="flex gap-1.5"><dt>{t("incoming")}</dt><dd className="font-bold tabular-nums text-wh-ink-1">{row.incoming}</dd></div>
              ) : null}
            </dl>
          </section>

          {/* ── Where it is ──────────────────────────────────────── */}
          {multiSite ? (
            <section aria-labelledby="product-sites" className="overflow-hidden rounded-[14px] border border-wh-border bg-wh-surface">
              <h2 id="product-sites" className="border-b border-wh-border px-5 py-3.5 text-[15px] font-bold text-wh-ink-1">
                {t("bySite")}
              </h2>
              <ul>
                {sites.map((s) => {
                  const line = row.sites.find((l) => l.warehouse_id === s.id);
                  const counted = line?.last_counted_at ?? null;
                  return (
                    <li key={s.id} className="flex items-center gap-3 border-b border-wh-border px-5 py-3 last:border-0">
                      <span className="flex-1 font-semibold text-wh-ink-1">{s.name}</span>
                      {counted ? (
                        <span className="text-[12.5px] text-wh-ink-2">
                          {t("countedOn", { date: format.dateTime(new Date(counted), { day: "numeric", month: "short" }) })}
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-wh-warn">{t("neverCounted")}</span>
                      )}
                      <b className="min-w-[48px] text-end tabular-nums text-wh-ink-1">{line ? line.current_stock : "—"}</b>
                    </li>
                  );
                })}
                <li className="flex items-center gap-3 px-5 py-3">
                  <span className="flex-1">
                    <span className="block text-wh-ink-2">{t("unallocated")}</span>
                    <span className="block text-[12px] text-wh-ink-3">{t("unallocatedHint")}</span>
                  </span>
                  <b className="min-w-[48px] text-end tabular-nums text-wh-ink-1">
                    {row.sites.length > 0 ? row.unallocated : row.current_stock}
                  </b>
                </li>
              </ul>
            </section>
          ) : null}
        </div>

        {/* ── What moved it ────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-[14px] border border-wh-border bg-wh-surface">
          <h2 className="border-b border-wh-border px-5 py-3.5 text-[15px] font-bold text-wh-ink-1">{t("movements")}</h2>
          {(history?.rows ?? []).length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-wh-ink-2">{t("noMovements")}</p>
          ) : (
            <ul>
              {(history?.rows ?? []).map((m) => (
                <li key={m.id} className="flex items-center gap-3 border-b border-wh-border px-5 py-3 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-wh-ink-1" dir="auto">{m.detail}</span>
                    <span className="block text-[12.5px] text-wh-ink-2">
                      {format.dateTime(new Date(m.at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {m.actor ? ` · ${m.actor.full_name}` : ""}
                    </span>
                  </span>
                  {m.qty_change !== null ? (
                    <b dir="ltr" className={`tabular-nums ${m.qty_change > 0 ? "text-wh-ok" : "text-wh-ink-1"}`}>
                      {signed(m.qty_change)}
                    </b>
                  ) : null}
                  {m.balance_after !== null ? (
                    <span className="min-w-[40px] text-end text-[12.5px] tabular-nums text-wh-ink-2">{m.balance_after}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/${locale}/warehouse/stock?tab=journal&product=${row.product_id}`}
            className="flex items-center gap-2 border-t border-wh-border px-5 py-3.5 text-[13.5px] font-semibold text-wh-ink-1 no-underline hover:bg-wh-surface-2"
          >
            <span className="flex-1">{t("allMovements")}</span>
            <ChevronRight size={16} className="text-wh-ink-3 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </section>
      </div>
    </div>
  );
}
