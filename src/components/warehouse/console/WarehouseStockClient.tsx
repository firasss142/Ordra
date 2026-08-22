"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Boxes, Lock, PackageCheck, TriangleAlert, ClipboardList } from "lucide-react";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { WhCard, WhKpiCard, WhKpiGrid, WhPill } from "./primitives";
import { WH_LABEL } from "./tokens";
import { StockCountDialog } from "./StockCountDialog";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

function relativeDay(iso: string | null, never: string): string {
  if (!iso) return never;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}

export function WarehouseStockClient({ locale }: { locale: string }) {
  const t = useTranslations("warehouse.stock");
  const { data, error, isLoading, mutate } = useSWR<{ rows: WarehouseStockRow[] }>(
    "/api/warehouse/stock",
    fetcher,
    { revalidateOnFocus: true },
  );
  const [counting, setCounting] = useState<WarehouseStockRow | null>(null);

  const rows = data?.rows ?? [];

  const cells = useMemo(() => {
    const low = rows.filter((r) => r.current_stock <= r.low_stock_threshold);
    const negative = rows.filter((r) => r.free < 0);
    const engaged = rows.reduce((n, r) => n + r.engaged, 0);
    return [
      { id: "products", label: t("kpiProducts"), value: rows.length, tone: "muted" as const, icon: Boxes },
      {
        id: "low", label: t("kpiLow"), value: low.length,
        tone: low.length ? ("warn" as const) : ("muted" as const), icon: TriangleAlert,
        edge: low.length ? ("warn" as const) : undefined, dim: low.length === 0,
      },
      { id: "engaged", label: t("kpiEngaged"), value: engaged, tone: "scan" as const, icon: Lock },
      {
        id: "negative", label: t("kpiNegative"), value: negative.length,
        tone: negative.length ? ("bad" as const) : ("muted" as const), icon: PackageCheck,
        edge: negative.length ? ("bad" as const) : undefined, dim: negative.length === 0,
      },
    ];
  }, [rows, t]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
        <p className="mt-1 text-[13px] text-wh-ink-2">{t("subtitle")}</p>
      </header>

      <div className="mb-4">
        <WhKpiGrid>
        {cells.map((c) => (
          <WhKpiCard key={c.id} {...c} />
        ))}
      </WhKpiGrid>
      </div>

      <WhCard title={t("title")} hint={`${rows.length}`}>
        {error ? (
          <p className="px-4 py-8 text-center text-[13px] text-wh-bad">{t("loadError")}</p>
        ) : isLoading ? (
          <div className="space-y-2 p-4" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 rounded-[8px] bg-wh-sunken" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-wh-ink-3">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-wh-border">
                  <th className={`px-4 py-2.5 text-start ${WH_LABEL}`}>{t("colProduct")}</th>
                  <th className={`px-4 py-2.5 text-end ${WH_LABEL}`}>{t("colHeld")}</th>
                  <th className={`px-4 py-2.5 text-end ${WH_LABEL}`}>{t("colEngaged")}</th>
                  <th className={`px-4 py-2.5 text-end ${WH_LABEL}`}>{t("colFree")}</th>
                  <th className={`px-4 py-2.5 text-start ${WH_LABEL}`}>{t("colCounted")}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = r.current_stock <= r.low_stock_threshold;
                  const negative = r.free < 0;
                  return (
                    <tr key={r.product_id} className="border-b border-wh-border last:border-0 hover:bg-wh-surface-2">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-wh-ink-1">{r.name}</span>
                          {negative ? (
                            <WhPill tone="bad">{t("negative")}</WhPill>
                          ) : low ? (
                            <WhPill tone="warn">{t("low")}</WhPill>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-wh-ink-1">{r.current_stock}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-wh-ink-2">{r.engaged}</td>
                      <td className={`px-4 py-3 text-end font-semibold tabular-nums ${negative ? "text-wh-bad" : "text-wh-ink-1"}`}>
                        {r.free}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-wh-ink-3">
                        {relativeDay(r.last_counted_at, t("never"))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {/* Movements live in the Journal, filtered — not duplicated here. */}
                          <Link
                            href={`/${locale}/warehouse/history?product_id=${r.product_id}`}
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-wh-border px-2.5 py-1.5 text-[12.5px] font-semibold text-wh-ink-2 hover:border-wh-border-strong"
                          >
                            <ClipboardList size={13} aria-hidden="true" />
                            {t("movements")}
                          </Link>
                          <button
                            type="button"
                            onClick={() => setCounting(r)}
                            className="rounded-[8px] border border-wh-ok bg-wh-ok px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
                          >
                            {t("count")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </WhCard>

      {counting ? (
        <StockCountDialog
          row={counting}
          onClose={() => setCounting(null)}
          onDone={() => {
            setCounting(null);
            void mutate();
          }}
        />
      ) : null}
    </div>
  );
}
