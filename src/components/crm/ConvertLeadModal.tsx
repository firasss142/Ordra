"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import type { Lead } from "@/types/lead";

interface Product {
  id: string;
  name: string;
  default_price?: number | null;
}

interface Variant {
  id: string;
  product_id: string;
  label: string;
  quantity: number;
  display_price?: number | null;
}

interface Props {
  open: boolean;
  lead: Lead | null;
  locale: string;
  onClose: () => void;
  onConverted: (orderId: string) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6D7175",
  display: "block",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ConvertLeadModal({
  open,
  lead,
  locale,
  onClose,
  onConverted,
}: Props) {
  const t = useTranslations("crm.leads.convert");

  const { data: productsData } = useSWR<{ data: Product[] }>(
    open && lead ? `/api/products?market_id=${lead.market_id}&is_active=true` : null,
    fetcher
  );
  const products = productsData?.data ?? [];

  const [productId, setProductId] = useState<string>("");
  const [variantId, setVariantId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const [totalTouched, setTotalTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );

  const { data: variantsData } = useSWR<{ data: Variant[] }>(
    open && productId ? `/api/products/${productId}/variants` : null,
    fetcher
  );
  const variants = variantsData?.data ?? [];

  // Seed product from lead's product_interest_id on open
  useEffect(() => {
    if (!open || !lead) return;
    setProductId(lead.product_interest_id ?? "");
    setVariantId("");
    setQuantity(1);
    setUnitPrice(0);
    setTotalPrice(0);
    setTotalTouched(false);
    setErr(null);
    setBusy(false);
  }, [open, lead]);

  // Compute default price when product/variant changes
  useEffect(() => {
    if (!selectedProduct) return;
    const variant = variants.find((v) => v.id === variantId);
    const basePrice =
      variant?.display_price ?? selectedProduct.default_price ?? 0;
    setUnitPrice(basePrice);
    if (!totalTouched) {
      const qty = variant?.quantity ?? quantity;
      setTotalPrice(Math.round(basePrice * qty * 1000) / 1000);
    }
  }, [selectedProduct, variantId, variants, quantity, totalTouched]);

  if (!open || !lead) return null;

  async function submit() {
    setErr(null);
    if (!productId && !selectedProduct) {
      return setErr(t("errors.productRequired"));
    }
    if (quantity <= 0) return setErr(t("errors.quantityPositive"));
    if (totalPrice < 0) return setErr(t("errors.priceNonNegative"));

    setBusy(true);
    try {
      const variant = variants.find((v) => v.id === variantId);
      const res = await fetch(`/api/leads/${lead!.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId || null,
          product_name: selectedProduct?.name ?? "—",
          variant_label: variant?.label ?? null,
          quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
          customer_name: lead!.customer_name,
          customer_phone: lead!.customer_phone,
          customer_address: lead!.customer_address,
          customer_city: lead!.customer_city,
          customer_note: lead!.notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || t("errors.generic"));
        setBusy(false);
        return;
      }
      onConverted(json.data.orderId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.generic"));
      setBusy(false);
    }
  }

  const isRtl = locale === "ar";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(26,26,26,0.4)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 64,
        paddingBottom: 24,
        overflowY: "auto",
        direction: isRtl ? "rtl" : "ltr",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "92vw",
          background: "white",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <h2
            style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#1A1A1A" }}
          >
            {t("title")}
          </h2>
          <div style={{ fontSize: 13, color: "#6D7175", marginTop: 4 }}>
            {t("subtitle")}
          </div>
        </div>

        {/* Pre-filled customer — read-only summary */}
        <div
          style={{
            background: "#F6F6F7",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
            color: "#1A1A1A",
          }}
        >
          <div style={{ fontWeight: 500 }}>{lead.customer_name}</div>
          <div style={{ color: "#6B7280" }}>
            {lead.customer_phone}
            {lead.customer_city && ` · ${lead.customer_city}`}
          </div>
          {lead.customer_address && (
            <div style={{ color: "#6B7280" }}>{lead.customer_address}</div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t("product")}</label>
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setVariantId("");
              setTotalTouched(false);
            }}
            style={inputStyle}
          >
            <option value="">—</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {variants.length > 0 && (
          <div>
            <label style={labelStyle}>{t("variant")}</label>
            <select
              value={variantId}
              onChange={(e) => {
                setVariantId(e.target.value);
                setTotalTouched(false);
              }}
              style={inputStyle}
            >
              <option value="">—</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("quantity")}</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => {
                const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                setQuantity(v);
                if (!totalTouched) {
                  setTotalPrice(Math.round(unitPrice * v * 1000) / 1000);
                }
              }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("unitPrice")}</label>
            <input
              type="number"
              step="0.001"
              min={0}
              value={unitPrice}
              onChange={(e) => {
                const v = Number(e.target.value);
                setUnitPrice(v);
                if (!totalTouched) {
                  setTotalPrice(Math.round(v * quantity * 1000) / 1000);
                }
              }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("totalPrice")}</label>
            <input
              type="number"
              step="0.001"
              min={0}
              value={totalPrice}
              onChange={(e) => {
                setTotalTouched(true);
                setTotalPrice(Number(e.target.value));
              }}
              style={inputStyle}
            />
          </div>
        </div>

        {err && <div style={{ fontSize: 12, color: "#DC2626" }}>{err}</div>}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: isRtl ? "flex-start" : "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              background: "white",
              color: "#1A1A1A",
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {locale === "ar" ? "إلغاء" : "Annuler"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              background: busy ? "#9CA3AF" : "#1A1A1A",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? t("submitting") : t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
