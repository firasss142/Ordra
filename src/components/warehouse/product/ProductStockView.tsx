"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, Inbox, Tally5 } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import type { WarehouseStockResponse, WarehouseStockRow, StockWarehouse } from "@/app/api/warehouse/stock/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";
import {
  Chip, LABEL, LABEL_DESK, LegendItem, Num, StackBar, eventKey, neverCounted, shortDate, signed, whenLabel,
} from "./stock-bits";

/**
 * Entrepôt › Stock › one product — `R.product` (phone) and `C.product` (desk)
 * of the approved v3 prototypes, in px.
 *
 * The free figure first — what can be promised — with the stacked bar
 * (engaged ink, free brand, « en route » hatched only when a reception
 * announces units). Then the split by building, told honestly: while no
 * building has counted the product the phone says so in one line, and the
 * desk shows every building with « — » and « Jamais compté » over the whole
 * register « non ventilé ». Then the product's own movements, named by their
 * EVENT (« Sortie scannée »), never by an order or a customer. Then the way to
 * count it.
 *
 * Reads the stock route rather than a new one: one definition of engaged and
 * free across the warehouse.
 */

const HISTORY_ROWS = 6;
const PHONE_ROWS = 5;

export function ProductStockView({
  productId,
  locale,
  variant,
  siteId = null,
}: {
  productId: string;
  locale: string;
  variant: "agent" | "desk";
  /** The desk's `?warehouse_id=` (the top bar's building). Ignored on the phone. */
  siteId?: string | null;
}) {
  const t = useTranslations("warehouse.product");
  const { data: stock, isLoading } = useSWR<WarehouseStockResponse>("/api/warehouse/stock", jsonFetcher);
  const { data: sitesData } = useSWR<WarehouseSitesResponse>("/api/warehouse/sites", jsonFetcher);
  const { data: history } = useSWR<{ rows: WarehouseHistoryRow[] }>(
    `/api/warehouse/history?product_id=${encodeURIComponent(productId)}&limit=${HISTORY_ROWS}`,
    jsonFetcher,
  );

  const row = stock?.rows.find((r) => r.product_id === productId) ?? null;
  const warehouses = stock?.warehouses ?? [];
  const moves = history?.rows ?? [];
  // The building in view: an agent's own, a manager's top-bar choice.
  const inView = variant === "agent" ? (sitesData?.mine ?? null) : siteId;

  if (!row) {
    const missing = isLoading ? null : (
      <p className="py-[32px] text-center text-[14px] text-wh-ink-2">{t("notFound")}</p>
    );
    return variant === "agent" ? (
      <div className="px-[16px] pt-[18px]">
        <BackButton locale={locale} label={t("back")} />
        {missing}
      </div>
    ) : (
      <div className="px-[28px] pt-[12px]">{missing}</div>
    );
  }

  const never = neverCounted(row, inView, warehouses);
  const journalHref = `/${locale}/warehouse/stock?tab=journal&product=${row.product_id}${
    variant === "desk" && siteId ? `&warehouse_id=${siteId}` : ""
  }`;

  return variant === "agent" ? (
    <PhoneProduct row={row} warehouses={warehouses} moves={moves.slice(0, PHONE_ROWS)} never={never} locale={locale} journalHref={journalHref} />
  ) : (
    <DeskProduct
      row={row}
      warehouses={warehouses}
      sites={sitesData}
      moves={moves}
      never={never}
      locale={locale}
      siteId={siteId}
      journalHref={journalHref}
    />
  );
}

function BackButton({ locale, label }: { locale: string; label: string }) {
  return (
    <Link
      href={`/${locale}/warehouse/stock`}
      aria-label={label}
      className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-line bg-wh-surface text-wh-ink-1 no-underline"
    >
      <ArrowLeft size={18} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden="true" />
    </Link>
  );
}

/** The event a movement records, in the reader's language. */
function useEventLabel() {
  const tj = useTranslations("warehouse.journal");
  return (m: WarehouseHistoryRow) => tj(`event.${eventKey(m)}`);
}

/* ═══ Phone — R.product ═══════════════════════════════════════════════ */

