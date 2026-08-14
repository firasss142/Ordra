"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  BadgeCheck,
  Check,
  ChevronDown,
  Info,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Tag,
  User,
  UserRound,
  X,
} from "lucide-react";
import type FocusTrapType from "focus-trap-react";
import type { Role } from "@/types";
import { TUNISIAN_GOVERNORATES } from "@/lib/carriers/governorates";
import { useMarketScope } from "@/context/market-scope";
import { useDebounce } from "@/hooks/useDebounce";
import { ProductAvatar } from "./ProductAvatar";
import type { CustomerLookup } from "@/app/api/customers/lookup/route";

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

interface Product {
  id: string;
  name: string;
  market_id: string;
  is_active?: boolean;
  current_stock?: number;
  default_price?: number | string | null;
  unit_price?: number | string | null;
  image_url?: string | null;
}

interface ProductVariant {
  id: string;
  product_id: string;
  label: string;
  quantity: number;
  display_price: number | string;
  is_active: boolean;
}

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: Role;
  userMarketId: string;
  onCreated: (orderId: string) => void;
}

/**
 * The country the market dials in. Shown as a fixed prefix beside the number
 * rather than mixed into it: every phone in this data is domestic, and the two
 * codes are the one part of a number the operator never has to type.
 */
const DIAL_CODES: Record<string, string> = { ly: "+218", tn: "+216" };
const CURRENCY_SUFFIX: Record<string, string> = { ly: "د.ل", tn: "DT" };

interface FormState {
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  /** Dexpress destination id for Libya orders. Null for Tunisia or unselected. */
  dexpress_state_id: number | null;
  customer_address: string;
  customer_note: string;
  product_id: string;
  variant_id: string;
  variant_label: string;
  quantity: string;
  unit_price: string;
  /**
   * A total the operator typed instead of the computed one — a discount, an
   * agreed round figure. `null` means "whatever quantity × unit price says",
   * which is the normal case and the only one that leaves no audit row.
   */
  total_override: string | null;
  loading: boolean;
  error: string | null;
}

function emptyForm(): FormState {
  return {
    customer_name: "",
    customer_phone: "",
    customer_city: "",
    dexpress_state_id: null,
    customer_address: "",
    customer_note: "",
    product_id: "",
    variant_id: "",
    variant_label: "",
    quantity: "1",
    unit_price: "",
    total_override: null,
    loading: false,
    error: null,
  };
}

const inputClass =
  "w-full h-10 px-3 text-[13.5px] rounded-lg border border-oms-border bg-oms-surface text-oms-ink-1 placeholder:text-oms-ink-3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-oms-sunken disabled:text-oms-ink-3 disabled:cursor-not-allowed transition-colors duration-fast";

const textareaClass =
  "w-full px-3 py-2 text-[13.5px] rounded-lg border border-oms-border bg-oms-surface text-oms-ink-1 placeholder:text-oms-ink-3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 resize-y transition-colors duration-fast";

function FieldLabel({
  children,
  required = false,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-oms-ink-2">
      {children}
      {required && <span className="ms-0.5 text-hue-red-ink">*</span>}
    </label>
  );
}

/**
 * A titled card with a tinted icon holder — the same §4.19 device the KPI tiles
 * use. It replaces a bare uppercase eyebrow: at a glance the panel now reads as
 * two things to fill in rather than one long column of fields.
 */
function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-oms-border bg-oms-surface">
      <div className="flex items-center gap-2.5 px-4 pb-1 pt-4">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-bg text-brand"
        >
          {icon}
        </span>
        <h3 className="text-[14px] font-semibold tracking-[-0.006em] text-oms-ink-1">{title}</h3>
      </div>
      <div className="flex flex-col gap-3.5 px-4 pb-4 pt-2.5">{children}</div>
    </section>
  );
}

function formatPrice(value: number): string {
  return value.toFixed(3);
}

function parsePriceValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

interface CityOption {
  value: string;
  label: string;
  /** Dexpress destination id — Libya only. */
  stateId?: number;
}

