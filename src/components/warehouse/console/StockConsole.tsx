"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { Role } from "@/types";
import { canViewReceptions } from "@/lib/receptions/permissions";
import { ReceptionsConsole } from "@/components/warehouse/receptions/ReceptionsConsole";
import { WarehouseStockClient } from "./WarehouseStockClient";
import { JournalConsole } from "./JournalConsole";

/**
 * Entrepôt › Stock — what we hold, every movement that got it there, and what
 * is coming in.
 *
 * The Journal was its own sidebar entry, which put a read-only audit log at the
 * same level as the two screens people work in all day. It is the evidence
 * behind the stock figures, so it belongs beside them: same question, two
 * depths.
 *
 * Réceptions joins them for the same reason. The section's question has always
 * been « Combien avons-nous, où, et qu'est-ce qui entre ? » — the third clause
 * simply had no data model until now. One question, three depths.
 */
type Tab = "levels" | "receptions" | "journal";

export function StockConsole({ locale, role }: { locale: string; role: Role }) {
  const t = useTranslations("warehouse.stock");
  const [tab, setTab] = useState<Tab>("levels");
  const showReceptions = canViewReceptions(role);

  return (
    <div>
      <div className="mx-auto w-full max-w-[1460px] px-4 pt-4 md:px-6">
        <SegmentedTabs
          role="tablist"
          ariaLabel={t("consoleTabs")}
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          segments={[
            { key: "levels", label: t("tabLevels") },
            ...(showReceptions ? [{ key: "receptions", label: t("tabReceptions") }] : []),
            { key: "journal", label: t("tabJournal") },
          ]}
        />
      </div>
      {tab === "levels" ? (
        <WarehouseStockClient locale={locale} />
      ) : tab === "receptions" && showReceptions ? (
        <ReceptionsConsole locale={locale} role={role} />
      ) : (
        <JournalConsole locale={locale} />
      )}
    </div>
  );
}
