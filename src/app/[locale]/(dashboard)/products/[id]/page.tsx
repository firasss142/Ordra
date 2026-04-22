"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useAuth } from "@/context/auth";
import { ProductProfitability } from "@/components/products/ProductProfitability";
import { ProductPerformanceCard } from "@/components/products/ProductPerformanceCard";
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
  variants: { id: string; label: string; quantity: number; display_price: number; is_active: boolean }[];
  is_low_stock: boolean;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const valueStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: "#1A1A1A",
  marginTop: 2,
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const locale = (params.locale as string) ?? "fr";
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>(todayPeriod);

  const canView =
    user?.role === "super_admin" ||
    user?.role === "market_manager" ||
    user?.role === "warehouse_agent";

  useEffect(() => {
    if (user && !canView) {
      router.replace(`/${locale}/products`);
    }
  }, [user, canView, locale, router]);

  if (user && !canView) return null;

  const { data: productRes, isLoading: productLoading } = useSWR<{ data: ProductData }>(
    `/api/products/${productId}`,
    fetcher
  );

  const product = productRes?.data;

  const canViewProfitability =
    user?.role === "market_manager" || user?.role === "super_admin";

  if (productLoading) {
    return (
      <div style={{ padding: "64px 32px", textAlign: "center", fontSize: 14, color: "#6D7175" }}>
        Chargement…
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ padding: "64px 32px", textAlign: "center", fontSize: 14, color: "#6D7175" }}>
        Produit introuvable
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 24px 0",
        }}
      >
        {product.name}
      </h1>

      {/* Product info card */}
      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #D1D5DB",
          borderRadius: "0.5rem",
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
          <div>
            <div style={labelStyle}>Coût unitaire (COGS)</div>
            <div style={valueStyle}>{Number(product.unit_cogs).toFixed(3)}</div>
          </div>
          <div>
            <div style={labelStyle}>Coût emballage</div>
            <div style={valueStyle}>{Number(product.packing_cost).toFixed(3)}</div>
          </div>
          <div>
            <div style={labelStyle}>CPL</div>
            <div style={valueStyle}>{Number(product.cpl).toFixed(3)}</div>
          </div>
          <div>
            <div style={labelStyle}>Coût traitement</div>
            <div style={valueStyle}>{Number(product.confirmation_processing_cost ?? 0).toFixed(3)}</div>
          </div>
          <div>
            <div style={labelStyle}>Stock</div>
            <div
              style={{
                ...valueStyle,
                color: product.is_low_stock ? "#DC2626" : "#1A1A1A",
              }}
            >
              {product.current_stock}
              {product.is_low_stock && " (bas)"}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Statut</div>
            <div style={valueStyle}>{product.is_active ? "Actif" : "Inactif"}</div>
          </div>
        </div>

        {/* Variants */}
        {product.variants.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Variantes</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {product.variants
                .filter((v) => v.is_active)
                .map((v) => (
                  <span
                    key={v.id}
                    style={{
                      fontSize: 13,
                      padding: "4px 10px",
                      border: "1px solid #D1D5DB",
                      borderRadius: "0.25rem",
                      color: "#1A1A1A",
                      background: "#F9FAFB",
                    }}
                  >
                    {v.label} — ×{v.quantity} — {Number(v.display_price).toFixed(3)}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Stock history — managers and super_admin only */}
      {canViewProfitability && (
        <div
          style={{
            backgroundColor: "white",
            border: "1px solid #D1D5DB",
            borderRadius: "0.5rem",
            padding: 20,
            marginBottom: 24,
          }}
        >
          <StockHistoryPanel productId={productId} />
        </div>
      )}

      {/* Rentabilité section — managers and super_admin only */}
      {canViewProfitability && (
        <>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#1A1A1A",
              margin: "0 0 16px 0",
            }}
          >
            Rentabilité
          </h2>

          {/* Shared period selector — drives both cards */}
          <PeriodSelector period={period} onChange={setPeriod} />

          {/* Performance KPI card */}
          <div style={{ marginBottom: 24 }}>
            <ProductPerformanceCard productId={productId} period={period} />
          </div>

          {/* Full profitability breakdown */}
          <ProductProfitability productId={productId} period={period} />
        </>
      )}
    </div>
  );
}
