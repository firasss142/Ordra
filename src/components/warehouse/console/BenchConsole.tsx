"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { PreparationConsole } from "./PreparationConsole";
import { ScannedTable } from "./ScannedTable";
import type { PrepRow } from "./PrepCard";

/**
 * Entrepôt › Banc — one screen for the whole life of a parcel in the building.
 *
 * The section used to be seven entries: Aujourd'hui, Préparation, Mode scan,
 * Retours, Stock, Journal, Suivi transporteur, plus an unreachable À expédier.
 * Aujourd'hui repeated every figure the other screens already showed, its
 * "priority actions" were not even clickable, and Mode scan was a third
 * rendering of the same queue and the same scanner.
 *
 * What is left is the question the bench actually asks, in order: what do I
 * prepare, what did I already scan, and what is nobody dealing with.
 */

export type BenchTab = "prepare" | "scanned";

export function BenchConsole({
  market,
  initialOrders,
  dailyGoal,
  warehouseId,
}: {
  market: "ly" | "tn";
  initialOrders: PrepRow[];
  dailyGoal: number | null;
  warehouseId?: string | null;
}) {
  const t = useTranslations("warehouse.bench");
  const [tab, setTab] = useState<BenchTab>("prepare");

  return (
    <div className="mx-auto w-full max-w-[1460px] px-4 py-4 md:px-6">
      <SegmentedTabs
        className="mb-4"
        role="tablist"
        ariaLabel={t("segments")}
        value={tab}
        onChange={(k) => setTab(k as BenchTab)}
        segments={[
          { key: "prepare", label: t("segmentBench") },
          { key: "scanned", label: t("segmentScanned") },
        ]}
      />

      {tab === "prepare" ? (
        <PreparationConsole market={market} initialOrders={initialOrders} dailyGoal={dailyGoal} />
      ) : (
        <ScannedTable warehouseId={warehouseId} />
      )}
    </div>
  );
}
