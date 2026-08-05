"use client";

import { useTranslations } from "next-intl";
import { Layers, Lock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { ProductSheetVariant } from "@/types/product-sheet";

export interface ProductSheetPacksProps {
  variants: ProductSheetVariant[];
  floorPrice: number | null;
  currency: string;
}

/**
 * Pack tiers, high in the reading order because "how much / is there a cheaper
 * option" is the question that most often interrupts a call.
 *
 * The ordered tier is marked with a border, never a tint (§4.10).
 */
export function ProductSheetPacks({ variants, floorPrice, currency }: ProductSheetPacksProps) {
  const t = useTranslations("productSheet");

  if (variants.length === 0 && floorPrice === null) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Layers size={12} strokeWidth={2} aria-hidden="true" className="text-ink-muted" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {t("packs")}
        </span>
      </div>

      {variants.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {variants.map((v) => (
            <li
              key={v.id}
              className={`rounded-card border px-3 py-2 ${
                v.is_ordered ? "border-ink-primary" : "border-line-subtle"
              } ${v.is_active ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-ink-primary">
                  {v.label}
                </span>
                {v.is_ordered && <Badge tone="action">{t("packOrdered")}</Badge>}
                <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink-primary">
                  {v.display_price}
                  <span className="text-[11px] font-normal text-ink-muted ms-1">{currency}</span>
                </span>
              </div>
              {v.agent_note?.trim() && (
                <p className="mt-1 text-[12px] text-ink-secondary">{v.agent_note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {floorPrice !== null && (
        <div className="flex items-start gap-2 rounded-card border border-line-subtle bg-surface-page px-3 py-2">
          <Lock
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            className="mt-0.5 flex-shrink-0 text-ink-muted"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium tabular-nums text-ink-primary">
              {t("floorPrice", { price: floorPrice, currency })}
            </p>
            <p className="text-[11px] text-ink-secondary">{t("floorPriceHint")}</p>
          </div>
        </div>
      )}
    </section>
  );
}
