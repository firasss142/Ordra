"use client";

import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { calculateProductProfitability } from "@/lib/calculations/product-profitability";
import { ProductImagePicker } from "./ProductImagePicker";
import type { Role } from "@/types";

interface Market {
  id: string;
  name: string;
}

interface ProductCreateFormProps {
  role: Role;
  markets: Market[];
  defaultMarketId: string;
  locale: string;
  lockedMarketId?: string | null;
}

const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const BORDER = "#E1E3E5";

const labelStyle: React.CSSProperties = { fontSize: 13, color: MUTED, display: "block", marginBottom: 4, fontWeight: 500 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, boxSizing: "border-box", color: TEXT };
const hintStyle: React.CSSProperties = { fontSize: 12, color: MUTED, marginTop: 3 };
const sectionStyle: React.CSSProperties = { borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 20 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 14 };

export function ProductCreateForm({ markets, defaultMarketId, locale, lockedMarketId }: ProductCreateFormProps) {
  const t = useTranslations("products");
  const router = useRouter();

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [marketId, setMarketId] = useState(lockedMarketId ?? defaultMarketId);
  const [unitCogs, setUnitCogs] = useState("");
  const [packingCost, setPackingCost] = useState("");
  const [processingCost, setProcessingCost] = useState("");
  const [initialStock, setInitialStock] = useState("0");
  const [threshold, setThreshold] = useState("5");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live cost example using typed values + reference scenario (100 leads, 60 confirmed, 40 delivered)
  const example = useMemo(() => {
    const uCogs = parseFloat(unitCogs) || 0;
    const pCost = parseFloat(packingCost) || 0;
    const procCost = parseFloat(processingCost) || 0;
    const price = parseFloat(defaultPrice) || 120;
    const result = calculateProductProfitability({
      totalLeads: 100,
      confirmedCount: 60,
      dispatchedCount: 45,
      deliveredCount: 40,
      returnedCount: 5,
      unitCogs: uCogs,
      packingCost: pCost,
      confirmationProcessingCost: procCost,
      deliveredOrders: Array(40).fill({ total_price: price, quantity: 1, carrier_delivery_fee: 7 }),
      returnedOrders: Array(5).fill({ carrier_return_fee: 4 }),
      adSpend: 0,
    });
    const marginPct = result.revenue === 0 ? 0 : Math.round((result.simplifiedNetProfit / result.revenue) * 1000) / 10;
    return { margin: marginPct, price };
  }, [unitCogs, packingCost, processingCost, defaultPrice]);

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) { setError("Le nom est obligatoire."); return; }
    const unitCogsNum = parseFloat(unitCogs);
    if (isNaN(unitCogsNum) || unitCogsNum < 0) { setError("COGS unitaire invalide."); return; }

    setLoading(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      unit_cogs: unitCogsNum,
      packing_cost: parseFloat(packingCost) || 0,
      confirmation_processing_cost: parseFloat(processingCost) || 0,
      low_stock_threshold: parseInt(threshold, 10) || 5,
      initial_stock: parseInt(initialStock, 10) || 0,
      market_id: marketId,
    };
    const trimmedSku = sku.trim();
    if (trimmedSku !== "") body.sku = trimmedSku;
    if (defaultPrice.trim() !== "") {
      const dp = parseFloat(defaultPrice);
      if (!isNaN(dp) && dp >= 0) body.default_price = dp;
    }

    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg = res.status === 409 ? t("create.errors.skuConflict") : (json.error ?? `Erreur ${res.status}`);
      setError(msg);
      setLoading(false);
      return;
    }

    const json = await res.json();
    const newId = json?.data?.id;

    // Upload the picked image now that the product (and its ID) exists.
    if (newId && image) {
      const imgRes = await fetch(`/api/products/${newId}/image`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data_url: image }),
      });
      if (!imgRes.ok) {
        // Product was created; only the image failed. Surface it but still
        // land on the detail page so the user can retry from the edit form.
        setError(t("image.uploadFailed"));
        router.push(`/${locale}/products/${newId}`);
        return;
      }
    }

    if (newId) {
      router.push(`/${locale}/products/${newId}`);
    } else {
      router.push(`/${locale}/products`);
    }
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 6px 0" }}>
        {t("create.title")}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 24px 0" }}>
        {t("create.intro")}
      </p>

      {/* Section 1: Identity */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>{t("create.sections.identity")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="product-name" style={labelStyle}>
              Nom du produit *
            </label>
            <input
              id="product-name"
              aria-label="Nom du produit"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Chaussures Sport"
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="product-sku" style={labelStyle}>
              {t("create.fields.sku")}
            </label>
            <input
              id="product-sku"
              aria-label={t("create.fields.sku")}
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="bv-01"
              style={inputStyle}
            />
            <p style={hintStyle}>{t("create.hints.sku")}</p>
          </div>

          <ProductImagePicker value={image} onChange={setImage} />

          {markets.length > 1 && !lockedMarketId && (
            <div>
              <label htmlFor="market-select" style={labelStyle}>Marché</label>
              <select
                id="market-select"
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
                style={inputStyle}
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Cost model */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>{t("create.sections.costModel")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="unit-cogs" aria-label="COGS" style={labelStyle}>
              COGS unitaire *
            </label>
            <input
              id="unit-cogs"
              aria-label="COGS unitaire"
              type="number"
              min="0"
              step="0.001"
              value={unitCogs}
              onChange={(e) => setUnitCogs(e.target.value)}
              placeholder="0.000"
              style={inputStyle}
            />
            <p style={hintStyle}>{t("create.hints.unitCogs")}</p>
          </div>

          <div>
            <label htmlFor="packing-cost" style={labelStyle}>Coût d&apos;emballage</label>
            <input
              id="packing-cost"
              type="number"
              min="0"
              step="0.001"
              value={packingCost}
              onChange={(e) => setPackingCost(e.target.value)}
              placeholder="0.000"
              style={inputStyle}
            />
            <p style={hintStyle}>{t("create.hints.packingCost")}</p>
          </div>

          <div>
            <label htmlFor="processing-cost" style={labelStyle}>Coût de traitement</label>
            <input
              id="processing-cost"
              type="number"
              min="0"
              step="0.001"
              value={processingCost}
              onChange={(e) => setProcessingCost(e.target.value)}
              placeholder="0.000"
              style={inputStyle}
            />
            <p style={hintStyle}>{t("create.hints.processingCost")}</p>
          </div>

          {/* Live cost example */}
          <div
            data-testid="cost-example"
            style={{ background: "#F6F6F7", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "10px 14px", fontSize: 12, color: MUTED }}
          >
            {t("create.example", {
              price: example.price.toFixed(0),
              margin: `${example.margin > 0 ? "+" : ""}${example.margin}%`,
            })}
          </div>
        </div>
      </div>

      {/* Section 3: Inventory */}
      <div style={{ ...sectionStyle, borderBottom: "none", marginBottom: 24 }}>
        <div style={sectionTitleStyle}>{t("create.sections.inventory")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="initial-stock" style={labelStyle}>Stock initial</label>
            <input
              id="initial-stock"
              type="number"
              min="0"
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="threshold" style={labelStyle}>Seuil stock bas</label>
            <input
              id="threshold"
              type="number"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              style={inputStyle}
            />
            <p style={hintStyle}>{t("create.hints.threshold")}</p>
          </div>
          <div>
            <label htmlFor="default-price" style={labelStyle}>Prix de vente (optionnel)</label>
            <input
              id="default-price"
              type="number"
              min="0"
              step="0.001"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
              placeholder="0.000"
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "#DC2626", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/products`)}
          disabled={loading}
          style={{ padding: "8px 16px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, background: "white", cursor: "pointer" }}
        >
          {t("create.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            borderRadius: 4,
            background: TEXT,
            color: "white",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Enregistrement…" : t("create.submit")}
        </button>
      </div>
    </div>
  );
}
