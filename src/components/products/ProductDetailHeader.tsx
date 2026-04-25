"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";

interface ProductDetailHeaderProps {
  locale: string;
  name: string;
  isActive: boolean;
  currentStock: number;
  isLowStock: boolean;
}

export function ProductDetailHeader({
  locale,
  name,
  isActive,
  currentStock,
  isLowStock,
}: ProductDetailHeaderProps) {
  const t = useTranslations("productPnl");

  return (
    <div className="mb-6">
      <Link
        href={`/${locale}/products`}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary hover:text-ink-primary transition-colors"
      >
        <span aria-hidden>‹</span>
        {t("backToProducts")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold leading-tight text-ink-primary">
          {name}
        </h1>
        <div className="flex items-center gap-2">
          <Badge tone={isActive ? "success" : "neutral"} dot>
            {isActive ? t("status.active") : t("status.inactive")}
          </Badge>
          <Badge tone={isLowStock ? "critical" : "neutral"} dot={isLowStock}>
            <span className="tabular-nums">
              {t("stock.label")} · {currentStock}
            </span>
            {isLowStock ? <span className="ms-1">· {t("stock.low")}</span> : null}
          </Badge>
        </div>
      </div>
    </div>
  );
}