export function CreateOrderModal({
  isOpen,
  onClose,
  role,
  userMarketId,
  onCreated,
}: CreateOrderModalProps) {
  const t = useTranslations("orders.create");
  const locale = useLocale();
  const modalRef = useRef<HTMLDivElement>(null);
  const { scope, marketId: scopedMarketId } = useMarketScope();
  const [form, setForm] = useState<FormState>(() => emptyForm());

  const isSuperAdmin = role === "super_admin";

  /**
   * The market is no longer a field. It comes from the sidebar scope switcher,
   * which is already the single source of truth for what the rest of the page
   * is showing — asking again inside the panel let the two disagree.
   */
  const effectiveMarketId = isSuperAdmin
    ? scope === "all"
      ? ""
      : scopedMarketId ?? ""
    : userMarketId;

  /** A super_admin looking at every market has no one market to create in. */
  const marketUnscoped = isSuperAdmin && scope === "all";

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isOpen ? "/api/markets" : null,
    fetcher,
  );
  const markets = useMemo(() => marketsData?.data ?? [], [marketsData]);
  const currentMarket = markets.find((m) => m.id === effectiveMarketId);
  const marketCode = currentMarket?.code;
  const dialCode = marketCode ? DIAL_CODES[marketCode] ?? "" : "";
  const currency = marketCode ? CURRENCY_SUFFIX[marketCode] ?? "" : "";

  // Reset when the panel opens or the market underneath it changes — a Libya
  // city left in the form after switching to Tunisia is not a city.
  useEffect(() => {
    if (isOpen) setForm(emptyForm());
  }, [isOpen, effectiveMarketId]);

  const { data: productsData } = useSWR<{ data: Product[] }>(
    isOpen && effectiveMarketId
      ? `/api/products/search?market_id=${effectiveMarketId}`
      : null,
    fetcher,
  );
  // Only active products — inactive SKUs shouldn't be sold.
  const products = useMemo(
    () => (productsData?.data ?? []).filter((p) => p.is_active !== false),
    [productsData],
  );

  const { data: variantsData } = useSWR<{ data: ProductVariant[] }>(
    isOpen && form.product_id ? `/api/products/${form.product_id}/variants` : null,
    fetcher,
  );
  const variants = useMemo(
    () => (variantsData?.data ?? []).filter((v) => v.is_active !== false),
    [variantsData],
  );

  // Libya's cities are the carrier's destination list; Tunisia's are the
  // canonical governorates. One control over both — the operator is picking a
  // city either way and should not meet two different widgets to do it.
  const { data: dexpressStatesData } = useSWR<{
    states: Array<{ id: number; name: string }>;
  }>(isOpen && marketCode === "ly" ? "/api/dexpress/states" : null, fetcher);

  const cityOptions = useMemo<CityOption[]>(() => {
    if (marketCode === "tn") {
      return TUNISIAN_GOVERNORATES.map((g) => ({ value: g, label: g }));
    }
    if (marketCode === "ly") {
      return (dexpressStatesData?.states ?? []).map((s) => ({
        value: s.name,
        label: s.name,
        stateId: s.id,
      }));
    }
    return [];
  }, [marketCode, dexpressStatesData]);

  // ---------- Existing-customer lookup ----------
  const debouncedPhone = useDebounce(form.customer_phone, 350);
  const { data: lookupData } = useSWR<{ data: CustomerLookup | null }>(
    isOpen && effectiveMarketId && debouncedPhone.replace(/\D/g, "").length >= 6
      ? `/api/customers/lookup?phone=${encodeURIComponent(debouncedPhone)}&market_id=${effectiveMarketId}`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const knownCustomer = lookupData?.data ?? null;
  const [customerApplied, setCustomerApplied] = useState(false);
  useEffect(() => {
    setCustomerApplied(false);
  }, [debouncedPhone]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !form.loading) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose, form.loading]);

  const selectedProduct = products.find((p) => p.id === form.product_id);

  const qtyNum = parseInt(form.quantity, 10);
  const unitNum = parseFloat(form.unit_price);
  const computedTotal =
    Number.isInteger(qtyNum) && qtyNum > 0 && Number.isFinite(unitNum) && unitNum >= 0
      ? Math.round(qtyNum * unitNum * 1000) / 1000
      : null;

  if (!isOpen) return null;

  /**
   * Patch one field and clear any standing error, since editing anything is a
   * response to being told what was wrong.
   *
   * `error` is deliberately NOT assignable here — it goes through `fail()`.
   * This used to be `keyof FormState`, and the body wrote
   * `{ ...s, [key]: value, error: null }`: spread order is assignment order, so
   * every `update("error", msg)` set the message and then immediately nulled
   * it. The panel had validation messages in the code and never showed one —
   * a failed submit just did nothing at all.
   *
   * Ordering the keys the other way would also work, but only by a convention
   * the next person to tidy this object would silently break. Excluding the
   * field from the type makes the broken call a compile error instead.
   */
  type EditableField = Exclude<keyof FormState, "error">;
  function update<K extends EditableField>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, error: null, [key]: value }));
  }

  /** Refuse the submission, saying why. The only way to set `error`. */
  function fail(message: string) {
    setForm((s) => ({ ...s, error: message }));
  }

  function getProductPrice(product: Product | undefined): number | null {
    return parsePriceValue(product?.default_price ?? product?.unit_price);
  }

  function handleProductChange(productId: string) {
    // Switching product → drop the variant and reseed the price. The old
    // variant belongs to a different product and its price would be a lie.
    const p = products.find((x) => x.id === productId);
    const basePrice = getProductPrice(p);
    setForm((s) => ({
      ...s,
      product_id: productId,
      variant_id: "",
      variant_label: "",
      unit_price: basePrice !== null ? formatPrice(basePrice) : "",
      total_override: null,
      error: null,
    }));
  }

  /**
   * A variant sets the unit price and the label. It deliberately does NOT set
   * the quantity — the stepper stays the operator's, so "3 × 1 لتر" is
   * orderable and the total on screen is the total that gets saved. The server
   * used to overwrite quantity here, which made the two disagree.
   *
   * Clicking the active variant clears it, back to the product's base price.
   */
  function handleVariantChange(variantId: string) {
    if (!variantId || variantId === form.variant_id) {
      const base = getProductPrice(selectedProduct);
      setForm((s) => ({
        ...s,
        variant_id: "",
        variant_label: "",
        unit_price: base !== null ? formatPrice(base) : s.unit_price,
        total_override: null,
        error: null,
      }));
      return;
    }
    const v = variants.find((x) => x.id === variantId);
    if (!v) return;
    setForm((s) => ({
      ...s,
      variant_id: v.id,
      variant_label: v.label,
      unit_price: formatPrice(parsePriceValue(v.display_price) ?? 0),
      total_override: null,
      error: null,
    }));
  }

  function setQuantity(next: number) {
    if (next < 1) return;
    setForm((s) => ({ ...s, quantity: String(next), total_override: null, error: null }));
  }

  async function handleSubmit() {
    if (!effectiveMarketId) {
      fail(t("errors.marketRequired"));
      return;
    }
    if (!form.customer_phone.trim()) {
      fail(t("errors.customerPhoneRequired"));
      return;
    }
    if (!form.customer_name.trim()) {
      fail(t("errors.customerNameRequired"));
      return;
    }
    if (!form.customer_city.trim()) {
      fail(t("errors.cityRequired"));
      return;
    }
    if (!form.customer_address.trim()) {
      fail(t("errors.customerAddressRequired"));
      return;
    }
    if (!form.product_id) {
      fail(t("errors.productRequired"));
      return;
    }
    const qty = parseInt(form.quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) {
      fail(t("errors.quantityInvalid"));
      return;
    }
    const unit = parseFloat(form.unit_price);
    if (Number.isNaN(unit) || unit < 0) {
      fail(t("errors.unitPriceInvalid"));
      return;
    }
    if (form.total_override !== null) {
      const o = parseFloat(form.total_override);
      if (!Number.isFinite(o) || o < 0) {
        fail(t("errors.totalOverrideInvalid"));
        return;
      }
    }

    const product = products.find((p) => p.id === form.product_id);
    if (!product) {
      fail(t("errors.productRequired"));
      return;
    }

    setForm((s) => ({ ...s, loading: true, error: null }));

    const body: Record<string, unknown> = {
      market_id: effectiveMarketId,
      customer_name: form.customer_name.trim(),
      // Stored as the domestic digits the rest of this data already uses; the
      // dial code is a label, not part of the value. Search normalises anyway.
      customer_phone: form.customer_phone.replace(/[^\d]/g, ""),
      customer_city: form.customer_city.trim() || null,
      dexpress_state_id: form.dexpress_state_id,
      customer_address: form.customer_address.trim() || null,
      customer_note: form.customer_note.trim() || null,
      product_id: form.product_id,
      variant_id: form.variant_id || null,
      product_name: product.name,
      variant_label: form.variant_label.trim() || null,
      quantity: qty,
      unit_price: unit,
    };
    // Sent only when it actually differs — the server audits any total it did
    // not compute, and a redundant one would file a discount that never was.
    if (form.total_override !== null) {
      body.total_price = parseFloat(form.total_override);
    }

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
        error: json.error ?? t("errors.requestFailed", { status: res.status }),
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
    effectiveMarketId && productsData && products.length === 0 ? t("emptyProducts") : null;

  const money = (n: number) => `${formatPrice(n)} ${currency}`.trim();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-oms-ink-1/40 animate-[fadeInUp_120ms_ease-out]"
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
          className="fixed top-0 end-0 z-50 flex h-full w-full max-w-[92vw] flex-col overflow-hidden border-s border-oms-border bg-oms-bg shadow-panel animate-[slideInEnd_180ms_ease-out] sm:w-[440px] md:w-[520px] lg:w-[600px] xl:w-[680px]"
        >
          {/* Sticky Header */}
          <div className="flex-shrink-0 border-b border-oms-border bg-oms-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <h2
                  id="create-order-title"
                  className="truncate text-[17px] font-semibold leading-tight tracking-[-0.014em] text-oms-ink-1"
                >
                  {t("modalTitle")}
                </h2>
                <p className="mt-0.5 truncate text-[12px] text-oms-ink-2">
                  {t("modalSubtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !form.loading && onClose()}
                disabled={form.loading}
                aria-label={t("cancel")}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1 disabled:opacity-50"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
            {marketUnscoped ? (
              /* No market in scope: the panel cannot guess which of two
                 isolated markets this order belongs to, and picking wrong is
                 not correctable from the UI. */
              <div className="flex items-start gap-3 rounded-card border border-oms-border bg-oms-surface px-4 py-4">
                <span
                  aria-hidden
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-hue-amber-bg text-hue-amber-ink"
                >
                  <Info size={17} strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[13.5px] font-semibold text-oms-ink-1">
                    {t("noMarketScopeTitle")}
                  </p>
                  <p className="m-0 mt-1 text-[12.5px] leading-snug text-oms-ink-2">
                    {t("noMarketScopeBody")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <SectionCard
                  icon={<User size={15} strokeWidth={2.1} />}
                  title={t("sectionCustomer")}
                >
                  {/* Phone leads: it is the key the customer is known by, and
                      looking it up first can fill everything below it. */}
                  <div>
                    <FieldLabel required htmlFor="co-phone">
                      {t("fields.customerPhone")}
                    </FieldLabel>
                    <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-oms-border bg-oms-surface transition-colors duration-fast focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
                      {dialCode && (
                        <span
                          aria-hidden
                          className="grid place-items-center border-e border-oms-border bg-oms-sunken px-3 text-[13px] font-semibold tabular-nums text-oms-ink-2"
                        >
                          {dialCode}
                        </span>
                      )}
                      <input
                        id="co-phone"
                        type="text"
                        value={form.customer_phone}
                        onChange={(e) => update("customer_phone", e.target.value)}
                        placeholder={t("phonePlaceholder")}
                        inputMode="tel"
                        autoComplete="tel"
                        dir="ltr"
                        className="min-w-0 flex-1 bg-transparent px-3 text-[13.5px] tabular-nums text-oms-ink-1 outline-none placeholder:text-oms-ink-3"
                      />
                    </div>
                  </div>

                  {knownCustomer && !customerApplied && (
                    <CustomerCard
                      customer={knownCustomer}
                      locale={locale}
                      onUse={() => {
                        setForm((s) => ({
                          ...s,
                          customer_name: knownCustomer.name ?? s.customer_name,
                          customer_city: knownCustomer.city ?? s.customer_city,
                          // A city we cannot map to a carrier destination must
                          // not inherit a stale id from a previous selection.
                          dexpress_state_id:
                            cityOptions.find((c) => c.value === knownCustomer.city)?.stateId ??
                            null,
                          customer_address: knownCustomer.address ?? s.customer_address,
                          error: null,
                        }));
                        setCustomerApplied(true);
                      }}
                    />
                  )}

                  <div>
                    <FieldLabel required htmlFor="co-name">
                      {t("fields.customerName")}
                    </FieldLabel>
                    <input
                      id="co-name"
                      type="text"
                      value={form.customer_name}
                      onChange={(e) => update("customer_name", e.target.value)}
                      placeholder={t("namePlaceholder")}
                      className={inputClass}
                      dir="auto"
                    />
                  </div>

                  <div>
                    <FieldLabel required>{t("fields.customerCity")}</FieldLabel>
                    {cityOptions.length > 0 ? (
                      <CityCombobox
                        options={cityOptions}
                        value={form.customer_city}
                        onSelect={(opt) =>
                          setForm((s) => ({
                            ...s,
                            customer_city: opt.value,
                            dexpress_state_id: opt.stateId ?? null,
                            error: null,
                          }))
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        value={form.customer_city}
                        onChange={(e) => update("customer_city", e.target.value)}
                        className={inputClass}
                        dir="auto"
                      />
                    )}
                  </div>

                  <div>
                    <FieldLabel required htmlFor="co-address">
                      {t("fields.customerAddress")}
                    </FieldLabel>
                    <textarea
                      id="co-address"
                      value={form.customer_address}
                      onChange={(e) => update("customer_address", e.target.value)}
                      rows={2}
                      placeholder={t("addressPlaceholder")}
                      className={textareaClass}
                      dir="auto"
                    />
                  </div>

                  <div>
                    <FieldLabel htmlFor="co-note">{t("fields.customerNote")}</FieldLabel>
                    <textarea
                      id="co-note"
                      value={form.customer_note}
                      onChange={(e) => update("customer_note", e.target.value)}
                      rows={2}
                      placeholder={t("notePlaceholder")}
                      className={textareaClass}
                      dir="auto"
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ShoppingBag size={15} strokeWidth={2.1} />}
                  title={t("sectionOrder")}
                >
                  <div>
                    <FieldLabel required>{t("fields.product")}</FieldLabel>
                    <ProductPicker
                      products={products}
                      selected={selectedProduct}
                      currency={currency}
                      disabled={!effectiveMarketId}
                      onSelect={handleProductChange}
                      onClear={() =>
                        setForm((s) => ({
                          ...s,
                          product_id: "",
                          variant_id: "",
                          variant_label: "",
                          unit_price: "",
                          total_override: null,
                          error: null,
                        }))
                      }
                    />
                    {productsEmptyHint && (
                      <div className="mt-1.5 text-[12px] text-oms-ink-2">{productsEmptyHint}</div>
                    )}
                  </div>

                  {form.product_id && variants.length > 0 && (
                    <div>
                      <FieldLabel>{t("fields.variantLabel")}</FieldLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {variants.map((v) => {
                          const active = form.variant_id === v.id;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => handleVariantChange(v.id)}
                              className={
                                "inline-flex h-8 items-center rounded-lg border px-3 text-[12.5px] font-medium transition-colors duration-fast " +
                                (active
                                  ? "border-brand bg-brand-bg text-brand-hover"
                                  : "border-oms-border bg-oms-surface text-oms-ink-2 hover:border-oms-border-strong hover:text-oms-ink-1")
                              }
                              dir="auto"
                            >
                              {v.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {form.product_id && variants.length === 0 && (
                    <div>
                      <FieldLabel htmlFor="co-variant">{t("fields.variantLabel")}</FieldLabel>
                      <input
                        id="co-variant"
                        type="text"
                        value={form.variant_label}
                        onChange={(e) => update("variant_label", e.target.value)}
                        className={inputClass}
                        placeholder={t("noVariants")}
                        dir="auto"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel required>{t("fields.quantity")}</FieldLabel>
                      <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-oms-border bg-oms-surface">
                        <button
                          type="button"
                          onClick={() => setQuantity((parseInt(form.quantity, 10) || 1) - 1)}
                          disabled={(parseInt(form.quantity, 10) || 1) <= 1}
                          aria-label={t("qtyDecrease")}
                          className="grid w-10 place-items-center border-e border-oms-border text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Minus size={14} strokeWidth={2.2} />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={form.quantity}
                          onChange={(e) => update("quantity", e.target.value)}
                          aria-label={t("fields.quantity")}
                          className="min-w-0 flex-1 bg-transparent px-2 text-center text-[13.5px] font-semibold tabular-nums text-oms-ink-1 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity((parseInt(form.quantity, 10) || 0) + 1)}
                          aria-label={t("qtyIncrease")}
                          className="grid w-10 place-items-center border-s border-oms-border text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
                        >
                          <Plus size={14} strokeWidth={2.2} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <FieldLabel required htmlFor="co-unit">
                        {t("fields.unitPrice")}
                      </FieldLabel>
                      <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-oms-border bg-oms-surface transition-colors duration-fast focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
                        <input
                          id="co-unit"
                          type="number"
                          step="0.001"
                          min={0}
                          value={form.unit_price}
                          onChange={(e) =>
                            setForm((s) => ({
                              ...s,
                              unit_price: e.target.value,
                              total_override: null,
                              error: null,
                            }))
                          }
                          className="min-w-0 flex-1 bg-transparent px-3 text-[13.5px] tabular-nums text-oms-ink-1 outline-none"
                        />
                        {currency && (
                          <span
                            aria-hidden
                            className="grid place-items-center pe-3 text-[12px] text-oms-ink-3"
                          >
                            {currency}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <TotalCard
                    quantity={form.quantity}
                    unitPrice={form.unit_price}
                    computed={computedTotal}
                    override={form.total_override}
                    money={money}
                    onEdit={() =>
                      setForm((s) => ({
                        ...s,
                        total_override: computedTotal !== null ? formatPrice(computedTotal) : "",
                        error: null,
                      }))
                    }
                    onChange={(v) => update("total_override", v)}
                    onReset={() => update("total_override", null)}
                  />
                </SectionCard>
              </>
            )}

            {form.error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-card border border-hue-red-edge-soft bg-hue-red-bg px-3 py-2.5 text-[13px] text-hue-red-ink"
              >
                <AlertCircle
                  size={14}
                  strokeWidth={2}
                  className="mt-0.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <span className="leading-snug">{form.error}</span>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div
            className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-oms-border bg-oms-surface px-4 py-3 sm:px-5"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={form.loading}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-oms-border bg-oms-surface px-4 text-[13.5px] font-medium text-oms-ink-1 transition-colors duration-fast hover:border-oms-border-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={form.loading || marketUnscoped}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-[13.5px] font-semibold text-white shadow-hover-row transition-colors duration-fast hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-oms-border-strong disabled:text-oms-ink-3 disabled:shadow-none"
            >
              <ShoppingCart size={15} strokeWidth={2.1} aria-hidden="true" />
              {form.loading ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}

/**
 * We have sold to this number before.
 *
 * Its own card rather than a silent autofill, because the operator is on a call
 * and "is this the same أحمد" is their judgement, not the form's. Nothing is
 * written into the fields until they say so.
 */
function CustomerCard({
  customer,
  locale,
  onUse,
}: {
  customer: CustomerLookup;
  locale: string;
  onUse: () => void;
}) {
  const t = useTranslations("orders.create");
  const lastOrder = customer.lastOrderAt
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(customer.lastOrderAt))
    : null;

  return (
    <div className="flex items-center gap-3 rounded-card border border-hue-teal-edge-soft bg-hue-teal-bg px-3 py-2.5">
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-oms-surface text-hue-teal-ink"
      >
        <UserRound size={19} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-oms-ink-1" dir="auto">
            {customer.name ?? customer.phone}
          </span>
          <BadgeCheck
            size={14}
            strokeWidth={2.2}
            aria-hidden
            className="flex-none text-hue-teal-ink"
          />
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-oms-ink-2">
          {t("existingCustomer")} · {t("customerOrders", { count: customer.orderCount })}
          {lastOrder ? ` · ${t("customerLastOrder", { date: lastOrder })}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="flex-none rounded-lg border border-oms-border bg-oms-surface px-3 py-1.5 text-[12.5px] font-medium text-oms-ink-1 transition-colors duration-fast hover:border-oms-border-strong"
      >
        {t("useCustomer")}
      </button>
    </div>
  );
}

/** One searchable city control for both markets. */
function CityCombobox({
  options,
  value,
  onSelect,
}: {
  options: CityOption[];
  value: string;
  onSelect: (opt: CityOption) => void;
}) {
  const t = useTranslations("orders.create");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Stopped here so Escape closes the menu without also closing the panel
    // behind it — one key press, one dismissal.
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const visible = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
        className={
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-[13.5px] transition-colors duration-fast " +
          (open
            ? "border-brand bg-oms-surface ring-2 ring-brand/15"
            : "border-oms-border bg-oms-surface hover:border-oms-border-strong")
        }
      >
        <span
          className={"min-w-0 truncate " + (value ? "text-oms-ink-1" : "text-oms-ink-3")}
          dir="auto"
        >
          {value || t("cityPlaceholder")}
        </span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden className="flex-none text-oms-ink-3" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-card border border-oms-border bg-oms-surface shadow-floating">
          <div className="border-b border-oms-border p-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-oms-border bg-oms-sunken px-2">
              <Search size={13} strokeWidth={2} aria-hidden className="flex-none text-oms-ink-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("citySearchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-oms-ink-1 outline-none placeholder:text-oms-ink-3"
                dir="auto"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-[220px] overflow-y-auto p-1">
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-oms-ink-3">{t("cityNoResults")}</p>
            ) : (
              visible.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={`${o.value}-${o.stateId ?? ""}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect(o);
                      setOpen(false);
                    }}
                    className={
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-[13px] transition-colors duration-fast " +
                      (selected
                        ? "bg-brand-bg text-brand-hover"
                        : "text-oms-ink-1 hover:bg-oms-sunken")
                    }
                    dir="auto"
                  >
                    <span className="grid h-4 w-4 flex-none place-items-center text-brand">
                      {selected && <Check size={13} strokeWidth={2.6} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Product picker: a photo and a price, because that is how a product is recognised. */
function ProductPicker({
  products,
  selected,
  currency,
  disabled,
  onSelect,
  onClear,
}: {
  products: Product[];
  selected: Product | undefined;
  currency: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("orders.create");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const visible = q.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : products;

  const priceOf = (p: Product) => parsePriceValue(p.default_price ?? p.unit_price);

  if (selected) {
    const price = priceOf(selected);
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-oms-border bg-oms-surface px-2.5 py-2">
        <ProductAvatar
          imageUrl={selected.image_url ?? null}
          productName={selected.name}
          size={32}
        />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-oms-ink-1" dir="auto">
          {selected.name}
        </span>
        {price !== null && (
          <span className="flex-none rounded-md bg-oms-sunken px-2 py-1 text-[12px] tabular-nums text-oms-ink-2">
            {formatPrice(price)} {currency}
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          aria-label={t("productClear")}
          className="grid h-7 w-7 flex-none place-items-center rounded-md text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
        className={
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-[13.5px] transition-colors duration-fast disabled:cursor-not-allowed disabled:bg-oms-sunken " +
          (open
            ? "border-brand bg-oms-surface ring-2 ring-brand/15"
            : "border-oms-border bg-oms-surface hover:border-oms-border-strong")
        }
      >
        <span className="min-w-0 truncate text-oms-ink-3">{t("productPlaceholder")}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden className="flex-none text-oms-ink-3" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-card border border-oms-border bg-oms-surface shadow-floating">
          <div className="border-b border-oms-border p-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-oms-border bg-oms-sunken px-2">
              <Search size={13} strokeWidth={2} aria-hidden className="flex-none text-oms-ink-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("productSearchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-oms-ink-1 outline-none placeholder:text-oms-ink-3"
                dir="auto"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-[240px] overflow-y-auto p-1">
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-oms-ink-3">{t("cityNoResults")}</p>
            ) : (
              visible.map((p) => {
                const price = priceOf(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      onSelect(p.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-[13px] text-oms-ink-1 transition-colors duration-fast hover:bg-oms-sunken"
                  >
                    <ProductAvatar imageUrl={p.image_url ?? null} productName={p.name} size={26} />
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {p.name}
                    </span>
                    {price !== null && (
                      <span className="flex-none text-[11.5px] tabular-nums text-oms-ink-3">
                        {formatPrice(price)} {currency}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The line total, and the one place it can be overridden.
 *
 * The breakdown under the figure is what makes the override safe to offer: a
 * typed total that no longer matches "3 × 25,500" is visibly a decision rather
 * than a typo, and the server files a history row saying so.
 */
function TotalCard({
  quantity,
  unitPrice,
  computed,
  override,
  money,
  onEdit,
  onChange,
  onReset,
}: {
  quantity: string;
  unitPrice: string;
  computed: number | null;
  override: string | null;
  money: (n: number) => string;
  onEdit: () => void;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const t = useTranslations("orders.create");
  const editing = override !== null;
  const overrideNum = editing ? parseFloat(override) : NaN;
  const delta =
    editing && Number.isFinite(overrideNum) && computed !== null
      ? Math.round((overrideNum - computed) * 1000) / 1000
      : null;

  return (
    <div className="rounded-card border border-brand/20 bg-brand-bg px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 flex-none text-brand">
            <Tag size={15} strokeWidth={2.1} />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-oms-ink-1">{t("totalComputed")}</div>
            <div className="mt-0.5 text-[11.5px] tabular-nums text-oms-ink-2">
              {t("totalBreakdown", {
                qty: quantity || "—",
                price: unitPrice ? money(parseFloat(unitPrice)) : "—",
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-none flex-col items-end gap-1">
          {editing ? (
            <input
              type="number"
              step="0.001"
              min={0}
              autoFocus
              value={override}
              onChange={(e) => onChange(e.target.value)}
              aria-label={t("fields.totalPrice")}
              className="h-9 w-[130px] rounded-lg border border-brand bg-oms-surface px-2 text-end text-[16px] font-bold tabular-nums text-oms-ink-1 outline-none focus:ring-2 focus:ring-brand/15"
            />
          ) : (
            <span className="text-[19px] font-bold leading-none tracking-[-0.02em] tabular-nums text-oms-ink-1">
              {computed !== null ? money(computed) : "—"}
            </span>
          )}

          {editing ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-hover hover:underline"
            >
              <RotateCcw size={11} strokeWidth={2.2} aria-hidden />
              {t("totalReset")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              disabled={computed === null}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-hover hover:underline disabled:cursor-not-allowed disabled:text-oms-ink-3 disabled:no-underline"
            >
              <Pencil size={11} strokeWidth={2.2} aria-hidden />
              {t("totalEdit")}
            </button>
          )}
        </div>
      </div>

      {/* A discount is stated, not left for someone to notice later. */}
      {delta !== null && delta !== 0 && (
        <p className="mt-2 border-t border-brand/15 pt-2 text-[11.5px] text-oms-ink-2">
          {t("totalOverridden", { delta: money(Math.abs(delta)) })}
        </p>
      )}
    </div>
  );
}
