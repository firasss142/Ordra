"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";

interface ProductDetailHeaderProps {
  locale: string;
  productId: string;
  name: string;
  isActive: boolean;
  currentStock: number;
  isLowStock: boolean;
  canEdit: boolean;
  sku?: string | null;
  variantCount?: number;
  imageUrl?: string | null;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ProductDetailHeader({
  locale,
  productId,
  name,
  isActive,
  currentStock,
  isLowStock,
  canEdit,
  sku = null,
  variantCount = 0,
  imageUrl = null,
}: ProductDetailHeaderProps) {
  const t = useTranslations("productPnl");

  const skuPart = sku ? `${t("header.skuLabel")} ${sku}` : null;
  const variantPart =
    variantCount > 0 ? t("header.variantsCount", { count: variantCount }) : null;
  const metaParts = [skuPart, variantPart].filter(Boolean) as string[];

  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-line-subtle bg-surface-card/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <Link
        href={`/${locale}/products`}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink-primary"
      >
        <span aria-hidden>‹</span>
        {t("backToProducts")}
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={name}
              className="h-12 w-12 flex-shrink-0 rounded-card border border-line-subtle object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-card border border-line-subtle bg-surface-page text-[14px] font-semibold uppercase text-ink-secondary"
            >
              {getInitials(name)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold leading-tight text-ink-primary">
              {name}
            </h1>
            {metaParts.length > 0 ? (
              <div className="mt-0.5 truncate text-[13px] text-ink-secondary">
                {metaParts.join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isActive ? "success" : "neutral"} dot>
            {isActive ? t("status.active") : t("status.inactive")}
          </Badge>
          <Badge tone={isLowStock ? "critical" : "neutral"} dot={isLowStock}>
            <span className="tabular-nums">
              {t("stock.label")} · {currentStock}
            </span>
            {isLowStock ? <span className="ms-1">· {t("stock.low")}</span> : null}
          </Badge>
          {canEdit ? (
            <Link
              href={`/${locale}/products/${productId}/edit`}
              className="inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface-card px-3 text-[13px] font-medium text-ink-primary transition-colors hover:bg-surface-hover"
            >
              {t("edit")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
