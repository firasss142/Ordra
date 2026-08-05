"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { stockBadge } from "@/lib/products/stock-badge";
import { getProductAvatarColor, getProductInitial } from "@/lib/product-avatar";
import type { ProductSheetMedia } from "@/types/product-sheet";

export interface ProductSheetHeroProps {
  name: string;
  price: number | null;
  currency: string;
  currentStock: number;
  lowStockThreshold: number;
  media: ProductSheetMedia[];
  activeIndex: number;
  onSelectMedia: (index: number) => void;
}

/**
 * The 1:1 hero, the product name and the single KPI-scale figure on the sheet
 * (§4.16). The price is the number this surface exists to answer.
 */
export function ProductSheetHero({
  name,
  price,
  currency,
  currentStock,
  lowStockThreshold,
  media,
  activeIndex,
  onSelectMedia,
}: ProductSheetHeroProps) {
  const t = useTranslations("orders.detail");
  const badge = stockBadge(currentStock, lowStockThreshold);
  const cover = media[activeIndex] ?? media[0] ?? null;

  return (
    <section className="flex flex-col gap-3">
      {cover ? (
        <CoverImage url={cover.url} alt={cover.alt ?? name} name={name} />
      ) : (
        <Placeholder name={name} />
      )}

      {media.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {media.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectMedia(i)}
              aria-label={m.alt ?? name}
              aria-current={i === activeIndex}
              className={`flex-shrink-0 w-12 h-12 rounded-[6px] overflow-hidden border transition-colors duration-fast ${
                i === activeIndex ? "border-ink-primary" : "border-line-subtle"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-[17px] font-semibold leading-snug text-ink-primary">{name}</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {price !== null && (
            <span className="text-[24px] font-bold tabular-nums leading-none text-ink-primary">
              {price}
              <span className="text-[12px] font-semibold text-ink-secondary ms-1.5">
                {currency}
              </span>
            </span>
          )}
          <Badge tone={badge.tone} dot>
            {t(badge.key, badge.count !== undefined ? { count: badge.count } : undefined)}
          </Badge>
        </div>
      </div>
    </section>
  );
}

function CoverImage({ url, alt, name }: { url: string; alt: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Placeholder name={name} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full aspect-square object-cover rounded-[8px] border border-line-subtle bg-surface-sunken"
    />
  );
}

/**
 * Same letter-avatar fallback grammar as ProductAvatar, at hero scale.
 * The generated palette is pastel, so the initial stays ink-primary — white
 * would be unreadable on it.
 */
function Placeholder({ name }: { name: string }) {
  return (
    <div
      aria-hidden="true"
      style={{ backgroundColor: getProductAvatarColor(name) }}
      className="w-full aspect-square rounded-[8px] border border-line-subtle flex items-center justify-center text-[48px] font-semibold text-ink-primary"
    >
      {getProductInitial(name)}
    </div>
  );
}
