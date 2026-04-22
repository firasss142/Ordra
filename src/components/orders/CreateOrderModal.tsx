"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type FocusTrapType from "focus-trap-react";
import type { Role } from "@/types";
import {
  TUNISIAN_GOVERNORATES,
  LIBYAN_GOVERNORATES,
} from "@/lib/carriers/governorates";

const FocusTrap = dynamic(
  () => import("focus-trap-react"),
  { ssr: false },
) as typeof FocusTrapType;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Storefront {
  id: string;
  name: string;
  platform: string;
  is_active: boolean;
}

interface Product {
  id: string;
  name: string;
  market_id: string;
  is_active?: boolean;
  current_stock?: number;
  default_price?: number | null;
}

interface ProductVariant {
  id: string;
  product_id: string;
  label: string;
  quantity: number;
  display_price: number;
  is_active: boolean;
}

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: Role;
  userMarketId: string;
  onCreated: (orderId: string) => void;
}

interface FormState {
  market_id: string;
  storefront_id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  customer_address: string;
  customer_note: string;
  product_id: string;
  variant_id: string;
  variant_label: string;
  quantity: string;
  unit_price: string;
  total_price: string;
  total_price_touched: boolean;
  loading: boolean;
  error: string | null;
}

function emptyForm(marketId: string): FormState {
  return {
    market_id: marketId,
    storefront_id: "",
    customer_name: "",
    customer_phone: "",
    customer_city: "",
    customer_address: "",
    customer_note: "",
    product_id: "",
    variant_id: "",
    variant_label: "",
    quantity: "1",
    unit_price: "",
    total_price: "",
    total_price_touched: false,
    loading: false,
    error: null,
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid #E1E3E5",
  borderRadius: 4,
  boxSizing: "border-box",
  background: "white",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6D7175",
  display: "block",
  marginBottom: 4,
};

function formatPrice(value: number): string {
  return value.toFixed(3);
}

export function CreateOrderModal({
  isOpen,
  onClose,
  role,
  userMarketId,
  onCreated,
}: CreateOrderModalProps) {
  const t = useTranslations("orders.create");
  const modalRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(userMarketId));

  const isSuperAdmin = role === "super_admin";

  // Fetch markets for both roles so we can read the market's code (needed for
  // the city dropdown: Tunisia vs Libya governorate list).
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isOpen ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  // Auto-seed market for super_admin once markets are loaded
  useEffect(() => {
    if (!isOpen) return;
    if (isSuperAdmin && !form.market_id && markets.length > 0) {
      setForm((s) => ({ ...s, market_id: markets[0].id }));
    }
  }, [isOpen, isSuperAdmin, form.market_id, markets]);

  // For non-super-admin roles, keep the market_id locked to the user's market
  useEffect(() => {
    if (!isOpen) return;
    if (!isSuperAdmin && form.market_id !== userMarketId) {
      setForm((s) => ({ ...s, market_id: userMarketId }));
    }
  }, [isOpen, isSuperAdmin, userMarketId, form.market_id]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm(isSuperAdmin ? "" : userMarketId));
    }
  }, [isOpen, isSuperAdmin, userMarketId]);

  const effectiveMarketId = form.market_id;
  const currentMarket = markets.find((m) => m.id === effectiveMarketId);
  const marketCode = currentMarket?.code;

  const { data: storefrontsData } = useSWR<{ data: Storefront[] }>(
    isOpen && effectiveMarketId
      ? `/api/storefronts?market_id=${effectiveMarketId}`
      : null,
    fetcher,
  );
  const storefronts = (storefrontsData?.data ?? []).filter(
    (s) => s.is_active !== false,
  );

  const { data: productsData } = useSWR<{ data: Product[] }>(
    isOpen && effectiveMarketId
      ? `/api/products?market_id=${effectiveMarketId}`
      : null,
    fetcher,
  );
  // Only show active products in the picker — inactive SKUs shouldn't be sold.
  const products = (productsData?.data ?? []).filter(
    (p) => p.is_active !== false,
  );

  // Load variants for the selected product
  const { data: variantsData } = useSWR<{ data: ProductVariant[] }>(
    isOpen && form.product_id
      ? `/api/products/${form.product_id}/variants`
      : null,
    fetcher,
  );
  const variants = (variantsData?.data ?? []).filter(
    (v) => v.is_active !== false,
  );

  // Auto-compute total unless user touched it
  useEffect(() => {
    if (form.total_price_touched) return;
    const q = parseFloat(form.quantity);
    const up = parseFloat(form.unit_price);
    if (!Number.isNaN(q) && !Number.isNaN(up)) {
      const computed = formatPrice(q * up);
      setForm((s) =>
        s.total_price === computed ? s : { ...s, total_price: computed },
      );
    }
  }, [form.quantity, form.unit_price, form.total_price_touched]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !form.loading) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose, form.loading]);

  // City options from governorate list (market-specific)
  const cityOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    if (marketCode === "tn") {
      return TUNISIAN_GOVERNORATES.map((g) => ({ value: g, label: g }));
    }
    if (marketCode === "ly") {
      return LIBYAN_GOVERNORATES.map((g) => ({
        value: g.fr,
        label: `${g.fr} — ${g.ar}`,
      }));
    }
    return [];
  }, [marketCode]);

  if (!isOpen) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value, error: null }));
  }

  function handleProductChange(productId: string) {
    // Switching product → reset variant and seed prices from product.default_price
    // (variant selection overrides this downstream).
    const p = products.find((x) => x.id === productId);
    const basePrice =
      p && typeof p.default_price === "number" && p.default_price >= 0
        ? p.default_price
        : null;
    setForm((s) => {
      const qty = parseInt(s.quantity, 10);
      const unit = basePrice !== null ? formatPrice(basePrice) : "";
      const total =
        basePrice !== null && Number.isInteger(qty) && qty > 0
          ? formatPrice(basePrice * qty)
          : "";
      return {
        ...s,
        product_id: productId,
        variant_id: "",
        variant_label: "",
        unit_price: unit,
        total_price: total,
        total_price_touched: false,
        error: null,
      };
    });
  }

  function handleVariantChange(variantId: string) {
    const v = variants.find((x) => x.id === variantId);
    if (!v) {
      setForm((s) => ({
        ...s,
        variant_id: "",
        variant_label: "",
        error: null,
      }));
      return;
    }
    setForm((s) => ({
      ...s,
      variant_id: v.id,
      variant_label: v.label,
      quantity: String(v.quantity),
      unit_price: formatPrice(v.display_price),
      total_price: formatPrice(v.quantity * v.display_price),
      total_price_touched: false,
      error: null,
    }));
  }

  async function handleSubmit() {
    if (!form.market_id) {
      update("error", t("errors.marketRequired"));
      return;
    }
    if (!form.storefront_id) {
      update("error", t("errors.storefrontRequired"));
      return;
    }
    if (!form.customer_name.trim()) {
      update("error", t("errors.customerNameRequired"));
      return;
    }
    if (!form.customer_phone.trim()) {
      update("error", t("errors.customerPhoneRequired"));
      return;
    }
    if (!form.product_id) {
      update("error", t("errors.productRequired"));
      return;
    }
    const qty = parseInt(form.quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) {
      update("error", t("errors.quantityInvalid"));
      return;
    }
    const unit = parseFloat(form.unit_price);
    if (Number.isNaN(unit) || unit < 0) {
      update("error", t("errors.unitPriceInvalid"));
      return;
    }
    const total = parseFloat(form.total_price);
    if (Number.isNaN(total) || total < 0) {
      update("error", t("errors.totalPriceInvalid"));
      return;
    }

    const product = products.find((p) => p.id === form.product_id);
    if (!product) {
      update("error", t("errors.productRequired"));
      return;
    }

    setForm((s) => ({ ...s, loading: true, error: null }));

    const body: Record<string, unknown> = {
      market_id: form.market_id,
      storefront_id: form.storefront_id,
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      customer_city: form.customer_city.trim() || null,
      customer_address: form.customer_address.trim() || null,
      customer_note: form.customer_note.trim() || null,
      product_id: form.product_id,
      product_name: product.name,
      variant_label: form.variant_label.trim() || null,
      quantity: qty,
      unit_price: unit,
      total_price: total,
    };

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setForm((s) => ({
        ...s,
        loading: false,
        error: json.error ?? `Erreur ${res.status}`,
      }));
      return;
    }

    const json = await res.json().catch(() => ({}));
    const orderId = (json?.data?.id as string) ?? "";
    setForm((s) => ({ ...s, loading: false }));
    onCreated(orderId);
    onClose();
  }

  const productsEmptyHint =
    effectiveMarketId && productsData && products.length === 0
      ? t("emptyProducts")
      : null;

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(26,26,26,0.4)",
          zIndex: 40,
        }}
        onClick={() => !form.loading && onClose()}
      />
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          fallbackFocus: () => modalRef.current ?? document.body,
        }}
      >
        <div
          ref={modalRef}
          tabIndex={-1}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: "0.5rem",
            padding: 24,
            zIndex: 50,
            width: 520,
            maxHeight: "90vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
            {t("modalTitle")}
          </div>

          {isSuperAdmin && (
            <div>
              <label style={labelStyle}>{t("fields.market")} *</label>
              <select
                value={form.market_id}
                onChange={(e) => update("market_id", e.target.value)}
                style={inputStyle}
              >
                <option value="">—</option>
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={labelStyle}>{t("fields.storefront")} *</label>
            <select
              value={form.storefront_id}
              onChange={(e) => update("storefront_id", e.target.value)}
              style={inputStyle}
              disabled={!effectiveMarketId}
            >
              <option value="">—</option>
              {storefronts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.platform})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("fields.customerName")} *</label>
              <input
                type="text"
                value={form.customer_name}
                onChange={(e) => update("customer_name", e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("fields.customerPhone")} *</label>
              <input
                type="text"
                value={form.customer_phone}
                onChange={(e) => update("customer_phone", e.target.value)}
                style={inputStyle}
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t("fields.customerCity")}</label>
            {cityOptions.length > 0 ? (
              <select
                value={form.customer_city}
                onChange={(e) => update("customer_city", e.target.value)}
                style={inputStyle}
              >
                <option value="">—</option>
                {cityOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.customer_city}
                onChange={(e) => update("customer_city", e.target.value)}
                style={inputStyle}
              />
            )}
          </div>

          <div>
            <label style={labelStyle}>{t("fields.customerAddress")}</label>
            <textarea
              value={form.customer_address}
              onChange={(e) => update("customer_address", e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={labelStyle}>{t("fields.customerNote")}</label>
            <textarea
              value={form.customer_note}
              onChange={(e) => update("customer_note", e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={labelStyle}>{t("fields.product")} *</label>
            <select
              value={form.product_id}
              onChange={(e) => handleProductChange(e.target.value)}
              style={inputStyle}
              disabled={!effectiveMarketId}
            >
              <option value="">—</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {productsEmptyHint && (
              <div
                style={{ fontSize: 12, color: "#6D7175", marginTop: 4 }}
              >
                {productsEmptyHint}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>{t("fields.variantLabel")}</label>
            {variants.length > 0 ? (
              <select
                value={form.variant_id}
                onChange={(e) => handleVariantChange(e.target.value)}
                style={inputStyle}
              >
                <option value="">—</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} — {v.quantity}× · {formatPrice(v.display_price)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.variant_label}
                onChange={(e) => update("variant_label", e.target.value)}
                style={inputStyle}
                disabled={!form.product_id}
                placeholder={form.product_id ? t("noVariants") : ""}
              />
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 100 }}>
              <label style={labelStyle}>{t("fields.quantity")} *</label>
              <input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => update("quantity", e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("fields.unitPrice")} *</label>
              <input
                type="number"
                step="0.001"
                min={0}
                value={form.unit_price}
                onChange={(e) => update("unit_price", e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("fields.totalPrice")} *</label>
              <input
                type="number"
                step="0.001"
                min={0}
                value={form.total_price}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    total_price: e.target.value,
                    total_price_touched: true,
                    error: null,
                  }))
                }
                style={inputStyle}
              />
            </div>
          </div>

          {form.error && (
            <div style={{ fontSize: 12, color: "#DC2626" }}>{form.error}</div>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <button
              onClick={onClose}
              disabled={form.loading}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                border: "1px solid #E1E3E5",
                borderRadius: 4,
                background: "white",
                cursor: form.loading ? "not-allowed" : "pointer",
              }}
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={form.loading}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                border: "none",
                borderRadius: 4,
                background: "#1A1A1A",
                color: "white",
                cursor: form.loading ? "not-allowed" : "pointer",
              }}
            >
              {form.loading ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}
