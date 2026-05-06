"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

interface EditableProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number | null;
  default_price: number | null;
  low_stock_threshold: number;
  is_active: boolean;
}

interface Props {
  product: EditableProduct;
  locale: string;
}

const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const BORDER = "#E1E3E5";

const labelStyle: React.CSSProperties = { fontSize: 13, color: MUTED, display: "block", marginBottom: 4, fontWeight: 500 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, boxSizing: "border-box", color: TEXT };
const sectionStyle: React.CSSProperties = { borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 20 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 14 };
const hintStyle: React.CSSProperties = { fontSize: 12, color: MUTED, marginTop: 3 };

function numberOrEmpty(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(n);
}

export function ProductEditForm({ product, locale }: Props) {
  const t = useTranslations("products");
  const router = useRouter();

  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [imageUrl, setImageUrl] = useState(product.image_url ?? "");
  const [unitCogs, setUnitCogs] = useState(numberOrEmpty(product.unit_cogs));
  const [packingCost, setPackingCost] = useState(numberOrEmpty(product.packing_cost));
  const [processingCost, setProcessingCost] = useState(numberOrEmpty(product.confirmation_processing_cost));
  const [defaultPrice, setDefaultPrice] = useState(numberOrEmpty(product.default_price));
  const [threshold, setThreshold] = useState(numberOrEmpty(product.low_stock_threshold));
  const [isActive, setIsActive] = useState(product.is_active);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("editForm.errors.nameRequired"));
      return;
    }

    const unitCogsNum = parseFloat(unitCogs);
    if (isNaN(unitCogsNum) || unitCogsNum < 0) {
      setError(t("editForm.errors.unitCogsInvalid"));
      return;
    }

    const thresholdNum = parseInt(threshold, 10);
    if (isNaN(thresholdNum) || thresholdNum < 0) {
      setError(t("editForm.errors.thresholdInvalid"));
      return;
    }

    setLoading(true);

    const body: Record<string, unknown> = {
      name: trimmedName,
      sku: sku.trim(),
      description: description.trim(),
      image_url: imageUrl.trim(),
      unit_cogs: unitCogsNum,
      packing_cost: parseFloat(packingCost) || 0,
      confirmation_processing_cost: parseFloat(processingCost) || 0,
      low_stock_threshold: thresholdNum,
      is_active: isActive,
    };

    if (defaultPrice.trim() !== "") {
      const dp = parseFloat(defaultPrice);
      if (!isNaN(dp) && dp >= 0) body.default_price = dp;
    } else {
      body.default_price = null;
    }

    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg = res.status === 409 ? t("editForm.errors.skuConflict") : (json.error ?? `Erreur ${res.status}`);
      setError(msg);
      setLoading(false);
      return;
    }

    router.push(`/${locale}/products/${product.id}`);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 6px 0" }}>
        {t("editForm.title")}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 24px 0" }}>{t("editForm.intro")}</p>

      {/* Identity */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>{t("create.sections.identity")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="edit-name" style={labelStyle}>{t("editForm.fields.name")} *</label>
            <input id="edit-name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-sku" style={labelStyle}>{t("editForm.fields.sku")}</label>
            <input
              id="edit-sku"
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="bv-01"
              style={inputStyle}
            />
            <p style={hintStyle}>{t("editForm.hints.sku")}</p>
          </div>
          <div>
            <label htmlFor="edit-description" style={labelStyle}>{t("editForm.fields.description")}</label>
            <textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
          <div>
            <label htmlFor="edit-image-url" style={labelStyle}>{t("editForm.fields.imageUrl")}</label>
            <input
              id="edit-image-url"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              style={inputStyle}
            />
            {imageUrl.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt=""
                style={{ marginTop: 8, maxHeight: 120, borderRadius: 4, border: `1px solid ${BORDER}` }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Cost model */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>{t("create.sections.costModel")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="edit-unit-cogs" style={labelStyle}>{t("editForm.fields.unitCogs")} *</label>
            <input id="edit-unit-cogs" type="number" min="0" step="0.001" value={unitCogs} onChange={(e) => setUnitCogs(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.unitCogs")}</p>
          </div>
          <div>
            <label htmlFor="edit-packing-cost" style={labelStyle}>{t("editForm.fields.packingCost")}</label>
            <input id="edit-packing-cost" type="number" min="0" step="0.001" value={packingCost} onChange={(e) => setPackingCost(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.packingCost")}</p>
          </div>
          <div>
            <label htmlFor="edit-processing-cost" style={labelStyle}>{t("editForm.fields.processingCost")}</label>
            <input id="edit-processing-cost" type="number" min="0" step="0.001" value={processingCost} onChange={(e) => setProcessingCost(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.processingCost")}</p>
          </div>
        </div>
      </div>

      {/* Inventory & status */}
      <div style={{ ...sectionStyle, borderBottom: "none", marginBottom: 24 }}>
        <div style={sectionTitleStyle}>{t("editForm.sections.inventoryAndStatus")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="edit-threshold" style={labelStyle}>{t("editForm.fields.threshold")}</label>
            <input id="edit-threshold" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.threshold")}</p>
          </div>
          <div>
            <label htmlFor="edit-default-price" style={labelStyle}>{t("editForm.fields.defaultPrice")}</label>
            <input id="edit-default-price" type="number" min="0" step="0.001" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} style={inputStyle} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT, cursor: "pointer" }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("editForm.fields.isActive")}
          </label>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "#DC2626", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/products/${product.id}`)}
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
          {loading ? t("editForm.saving") : t("editForm.submit")}
        </button>
      </div>
    </div>
  );
}
