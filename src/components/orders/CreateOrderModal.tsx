"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { X, AlertCircle } from "lucide-react";
import type FocusTrapType from "focus-trap-react";
import type { Role } from "@/types";
import {
  TUNISIAN_GOVERNORATES,
  LIBYAN_GOVERNORATES,
} from "@/lib/carriers/governorates";
import { useMarketScope } from "@/context/market-scope";

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

const inputClass =
  "w-full h-10 px-3 text-[13.5px] rounded-card border border-line-subtle bg-surface-card text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-ink-primary focus:ring-2 focus:ring-accent/20 disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed transition-colors duration-fast";

const textareaClass =
  "w-full px-3 py-2 text-[13.5px] rounded-card border border-line-subtle bg-surface-card text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-ink-primary focus:ring-2 focus:ring-accent/20 resize-y transition-colors duration-fast";

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[12px] font-medium text-ink-secondary mb-1">
      {children}
      {required && <span className="text-status-critical ms-0.5">*</span>}
    </label>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-card border border-line-subtle rounded-card">
      <div className="px-4 pt-3.5 pb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">
          {title}
        </h3>
      </div>
      <div className="px-4 pb-4 pt-1 flex flex-col gap-3">{children}</div>
    </section>
  );
}

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
  const { scope, marketId: scopedMarketId } = useMarketScope();
  const [form, setForm] = useState<FormState>(() => emptyForm(userMarketId));

  const isSuperAdmin = role === "super_admin";

  // Fetch markets for both roles so we can read the market's code (needed for
  // the city dropdown: Tunisia vs Libya governorate list).
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isOpen ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  // Seed super_admin market from the active sidebar scope. When scope === "all"
  // we leave it blank and require an explicit pick — "all" is a viewing scope,
  // not a creation scope.
  useEffect(() => {
    if (!isOpen) return;
    if (!isSuperAdmin) return;
    const desired = scope === "all" ? "" : scopedMarketId ?? "";
    if (form.market_id !== desired) {
      setForm((s) => ({ ...s, market_id: desired }));
    }
  }, [isOpen, isSuperAdmin, scope, scopedMarketId, form.market_id]);

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
      const seed = isSuperAdmin
        ? scope === "all"
          ? ""
          : scopedMarketId ?? ""
        : userMarketId;
      setForm(emptyForm(seed));
    }
  }, [isOpen, isSuperAdmin, userMarketId, scope, scopedMarketId]);

  const effectiveMarketId = form.market_id;
  const currentMarket = markets.find((m) => m.id === effectiveMarketId);
  const marketCode = currentMarket?.code;
  const marketSelectLocked = Boolean(form.market_id);

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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-ink-primary/40 animate-[fadeInUp_120ms_ease-out]"
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-order-title"
          className="fixed top-0 end-0 h-full w-full sm:w-[520px] lg:w-[560px] z-50 flex flex-col overflow-hidden bg-surface-page border-s border-line-subtle shadow-panel animate-[slideInEnd_180ms_ease-out]"
        >
          {/* Sticky Header */}
          <div className="bg-surface-card border-b border-line-subtle flex-shrink-0">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <h2 id="create-order-title" className="text-[16px] font-semibold text-ink-primary leading-tight">
                  {t("modalTitle")}
                </h2>
                <p className="text-[12px] text-ink-secondary mt-0.5">{t("modalSubtitle")}</p>
              </div>
              <button
                type="button"
                onClick={() => !form.loading && onClose()}
                disabled={form.loading}
                aria-label={t("cancel")}
                className="inline-flex items-center justify-center w-8 h-8 rounded-card text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50 flex-shrink-0"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
            <FormSection title={t("sectionContext")}>
              {isSuperAdmin && (
                  <div>
                    <FieldLabel required>{t("fields.market")}</FieldLabel>
                    <select
                      value={form.market_id}
                      onChange={(e) => update("market_id", e.target.value)}
                      className={inputClass}
                      disabled={marketSelectLocked}
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
                <FieldLabel required>{t("fields.storefront")}</FieldLabel>
                <select
                  value={form.storefront_id}
                  onChange={(e) => update("storefront_id", e.target.value)}
                  className={inputClass}
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
            </FormSection>

            <FormSection title={t("sectionCustomer")}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel required>{t("fields.customerName")}</FieldLabel>
                  <input
                    type="text"
                    value={form.customer_name}
                    onChange={(e) => update("customer_name", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <FieldLabel required>{t("fields.customerPhone")}</FieldLabel>
                  <input
                    type="text"
                    value={form.customer_phone}
                    onChange={(e) => update("customer_phone", e.target.value)}
                    className={inputClass}
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>{t("fields.customerCity")}</FieldLabel>
                {cityOptions.length > 0 ? (
                  <select
                    value={form.customer_city}
                    onChange={(e) => update("customer_city", e.target.value)}
                    className={inputClass}
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
                    className={inputClass}
                  />
                )}
              </div>

              <div>
                <FieldLabel>{t("fields.customerAddress")}</FieldLabel>
                <textarea
                  value={form.customer_address}
                  onChange={(e) => update("customer_address", e.target.value)}
                  rows={2}
                  className={textareaClass}
                />
              </div>

              <div>
                <FieldLabel>{t("fields.customerNote")}</FieldLabel>
                <textarea
                  value={form.customer_note}
                  onChange={(e) => update("customer_note", e.target.value)}
                  rows={2}
                  className={textareaClass}
                />
              </div>
            </FormSection>

            <FormSection title={t("sectionOrder")}>
              <div>
                <FieldLabel required>{t("fields.product")}</FieldLabel>
                <select
                  value={form.product_id}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className={inputClass}
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
                  <div className="text-[12px] text-ink-secondary mt-1.5">
                    {productsEmptyHint}
                  </div>
                )}
              </div>

              <div>
                <FieldLabel>{t("fields.variantLabel")}</FieldLabel>
                {variants.length > 0 ? (
                  <select
                    value={form.variant_id}
                    onChange={(e) => handleVariantChange(e.target.value)}
                    className={inputClass}
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
                    className={inputClass}
                    disabled={!form.product_id}
                    placeholder={form.product_id ? t("noVariants") : ""}
                  />
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <FieldLabel required>{t("fields.quantity")}</FieldLabel>
                  <input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => update("quantity", e.target.value)}
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
                <div>
                  <FieldLabel required>{t("fields.unitPrice")}</FieldLabel>
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    value={form.unit_price}
                    onChange={(e) => update("unit_price", e.target.value)}
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
                <div>
                  <FieldLabel required>{t("fields.totalPrice")}</FieldLabel>
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
                    className={`${inputClass} tabular-nums font-semibold`}
                  />
                </div>
              </div>
            </FormSection>

            {form.error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-card bg-status-criticalBg border border-status-critical/30 text-[13px] text-status-critical">
                <AlertCircle size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-snug">{form.error}</span>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="flex-shrink-0 bg-surface-card border-t border-line-subtle px-5 py-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={form.loading}
              className="inline-flex items-center justify-center h-10 px-4 text-[13.5px] font-medium text-ink-primary border border-line-subtle rounded-card bg-surface-card hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={form.loading}
              className="inline-flex items-center justify-center h-10 px-5 text-[13.5px] font-semibold text-white bg-ink-primary rounded-card hover:bg-[#2A2A2A] transition-colors duration-fast disabled:bg-line-strong disabled:text-ink-muted disabled:cursor-not-allowed"
            >
              {form.loading ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}
