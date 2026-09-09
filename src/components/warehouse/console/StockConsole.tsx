"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { WarehouseStockClient } from "./WarehouseStockClient";
import { JournalConsole } from "./JournalConsole";

/**
 * Entrepôt › Stock — what we hold, and every movement that got it there.
 *
 * The Journal was its own sidebar entry, which put a read-only audit log at the
 * same level as the two screens people work in all day. It is the evidence
 * behind the stock figures, so it belongs beside them: same question, two
 * depths.
 */
export function StockConsole({ locale }: { locale: string }) {
  const t = useTranslations("warehouse.stock");
  const [tab, setTab] = useState<"levels" | "journal">("levels");

  return (
    <div>
      <div className="mx-auto w-full max-w-[1460px] px-4 pt-4 md:px-6">
        <SegmentedTabs
          role="tablist"
          ariaLabel={t("consoleTabs")}
          value={tab}
          onChange={(k) => setTab(k as "levels" | "journal")}
          segments={[
            { key: "levels", label: t("tabLevels") },
            { key: "journal", label: t("tabJournal") },
          ]}
        />
      </div>
      {tab === "levels" ? <WarehouseStockClient locale={locale} /> : <JournalConsole locale={locale} />}
    </div>
  );
}
