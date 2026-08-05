"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Repeat } from "lucide-react";
import { getProductAvatarColor, getProductInitial } from "@/lib/product-avatar";
import type { ProductSheetCrossSell as CrossSell } from "@/types/product-sheet";

export interface ProductSheetCrossSellProps {
  crossSell: CrossSell | null;
  currency: string;
  onOpen: (productId: string) => void;
}

/**
 * "Offer this instead" — turns a refusal into a different sale rather than a
 * lost call. Tapping it re-keys the sheet to that product (one hop, enforced
 * server-side).
 */
export function ProductSheetCrossSell({
  crossSell,
  currency,
  onOpen,
}: ProductSheetCrossSellProps) {
  const t = useTranslations("productSheet");

  if (!crossSell) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Repeat size={12} strokeWidth={2} aria-hidden="true" className="text-ink-muted" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {t("crossSell")}
        </span>
        <span className="text-[10px] text-ink-muted">· {t("crossSellHint")}</span>
      </div>

      <button
        type="button"
        onClick={() => onOpen(crossSell.id)}
        className="group flex items-center gap-3 rounded-card border border-line-subtle px-3 py-2.5 text-start transition-shadow duration-fast hover:shadow-hover-row"
      >
        {crossSell.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={crossSell.image_url}
            alt=""
            loading="lazy"
            className="h-10 w-10 flex-shrink-0 rounded-[6px] object-cover bg-surface-sunken"
          />
        ) : (
          <span
            aria-hidden="true"
            style={{ backgroundColor: getProductAvatarColor(crossSell.name) }}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[6px] text-[14px] font-semibold text-ink-primary"
          >
            {getProductInitial(crossSell.name)}
          </span>
        )}

        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-primary">
          {crossSell.name}
        </span>

        {crossSell.default_price !== null && (
          <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink-primary">
            {crossSell.default_price}
            <span className="text-[11px] font-normal text-ink-muted ms-1">{currency}</span>
          </span>
        )}

        <ArrowRight
          size={13}
          strokeWidth={2}
          aria-hidden="true"
          className="flex-shrink-0 text-ink-muted rtl:rotate-180"
        />
      </button>
    </section>
  );
}