function PhoneProduct({
  row,
  warehouses,
  moves,
  never,
  locale,
  journalHref,
}: {
  row: WarehouseStockRow;
  warehouses: StockWarehouse[];
  moves: WarehouseHistoryRow[];
  never: boolean;
  locale: string;
  journalHref: string;
}) {
  const t = useTranslations("warehouse.product");
  const intlLocale = useLocale();
  const eventLabel = useEventLabel();
  const multiSite = warehouses.length > 1;

  return (
    <div className="job-receive px-[16px] pb-[24px] pt-[18px] text-[14px] leading-[1.5] text-wh-ink-1">
      <div className="mb-[18px] flex items-center gap-[12px]">
        <BackButton locale={locale} label={t("back")} />
        <div className="min-w-0 flex-1">
          {row.sku ? (
            <p className="text-[12.5px] font-semibold text-wh-ink-2" dir="ltr">{row.sku}</p>
          ) : null}
          <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em]" dir="auto">{row.name}</h1>
        </div>
      </div>

      <section data-testid="product-free-card" className="rounded-[16px] border border-line-subtle bg-wh-surface p-[16px]">
        <div className="flex items-end gap-[12px]">
          <div className="min-w-0 flex-1">
            <p className={LABEL}>{t("free")}</p>
            <p data-testid="product-free" className="mt-[6px] text-[44px] font-bold leading-none tracking-[-0.03em]">
              <Num>{row.free}</Num>
            </p>
          </div>
          {never ? <Chip tone="warn">{t("neverCounted")}</Chip> : null}
        </div>
        <div className="mb-[8px] mt-[14px]">
          <StackBar engaged={row.engaged} free={row.free} incoming={row.incoming} />
        </div>
        <div className="flex flex-wrap gap-[16px] text-[12.5px] text-wh-ink-2">
          <LegendItem swatch="bg-wh-ink-1" label={t("engaged")} value={row.engaged} />
          <LegendItem swatch="bg-brand" label={t("free")} value={row.free} />
          {row.incoming && row.incoming > 0 ? (
            <LegendItem swatch="bg-wh-border-strong" label={t("incoming")} value={row.incoming} />
          ) : (
            <LegendItem swatch="bg-transparent" label={t("incoming")} value="—" />
          )}
        </div>
      </section>

      {multiSite ? (
        <>
          <p className={`${LABEL} mb-[8px] mt-[18px]`}>{t("bySite")}</p>
          {row.sites.length === 0 ? (
            <div className="flex items-center gap-[12px] rounded-[16px] border border-line-subtle bg-wh-surface p-[16px] text-[12.5px] text-wh-ink-2">
              <Inbox size={18} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{t("siteNone")}</span>
            </div>
          ) : (
            <div data-testid="product-sites" className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface">
              {warehouses.map((w) => {
                const line = row.sites.find((s) => s.warehouse_id === w.id);
                return (
                  <div key={w.id} data-site={w.code} className="flex items-center gap-[12px] border-t border-line-subtle px-[14px] py-[12px] first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold"><bdi>{w.name}</bdi></p>
                      <p className="text-[12.5px] text-wh-ink-2">
                        {line?.last_counted_at
                          ? t("countedOn", { date: shortDate(line.last_counted_at, intlLocale) })
                          : t("neverCounted")}
                      </p>
                    </div>
                    <b className={`font-bold ${line ? "" : "text-ink-muted"}`}>
                      {line ? <Num>{line.current_stock}</Num> : "—"}
                    </b>
                  </div>
                );
              })}
              <div data-site="unallocated" className="flex items-center gap-[12px] border-t border-line-subtle px-[14px] py-[12px] text-wh-ink-2">
                <p className="min-w-0 flex-1">{t("unallocated")}</p>
                <b className="font-bold text-wh-ink-1"><Num>{row.unallocated}</Num></b>
              </div>
            </div>
          )}
        </>
      ) : null}

      <p className={`${LABEL} mb-[8px] mt-[18px]`}>{t("movements")}</p>
      <div data-testid="product-moves" className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface">
        {moves.length === 0 ? (
          <p className="px-[14px] py-[12px] text-[12.5px] text-wh-ink-2">{t("noMovements")}</p>
        ) : (
          moves.map((m) => (
            <div key={m.id} data-testid="product-move" className="flex items-center gap-[12px] border-t border-line-subtle px-[14px] py-[12px] first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{eventLabel(m)}</p>
                <p className="text-[12.5px] text-wh-ink-2">{whenLabel(m.at, intlLocale)}</p>
              </div>
              {m.qty_change !== null ? (
                <b className={`min-w-[44px] text-end font-bold ${m.qty_change > 0 ? "text-status-success" : ""}`}>
                  <Num>{signed(m.qty_change)}</Num>
                </b>
              ) : null}
              <span className="min-w-[36px] text-end text-[12.5px] text-wh-ink-2">
                {m.balance_after !== null ? <Num>{m.balance_after}</Num> : null}
              </span>
            </div>
          ))
        )}
      </div>

      <Link
        href={journalHref}
        className="mt-[4px] flex min-h-[48px] w-full items-center justify-center rounded-[12px] px-[18px] text-[15px] font-semibold text-wh-ink-2 no-underline"
      >
        {t("allMovementsPhone")}
      </Link>
      <Link
        href={`/${locale}/warehouse/count?product=${row.product_id}`}
        className="mt-[8px] flex min-h-[64px] w-full items-center justify-center gap-[8px] rounded-[16px] border border-wh-border-strong bg-wh-surface px-[18px] text-[16px] font-bold text-wh-ink-1 no-underline"
      >
        <Tally5 size={20} strokeWidth={2} aria-hidden="true" />
        {t("countThis")}
      </Link>
    </div>
  );
}

