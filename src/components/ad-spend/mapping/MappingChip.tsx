"use client";

import { useTranslations } from "next-intl";
import { CornerDownRight } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { MappingProductDTO, MappingVersionDTO } from "@/lib/ad-spend/mapping-types";

/**
 * What a campaign or ad set sells, in one glance: a product (thumbnail first —
 * the three boxing dolls differ only by one Arabic word), several products and
 * how they split, deliberate market-level spend, or amber "to map". An ad set
 * that follows its campaign says so instead of repeating the campaign's chip.
 */
export function MappingChip({
  version,
  inherited = false,
  products,
}: {
  version: MappingVersionDTO | null;
  inherited?: boolean;
  products: Map<string, MappingProductDTO>;
}) {
  const t = useTranslations("adSpend.mapping");

  if (inherited) {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted">
        <CornerDownRight size={12} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden />
        {t("inherits")}
      </span>
    );
  }

  if (!version || version.kind === "inherit") {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-[6px] border border-ads-orange-line bg-ads-orange-bg text-ads-orange-ink text-[12px] font-semibold whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-status-warning" aria-hidden />
        {t("chipToMap")}
      </span>
    );
  }

  if (version.kind === "market_level" || version.lines.length === 0) {
    return (
      <span className="inline-flex items-center h-6 px-2 rounded-[6px] border border-line bg-surface-sunken text-ink-secondary text-[12px] font-medium whitespace-nowrap">
        {t("chipMarket")}
      </span>
    );
  }

  if (version.lines.length === 1) {
    const p = products.get(version.lines[0].product_id);
    const name = p?.name ?? version.lines[0].product_id;
    return (
      <span className="inline-flex items-center gap-1.5 h-6 max-w-full min-w-0 ps-[3px] pe-2 rounded-[6px] border border-line bg-surface-card text-[12px] font-medium">
        <ProductAvatar imageUrl={p?.image_url ?? null} productName={name} size={18} />
        <span className={`truncate ${p && !p.is_active ? "line-through text-ink-muted" : "text-ink-primary"}`}>
          <bdi>{name}</bdi>
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 h-6 ps-[3px] pe-2 rounded-[6px] border border-line bg-surface-card text-[12px] font-medium text-ink-primary whitespace-nowrap">
      <span className="inline-flex">
        {version.lines.slice(0, 3).map((l, i) => {
          const p = products.get(l.product_id);
          return (
            <span key={l.product_id} className={`rounded-[5px] ring-2 ring-white ${i > 0 ? "-ms-2" : ""}`}>
              <ProductAvatar imageUrl={p?.image_url ?? null} productName={p?.name ?? l.product_id} size={18} />
            </span>
          );
        })}
      </span>
      {t("chipMulti", {
        count: version.lines.length,
        mode: version.split_mode === "manual" ? t("modeManual") : t("modeAuto"),
      })}
    </span>
  );
}
