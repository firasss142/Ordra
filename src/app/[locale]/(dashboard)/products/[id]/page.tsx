"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useAuth } from "@/context/auth";
import { ProductDetailHeader } from "@/components/products/ProductDetailHeader";
import { ProductCostsReferenceCard } from "@/components/products/ProductCostsReferenceCard";
import { ProductRentabilityClient } from "@/components/products/ProductRentabilityClient";
import { StockHistoryPanel } from "@/components/products/StockHistoryPanel";
import { PeriodSelector } from "@/components/dashboard/MetricsTable";
import type { Period } from "@/components/dashboard/MetricsTable";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function todayPeriod(): Period {
  const d = new Date().toISOString().slice(0, 10);
  return { from_date: d, to_date: d };
}

interface ProductData {
  id: string;
  name: string;
  unit_cogs: number;
  packing_cost: number;
  cpl: number;
  confirmation_processing_cost: number | null;
  current_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  variants: {
    id: string;
    label: string;
    quantity: number;
    display_price: number;
    is_active: boolean;
  }[];
  is_low_stock: boolean;
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const locale = (params.locale as string) ?? "fr";
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>(todayPeriod);
  const t = useTranslations("productPnl");

  const canView =
    user?.role === "super_admin" ||
    user?.role === "market_manager" ||
    user?.role === "warehouse_agent";

  useEffect(() => {
    if (user && !canView) {
      router.replace(`/${locale}/products`);
    }
  }, [user, canView, locale, router]);

  const { data: productRes, isLoading: productLoading } = useSWR<{
    data: ProductData;
  }>(`/api/products/${productId}`, fetcher);

  const product = productRes?.data;

  const canViewProfitability =
    user?.role === "market_manager" || user?.role === "super_admin";

  if (user && !canView) return null;

  if (productLoading) {
    return (
      <div className="min-h-screen bg-surface-page p-4 sm:p-6 lg:p-8">
        <div className="py-16 text-center text-[14px] text-ink-secondary">
          {t("loading")}
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-surface-page p-4 sm:p-6 lg:p-8">
        <div className="py-16 text-center text-[14px] text-ink-secondary">
          {t("empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-page px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <ProductDetailHeader
        locale={locale}
        name={product.name}
        isActive={product.is_active}
        currentStock={product.current_stock}
        isLowStock={product.is_low_stock}
      />

      {canViewProfitability ? (
        <div className="mb-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-ink-primary">
              {t("rentabilityTitle")}
            </h2>
            <PeriodSelector period={period} onChange={setPeriod} />
          </div>

          <ProductRentabilityClient productId={productId} period={period} />
        </div>
      ) : null}

      {canViewProfitability ? (
        <section className="mb-6 rounded-card border border-line-subtle bg-surface-card p-5">
          <StockHistoryPanel productId={productId} />
        </section>
      ) : null}

      <ProductCostsReferenceCard
        unitCogs={Number(product.unit_cogs)}
        packingCost={Number(product.packing_cost)}
        cpl={Number(product.cpl)}
        processingCost={Number(product.confirmation_processing_cost ?? 0)}
        variants={product.variants}
      />
    </div>
  );
}
