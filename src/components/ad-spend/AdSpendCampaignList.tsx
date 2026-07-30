"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AdSpendCampaignCard } from "./AdSpendCampaignCard";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import type { CampaignsProduct } from "@/hooks/useAdSpendCampaigns";
import { AD_SPEND_THEME as D } from "./theme";

interface AdSpendCampaignListProps {
  entries: AdSpendWithMetrics[];
  products: CampaignsProduct[];
  currency: string;
  locale: string;
  canEditLocked: boolean;
  isLoading: boolean;
  onEdit: (entry: AdSpendWithMetrics) => void;
  onDelete: (entry: AdSpendWithMetrics) => void;
}

export function AdSpendCampaignList({
  entries,
  products,
  currency,
  locale,
  canEditLocked,
  isLoading,
  onEdit,
  onDelete,
}: AdSpendCampaignListProps) {
  const t = useTranslations("adSpend");
  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name] as const)),
    [products],
  );

  if (isLoading && entries.length === 0) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))",
          gap: 16,
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 260,
              background: D.cardBg,
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    );
  }

  if (!isLoading && entries.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          gap: 8,
          color: D.tertiary,
          fontSize: 14,
        }}
      >
        <span style={{ fontSize: 32 }}>📊</span>
        <span>{t("empty")}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))",
        gap: 16,
      }}
    >
      {entries.map((entry) => (
        <AdSpendCampaignCard
          key={entry.id}
          entry={entry}
          productName={entry.product_id ? (productNameById.get(entry.product_id) ?? null) : null}
          currency={currency}
          locale={locale}
          canEditLocked={canEditLocked}
          onEdit={() => onEdit(entry)}
          onDelete={() => onDelete(entry)}
        />
      ))}
    </div>
  );
}
