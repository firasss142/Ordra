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
import { PeriodSelector, type Period } from "@/components/shared/PeriodSelector";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function todayPeriod(): Period {
  const d = new Date().toISOString().slice(0, 10);
  return { from_date: d, to_date: d };
}

interface ProductData {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  unit_cogs: number;
  packing_cost: number;
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

  const variantCount = product.variants.filter((v) => v.is_active).length;

  return (
    <div className="min-h-screen bg-surface-page px-4 pb-16 sm:px-6 lg:px-8">
      <ProductDetailHeader
        locale={locale}
        productId={productId}
        name={product.name}
        isActive={product.is_active}
        currentStock={product.current_stock}
        isLowStock={product.is_low_stock}
        canEdit={user?.role === "super_admin"}
        sku={product.sku}
        variantCount={variantCount}
        imageUrl={product.image_url}
      />

      <div className="mt-8 flex flex-col gap-8">
        {canViewProfitability ? (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[16px] font-semibold text-ink-primary">
                {t("rentabilityTitle")}
              </h2>
              <PeriodSelector period={period} onChange={setPeriod} />
            </div>
            <ProductRentabilityClient productId={productId} period={period} />
          </section>
        ) : null}

        <ProductCostsReferenceCard
          unitCogs={Number(product.unit_cogs)}
          packingCost={Number(product.packing_cost)}
          processingCost={Number(product.confirmation_processing_cost ?? 0)}
          variants={product.variants}
        />

        {canViewProfitability ? (
          <StockHistoryPanel productId={productId} locale={locale} />
        ) : null}
      </div>
    </div>
  );
}