/* ═══ Desk — C.product ════════════════════════════════════════════════ */

function DeskProduct({
  row,
  warehouses,
  sites,
  moves,
  never,
  locale,
  siteId,
  journalHref,
}: {
  row: WarehouseStockRow;
  warehouses: StockWarehouse[];
  sites: WarehouseSitesResponse | undefined;
  moves: WarehouseHistoryRow[];
  never: boolean;
  locale: string;
  siteId: string | null;
  journalHref: string;
}) {
  const t = useTranslations("warehouse.product");
  const intlLocale = useLocale();
  const eventLabel = useEventLabel();
  const choices = sites?.sites ?? [];
  const pinned = sites?.pinned ?? false;
  const canChoose = !pinned && choices.length > 1;
  const [countAt, setCountAt] = useState<string | null>(null);
  const chosen = countAt ?? (siteId && choices.some((s) => s.id === siteId) ? siteId : (choices[0]?.id ?? null));
  const countHref = `/${locale}/warehouse/count?product=${row.product_id}${canChoose && chosen ? `&warehouse_id=${chosen}` : ""}`;
  const multiSite = warehouses.length > 1;

  const cardH = "flex items-center gap-[10px] border-b border-line-subtle px-[18px] py-[14px]";
  const td = "border-b border-line-subtle px-[14px] py-[12px] align-middle group-last:border-b-0";

  return (
    <div className="job-receive px-[28px] pb-[40px] pt-[12px] text-[14px] leading-[1.5] text-wh-ink-1">
      <div className="mb-[20px] flex flex-wrap items-end gap-[16px]">
        <div className="min-w-0 flex-1">
          {row.sku ? <p className="font-mono text-[12.5px] text-wh-ink-2" dir="ltr">{row.sku}</p> : null}
          <h1 className="text-[24px] font-bold tracking-[-0.02em]" dir="auto">{row.name}</h1>
        </div>
        {canChoose ? (
          <>
            <label htmlFor="product-count-at" className="text-[12.5px] text-wh-ink-2">{t("countAt")}</label>
            <select
              id="product-count-at"
              value={chosen ?? ""}
              onChange={(e) => setCountAt(e.target.value)}
              className="h-[36px] rounded-[12px] border border-wh-border-strong bg-wh-surface px-[10px] text-[14px] text-wh-ink-1"
            >
              {choices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </>
        ) : null}
        <Link
          href={countHref}
          className="inline-flex h-[36px] items-center justify-center gap-[8px] whitespace-nowrap rounded-[12px] bg-brand px-[14px] text-[13.5px] font-semibold text-white no-underline hover:bg-brand-hover"
        >
          <Tally5 size={16} strokeWidth={2} aria-hidden="true" />
          {t("count")}
        </Link>
      </div>

      <div className="grid grid-cols-1 items-start gap-[12px] lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-[12px]">
          <section data-testid="product-free-card" className="rounded-[16px] border border-line-subtle bg-wh-surface p-[18px]">
            <div className="flex items-end gap-[12px]">
              <div className="min-w-0 flex-1">
                <p className={LABEL_DESK}>{t("free")}</p>
                <p data-testid="product-free" className="mt-[6px] text-[40px] font-bold leading-none tracking-[-0.03em]">
                  <Num>{row.free}</Num>
                </p>
              </div>
              {never ? <Chip tone="warn" dense>{t("never")}</Chip> : null}
            </div>
            <div className="mb-[8px] mt-[16px]">
              <StackBar engaged={row.engaged} free={row.free} incoming={row.incoming} />
            </div>
            <div className="flex flex-wrap gap-[18px] text-[12.5px] text-wh-ink-2">
              <LegendItem swatch="bg-wh-ink-1" label={t("engaged")} value={row.engaged} />
              <LegendItem swatch="bg-brand" label={t("free")} value={row.free} />
              <LegendItem swatch="bg-wh-border-strong" label={t("register")} value={row.current_stock} />
              {row.incoming && row.incoming > 0 ? (
                <LegendItem swatch="bg-wh-border-strong" label={t("incoming")} value={row.incoming} />
              ) : null}
            </div>
          </section>

          {multiSite ? (
            <section
              aria-labelledby="product-by-site"
              className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface"
            >
              <div className={cardH}>
                <h2 id="product-by-site" className="min-w-0 flex-1 text-[16px] font-bold">{t("bySite")}</h2>
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {warehouses.map((w) => {
                    const line = row.sites.find((s) => s.warehouse_id === w.id);
                    return (
                      <tr key={w.id} className="group">
                        <td className={td}><bdi>{w.name}</bdi></td>
                        <td className={`${td} text-end ${line ? "" : "text-ink-muted"}`}>
                          {line ? <Num>{line.current_stock}</Num> : "—"}
                        </td>
                        <td className={td}>
                          {line?.last_counted_at ? (
                            <span className="text-[12.5px] text-wh-ink-2">
                              {t("countedOn", { date: shortDate(line.last_counted_at, intlLocale) })}
                            </span>
                          ) : (
                            <Chip tone="mute" dense>{t("siteNeverCounted")}</Chip>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="group">
                    <td className={`${td} text-wh-ink-2`}>{t("unallocated")}</td>
                    <td className={`${td} text-end`}><b className="font-bold"><Num>{row.unallocated}</Num></b></td>
                    <td className={td} />
                  </tr>
                </tbody>
              </table>
            </section>
          ) : null}

          <section data-testid="product-variants" className="rounded-[16px] border border-line-subtle bg-wh-surface p-[18px] text-[12.5px] text-wh-ink-2">
            <b className="font-bold text-wh-ink-1">{t("variants")}</b>
            {row.variants.length === 0 ? (
              <> · {t("noVariants")}</>
            ) : (
              <ul className="mt-[8px]">
                {row.variants.map((v) => (
                  <li key={v.id} className="flex items-center gap-[12px] py-[4px] text-[14px] text-wh-ink-1">
                    <span className="min-w-0 flex-1"><bdi>{v.label}</bdi></span>
                    <b className="font-bold"><Num>{v.current_stock}</Num></b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="overflow-hidden rounded-[16px] border border-line-subtle bg-wh-surface">
          <div className={cardH}>
            <h2 className="min-w-0 flex-1 text-[16px] font-bold">{t("lastMovements")}</h2>
          </div>
          <div data-testid="product-moves">
            {moves.length === 0 ? (
              <p className="border-b border-line-subtle px-[18px] py-[13px] text-[12.5px] text-wh-ink-2">{t("noMovements")}</p>
            ) : (
              moves.map((m) => (
                <div key={m.id} data-testid="product-move" className="flex items-center gap-[12px] border-b border-line-subtle px-[18px] py-[13px]">
                  <span aria-hidden="true" className="h-[8px] w-[8px] shrink-0 rounded-full bg-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{eventLabel(m)}</p>
                    <p className="text-[12.5px] text-wh-ink-2">
                      {[whenLabel(m.at, intlLocale), m.actor?.full_name, m.warehouse_name].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {m.qty_change !== null ? (
                    <b className="font-bold"><Num>{signed(m.qty_change)}</Num></b>
                  ) : null}
                  <span className="min-w-[34px] text-end text-[12.5px] text-wh-ink-2">
                    {m.balance_after !== null ? <Num>{m.balance_after}</Num> : null}
                  </span>
                </div>
              ))
            )}
          </div>
          <Link
            href={journalHref}
            className="flex w-full items-center gap-[12px] px-[18px] py-[13px] font-semibold text-brand-hover no-underline hover:bg-wh-surface-2"
          >
            {t("allMovements")}
            <ChevronRight size={16} strokeWidth={2} className="ms-auto rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </section>
      </div>
    </div>
  );
}
