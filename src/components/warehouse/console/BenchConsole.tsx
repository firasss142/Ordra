"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { FoldSummary } from "@/lib/warehouse/desk-sortir";
import { useDeskScan } from "@/components/warehouse/desk/DeskScanContext";
import { PreparationConsole } from "./PreparationConsole";
import { ScannedTable } from "./ScannedTable";
import type { PrepRow } from "./PrepCard";

/**
 * Entrepôt › Sortir, at a desk (market_manager / super_admin).
 *
 * « Sortir » and two tabs: what waits to be scanned, grouped by sticker roll,
 * and what already left today. The building comes from the top bar's switch
 * (`?warehouse_id=`); the scanner is the top bar's permanent field, fed by the
 * parcel taken here with « Prendre ». The pickup strip lives on Aujourd'hui.
 */

export type BenchTab = "prepare" | "scanned";

interface QueuePage {
  orders: PrepRow[];
  /** The whole queue for this building, not the page of rows held here. */
  total?: number;
}

const fetcher = (u: string) =>
  fetch(u).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

export function BenchConsole({
  market,
  initialOrders,
  initialTotal,
  scannedToday,
  warehouseId,
  siteNames,
  fold,
}: {
  market: "ly" | "tn";
  initialOrders: PrepRow[];
  initialTotal: number;
  /** Parcels scanned out today in this building (or the market). */
  scannedToday: number;
  /** From `?warehouse_id=`; null = every building. */
  warehouseId: string | null;
  siteNames: Record<string, string>;
  fold: FoldSummary;
}) {
  const t = useTranslations("warehouse.desk");
  const [tab, setTab] = useState<BenchTab>("prepare");

  const key = `/api/warehouse/to-label?limit=200${
    warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""
  }`;
  // A fresh fallback object on every render is a render loop waiting to happen.
  const fallbackData = useMemo<QueuePage>(
    () => ({ orders: initialOrders, total: initialTotal }),
    [initialOrders, initialTotal],
  );
  const { data } = useSWR<QueuePage>(key, fetcher, { fallbackData, revalidateOnFocus: true });
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const total = data?.total ?? orders.length;

  /*
   * The top bar's field binds to the parcel in hand. It needs this queue too:
   * Tunisia's label QR is the order id and resolves against it. Leaving the
   * page drops both, so the field never binds to a parcel no longer on screen.
   */
  const { hand, take, setQueue } = useDeskScan();
  useEffect(() => {
    setQueue({ market, orders });
  }, [market, orders, setQueue]);
  useEffect(
    () => () => {
      setQueue(null);
      take(null);
    },
    [setQueue, take],
  );
  // Scanned from another desk or a phone: it is not in anyone's hand here.
  useEffect(() => {
    if (hand && !orders.some((o) => o.id === hand.id)) take(null);
  }, [hand, orders, take]);

  const tabs: Array<{ key: BenchTab; label: string; n: number }> = [
    { key: "prepare", label: t("tabToScan"), n: total },
    { key: "scanned", label: t("tabScanned"), n: scannedToday },
  ];

  return (
    <div className="job-out px-[28px] pb-[40px] pt-[12px] text-[14px] leading-[1.5] text-[#1A1A1A]">
      <div className="mb-[20px] flex items-end gap-[16px]">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        </div>
        <div role="tablist" aria-label={t("title")} className="inline-flex gap-[3px] rounded-[10px] bg-[#ECEDEF] p-[3px]">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={`whitespace-nowrap rounded-[8px] px-[16px] py-[7px] text-[13.5px] font-semibold ${
                tab === x.key ? "bg-white text-[#1A1A1A]" : "text-[#6D7175] hover:text-[#1A1A1A]"
              }`}
            >
              {x.label}{" "}
              <span dir="ltr" className="tabular-nums text-[#6D7175]">{x.n}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "prepare" ? (
        <PreparationConsole
          market={market}
          orders={orders}
          siteNames={siteNames}
          fold={fold}
          warehouseId={warehouseId}
        />
      ) : (
        <ScannedTable warehouseId={warehouseId} isLy={market === "ly"} />
      )}
    </div>
  );
}
