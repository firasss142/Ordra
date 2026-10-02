"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { Role } from "@/types";
import { canViewReceptions } from "@/lib/receptions/permissions";
import { ReceptionsConsole } from "@/components/warehouse/receptions/ReceptionsConsole";
import { WarehouseStockClient } from "./WarehouseStockClient";
import { JournalConsole } from "./JournalConsole";

/**
 * Entrepôt › Stock — what we hold, every movement that got it there, and what
 * is coming in. One question — « Combien avons-nous, où, et qu'est-ce qui
 * entre ? » — at three depths.
 *
 * The tab and the product live in the ADDRESS (`?tab=levels|receptions|journal`
 * and `?product=<id>`). The tab used to be local state, so « Recevoir » on
 * Aujourd'hui could not open Réceptions, and « Mouvements » on a stock row
 * pointed at a redirect that dropped the product.
 *
 * Wears the Recevoir hue (`job-receive`): receiving and stock are one job seen
 * from two sides — what comes in and what is held.
 */
type Tab = "levels" | "receptions" | "journal";

export function StockConsole({ locale, role }: { locale: string; role: Role }) {
  const t = useTranslations("warehouse.stock");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const showReceptions = canViewReceptions(role);

  const requested = search.get("tab");
  const tab: Tab =
    requested === "journal" ? "journal" : requested === "receptions" && showReceptions ? "receptions" : "levels";
  const product = search.get("product");

  const go = useCallback(
    (next: { tab: Tab; product?: string | null }) => {
      const params = new URLSearchParams();
      if (next.tab !== "levels") params.set("tab", next.tab);
      if (next.tab === "journal" && next.product) params.set("product", next.product);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname],
  );

  return (
    <div className="job-receive">
      <div className="mx-auto w-full max-w-[1460px] px-4 pt-4 md:px-6">
        <SegmentedTabs
          role="tablist"
          ariaLabel={t("consoleTabs")}
          value={tab}
          onChange={(k) => go({ tab: k as Tab })}
          segments={[
            { key: "levels", label: t("tabLevels") },
            ...(showReceptions ? [{ key: "receptions", label: t("tabReceptions") }] : []),
            { key: "journal", label: t("tabJournal") },
          ]}
        />
      </div>
      {tab === "levels" ? (
        <WarehouseStockClient locale={locale} />
      ) : tab === "receptions" ? (
        <ReceptionsConsole locale={locale} role={role} />
      ) : (
        <JournalConsole
          locale={locale}
          productId={product}
          onClearProduct={() => go({ tab: "journal", product: null })}
        />
      )}
    </div>
  );
}
