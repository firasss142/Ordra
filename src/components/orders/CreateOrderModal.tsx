"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import type FocusTrapType from "focus-trap-react";
import type { Role } from "@/types";
import { TUNISIAN_GOVERNORATES } from "@/lib/carriers/governorates";
import { toLibyanE164 } from "@/lib/carriers/phone";
import { resolveDarbAny } from "@/lib/carriers/darb-assabil-areas";
import {
  findDestination,
  type DarbDestinationOption,
} from "@/lib/carriers/darb-destination-search";
import { useDarbDestinations } from "@/hooks/useDarbDestinations";
import { DarbDestinationPicker } from "@/components/shared/DarbDestinationPicker";
import { useMarketScope } from "@/context/market-scope";
import { useDebounce } from "@/hooks/useDebounce";
import { ProductAvatar } from "./ProductAvatar";
import { ICON_PATHS } from "./commandes/icons";
import type { CustomerLookup } from "@/app/api/customers/lookup/route";
import "./commandes/commandes.css";
import "./create-order.css";

const FocusTrap = dynamic(
  () => import("focus-trap-react"),
  { ssr: false },
) as typeof FocusTrapType;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** The prototype's icons (commandes-v4.html, ICON), drawn as it draws them. Static paths only. */
function Ic({ n }: { n: string }) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[n] ?? "" }}
    />
  );
}

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Storefront {
  id: string;
  name: string;
  platform?: string | null;
  is_active?: boolean;
  created_at?: string | null;
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
  /**
   * Libya: the Darb Assabil (city, area) pair the operator picked. The id is
   * what the order stores; the pair is what the field displays. Null for
   * Tunisia or until picked.
   */
  darb_destination: DarbDestinationOption | null;
  customer_address: string;
  customer_note: string;
  /**
   * The shop the order is filed under. Empty means "the market's oldest active
   * shop" — the same one the server falls back to, so leaving it alone is
   * never a different answer from picking it.
   */
  storefront_id: string;
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
    darb_destination: null,
    customer_address: "",
    customer_note: "",
    storefront_id: "",
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

/** The prototype's `.fld label` — the red asterisk is an `<i>`. */
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
    <label htmlFor={htmlFor}>
      {children}
      {required && <i aria-hidden="true">*</i>}
    </label>
  );
}

/** One of the drawer's two soft sections (`.fs`), with its tinted icon tile. */
function FormSection({
  icon,
  hue,
  title,
  children,
}: {
  icon: string;
  hue: "blue" | "green" | "amber";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="fs">
      <h3>
        <span className={`hold h-${hue}`} aria-hidden="true">
          <Ic n={icon} />
        </span>
        {title}
      </h3>
      {children}
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
  const modalRef = useRef<HTMLElement>(null);
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

  const { data: storefrontsData } = useSWR<{ data: Storefront[] }>(
    isOpen && effectiveMarketId ? `/api/storefronts?market_id=${effectiveMarketId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  // Active shops, oldest first — the order the server's own fallback uses.
  const storefronts = useMemo(
    () =>
      (Array.isArray(storefrontsData?.data) ? storefrontsData.data : [])
        .filter((s) => s.is_active !== false)
        .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))),
    [storefrontsData],
  );
  const storefrontId = form.storefront_id || storefronts[0]?.id || "";

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

  // Tunisia's cities are the canonical governorates. Libya's are the carrier's
  // own (city, area) catalogue — Darb Assabil ships every Libyan parcel, so the
  // operator picks exactly what the carrier will be told, once.
  const cityOptions = useMemo<CityOption[]>(
    () =>
      marketCode === "tn" ? TUNISIAN_GOVERNORATES.map((g) => ({ value: g, label: g })) : [],
    [marketCode],
  );
  const { destinations: darbDestinations } = useDarbDestinations(
    isOpen && marketCode === "ly",
  );

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
   * Choosing no variant (or the active one again) goes back to the product's
   * base price.
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
    // Validated here, in the operator's language, rather than by the carrier
    // three steps later with "String didn't match the expected pattern!".
    if (!isValidPhoneFor(marketCode, form.customer_phone)) {
      fail(t("errors.customerPhoneInvalid"));
      return;
    }
    if (!form.customer_name.trim()) {
      fail(t("errors.customerNameRequired"));
      return;
    }
    if (marketCode === "ly" && !form.darb_destination) {
      fail(t("errors.destinationRequired"));
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
      // Absent when the market's shops could not be listed: the server then
      // files the order under the oldest active one, as it always has.
      ...(storefrontId ? { storefront_id: storefrontId } : {}),
      customer_name: form.customer_name.trim(),
      // Stored as the domestic digits the rest of this data already uses; the
      // dial code is a label, not part of the value. Search normalises anyway.
      customer_phone: form.customer_phone.replace(/[^\d]/g, ""),
      customer_city: form.customer_city.trim() || null,
      ...(form.darb_destination?.id != null
        ? { darb_destination_id: form.darb_destination.id }
        : {}),
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

  const qtyValue = parseInt(form.quantity, 10) || 1;
  const overrideNum = form.total_override !== null ? parseFloat(form.total_override) : NaN;
  const shownTotal = Number.isFinite(overrideNum) ? overrideNum : computedTotal;
  const overrideDelta =
    Number.isFinite(overrideNum) && computedTotal !== null
      ? Math.round((overrideNum - computedTotal) * 1000) / 1000
      : null;

  return (
    <div className="cmd co-root">
      <div className="scrim" aria-hidden="true" onClick={() => !form.loading && onClose()} />
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          fallbackFocus: () => modalRef.current ?? document.body,
        }}
      >
        <aside
          ref={modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-order-title"
          className="drawer co-drawer"
        >
          <div className="dr-top">
            <span className="dr-title">
              <b id="create-order-title">{t("modalTitle")}</b>
              <small>{t("modalSubtitle")}</small>
            </span>
            <button
              type="button"
              className="xbtn"
              onClick={() => !form.loading && onClose()}
              disabled={form.loading}
              aria-label={t("close")}
            >
              <Ic n="x" />
            </button>
          </div>

          <div className="dr-body co-body">
            {marketUnscoped ? (
              /* No market in scope: the panel cannot guess which of two
                 isolated markets this order belongs to, and picking wrong is
                 not correctable from the UI. */
              <FormSection icon="info" hue="amber" title={t("noMarketScopeTitle")}>
                <p className="co-hint">{t("noMarketScopeBody")}</p>
              </FormSection>
            ) : (
              <>
                <FormSection icon="user" hue="blue" title={t("sectionCustomer")}>
                  {/* Phone leads: it is the key the customer is known by, and
                      looking it up first can fill everything below it. */}
                  <div className="fld">
                    <FieldLabel required htmlFor="co-phone">
                      {t("fields.customerPhone")}
                    </FieldLabel>
                    <div className={dialCode ? "inp-pre" : undefined}>
                      {dialCode && <span>{dialCode}</span>}
                      <input
                        id="co-phone"
                        type="text"
                        className="inp"
                        value={form.customer_phone}
                        onChange={(e) => update("customer_phone", e.target.value)}
                        placeholder={t("phonePlaceholder")}
                        inputMode="tel"
                        autoComplete="tel"
                        dir="ltr"
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
                          // Libya: the stored city is a Darb pair only when it
                          // names one exactly (a single-area city or a zone).
                          // A multi-area city keeps its name and asks for the
                          // zone; a stale pair from before never survives.
                          darb_destination:
                            marketCode === "ly"
                              ? darbPairFor(knownCustomer.city, darbDestinations)
                              : null,
                          customer_address: knownCustomer.address ?? s.customer_address,
                          error: null,
                        }));
                        setCustomerApplied(true);
                      }}
                    />
                  )}

                  <div className="fld">
                    <FieldLabel required htmlFor="co-name">
                      {t("fields.customerName")}
                    </FieldLabel>
                    <input
                      id="co-name"
                      type="text"
                      className="inp"
                      value={form.customer_name}
                      onChange={(e) => update("customer_name", e.target.value)}
                      placeholder={t("namePlaceholder")}
                      dir="auto"
                    />
                  </div>

                  <div className="fld">
                    <FieldLabel required>{t("fields.customerCity")}</FieldLabel>
                    {marketCode === "ly" ? (
                      <div className="co-pick">
                        <DarbDestinationPicker
                          destinations={darbDestinations}
                          value={form.darb_destination}
                          placeholder={
                            form.customer_city
                              ? `${form.customer_city} — ${t("pickZone")}`
                              : t("cityPlaceholder")
                          }
                          onSelect={(opt) =>
                            setForm((s) => ({
                              ...s,
                              customer_city: opt.city,
                              darb_destination: opt,
                              error: null,
                            }))
                          }
                          onClear={() =>
                            setForm((s) => ({ ...s, customer_city: "", darb_destination: null }))
                          }
                        />
                      </div>
                    ) : cityOptions.length > 0 ? (
                      <CityCombobox
                        options={cityOptions}
                        value={form.customer_city}
                        onSelect={(opt) =>
                          setForm((s) => ({
                            ...s,
                            customer_city: opt.value,
                            error: null,
                          }))
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        className="inp"
                        value={form.customer_city}
                        onChange={(e) => update("customer_city", e.target.value)}
                        placeholder={t("cityPlaceholder")}
                        dir="auto"
                      />
                    )}
                  </div>

                  <div className="fld">
                    <FieldLabel required htmlFor="co-address">
                      {t("fields.customerAddress")}
                    </FieldLabel>
                    <textarea
                      id="co-address"
                      className="inp"
                      value={form.customer_address}
                      onChange={(e) => update("customer_address", e.target.value)}
                      placeholder={t("addressPlaceholder")}
                      dir="auto"
                    />
                  </div>

                  <div className="fld">
                    <FieldLabel htmlFor="co-note">{t("fields.customerNote")}</FieldLabel>
                    <textarea
                      id="co-note"
                      className="inp"
                      value={form.customer_note}
                      onChange={(e) => update("customer_note", e.target.value)}
                      placeholder={t("notePlaceholder")}
                      dir="auto"
                    />
                  </div>
                </FormSection>

                <FormSection icon="bag" hue="green" title={t("sectionOrder")}>
                  <div className="fld">
                    <FieldLabel required htmlFor="co-store">
                      {t("fields.storefront")}
                    </FieldLabel>
                    <select
                      id="co-store"
                      className="inp"
                      value={storefrontId}
                      disabled={storefronts.length === 0}
                      onChange={(e) => update("storefront_id", e.target.value)}
                    >
                      {storefronts.length === 0 ? (
                        <option value="">{t("storefrontNone")}</option>
                      ) : (
                        storefronts.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="two co-pv">
                    <div className="fld">
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
                      {productsEmptyHint && <p className="co-hint">{productsEmptyHint}</p>}
                    </div>

                    <div className="fld">
                      <FieldLabel htmlFor="co-variant">{t("fields.variantLabel")}</FieldLabel>
                      {!form.product_id ? (
                        <input
                          id="co-variant"
                          className="inp"
                          disabled
                          placeholder={t("variantNone")}
                        />
                      ) : variants.length > 0 ? (
                        <select
                          id="co-variant"
                          className="inp"
                          value={form.variant_id}
                          onChange={(e) => handleVariantChange(e.target.value)}
                          dir="auto"
                        >
                          <option value="">{t("variantBase")}</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        /* No configured variant: a free label, as before. */
                        <input
                          id="co-variant"
                          type="text"
                          className="inp"
                          value={form.variant_label}
                          onChange={(e) => update("variant_label", e.target.value)}
                          placeholder={t("variantFree")}
                          title={t("noVariants")}
                          dir="auto"
                        />
                      )}
                    </div>
                  </div>

                  <div className="two">
                    <div className="fld">
                      <FieldLabel required htmlFor="co-qty">
                        {t("fields.quantity")}
                      </FieldLabel>
                      <div className="step">
                        <button
                          type="button"
                          onClick={() => setQuantity(qtyValue - 1)}
                          disabled={qtyValue <= 1}
                          aria-label={t("qtyDecrease")}
                        >
                          <Ic n="minus" />
                        </button>
                        <input
                          id="co-qty"
                          type="number"
                          min={1}
                          className="co-qty"
                          value={form.quantity}
                          onChange={(e) => update("quantity", e.target.value)}
                          aria-label={t("fields.quantity")}
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity((parseInt(form.quantity, 10) || 0) + 1)}
                          aria-label={t("qtyIncrease")}
                        >
                          <Ic n="plus" />
                        </button>
                      </div>
                    </div>
                    <div className="fld">
                      <FieldLabel required htmlFor="co-unit">
                        {t("fields.unitPrice")}
                      </FieldLabel>
                      <input
                        id="co-unit"
                        type="number"
                        step="0.001"
                        min={0}
                        inputMode="decimal"
                        className="inp co-num"
                        value={form.unit_price}
                        onChange={(e) =>
                          setForm((s) => ({
                            ...s,
                            unit_price: e.target.value,
                            total_override: null,
                            error: null,
                          }))
                        }
                      />
                    </div>
                  </div>

                  {/* The breakdown beside the figure is what makes the override
                      safe to offer: a typed total that no longer matches
                      "3 × 25,500" is visibly a decision rather than a typo, and
                      the server files a history row saying so. */}
                  <div className="calc">
                    <span>
                      <small>{t("totalComputed")}</small>
                      <span className="co-num-txt">
                        {t("totalBreakdown", {
                          qty: form.quantity || "—",
                          price: form.unit_price ? money(parseFloat(form.unit_price)) : "—",
                        })}
                      </span>
                    </span>
                    <b className="co-num-txt">{shownTotal !== null ? money(shownTotal) : "—"}</b>
                  </div>

                  {form.total_override !== null ? (
                    <div className="fld">
                      <div className="co-lblrow">
                        <FieldLabel htmlFor="co-total">{t("totalTyped")}</FieldLabel>
                        <button
                          type="button"
                          className="lnk"
                          onClick={() => update("total_override", null)}
                        >
                          <Ic n="rotate" />
                          {t("totalReset")}
                        </button>
                      </div>
                      <input
                        id="co-total"
                        type="number"
                        step="0.001"
                        min={0}
                        inputMode="decimal"
                        autoFocus
                        className="inp co-num"
                        value={form.total_override}
                        onChange={(e) => update("total_override", e.target.value)}
                      />
                      {/* A discount is stated, not left for someone to notice later. */}
                      {overrideDelta !== null && overrideDelta !== 0 && (
                        <p className="co-hint">
                          {t("totalOverridden", { delta: money(Math.abs(overrideDelta)) })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="lnk co-over"
                      disabled={computedTotal === null}
                      onClick={() =>
                        setForm((s) => ({
                          ...s,
                          total_override: computedTotal !== null ? formatPrice(computedTotal) : "",
                          error: null,
                        }))
                      }
                    >
                      {t("totalEdit")}
                    </button>
                  )}
                </FormSection>
              </>
            )}

            {form.error && (
              <div role="alert" className="co-err h-red">
                <Ic n="alert" />
                <span>{form.error}</span>
              </div>
            )}
          </div>

          <div className="dr-foot co-foot">
            <button type="button" className="fa" onClick={onClose} disabled={form.loading}>
              <span>{t("cancel")}</span>
            </button>
            <button
              type="button"
              className="fa pri wide"
              onClick={handleSubmit}
              disabled={form.loading || marketUnscoped}
            >
              <Ic n="check" />
              <span>{form.loading ? t("submitting") : t("submit")}</span>
            </button>
          </div>
        </aside>
      </FocusTrap>
    </div>
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
    <div className="co-known h-teal">
      <span className="co-known-av" aria-hidden="true">
        <Ic n="user" />
      </span>
      <div className="co-known-tx">
        <b dir="auto">
          {customer.name ?? customer.phone}
          <Ic n="check" />
        </b>
        <small>
          {t("existingCustomer")} · {t("customerOrders", { count: customer.orderCount })}
          {lastOrder ? ` · ${t("customerLastOrder", { date: lastOrder })}` : ""}
        </small>
      </div>
      <button type="button" className="co-use" onClick={onUse}>
        {t("useCustomer")}
      </button>
    </div>
  );
}

/**
 * Libya: the Darb pair a stored customer city names exactly — a single-area
 * city or a zone — with its catalogue id; null for a multi-area city (the
 * operator picks the zone) or an unknown string.
 */
function darbPairFor(
  city: string | null | undefined,
  destinations: DarbDestinationOption[],
): DarbDestinationOption | null {
  const resolved = resolveDarbAny(city);
  if (!resolved || resolved.area == null) return null;
  return findDestination(destinations, resolved.city, resolved.area);
}

/** Libya mobiles must be a Darb-accepted number; Tunisia lines are 8 digits. */
function isValidPhoneFor(marketCode: string | undefined, phone: string): boolean {
  if (marketCode === "ly") return toLibyanE164(phone) !== null;
  if (marketCode === "tn") {
    const digits = phone.replace(/\D/g, "").replace(/^00216/, "").replace(/^216/, "");
    return /^\d{8}$/.test(digits);
  }
  return phone.replace(/\D/g, "").length >= 6;
}

/** One searchable city control for Tunisia's governorates. */
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
    <div ref={wrapRef} className="co-dd">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={"inp co-trig" + (open ? " on" : "")}
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
      >
        <span className={value ? "" : "co-ph"} dir="auto">
          {value || t("cityPlaceholder")}
        </span>
        <Ic n="down" />
      </button>

      {open && (
        <div className="co-menu">
          <div className="co-menu-q">
            <Ic n="search" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("citySearchPlaceholder")}
              dir="auto"
            />
          </div>
          <div role="listbox" className="co-menu-list">
            {visible.length === 0 ? (
              <p className="co-menu-empty">{t("cityNoResults")}</p>
            ) : (
              visible.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={"co-opt" + (selected ? " on" : "")}
                    onClick={() => {
                      onSelect(o);
                      setOpen(false);
                    }}
                    dir="auto"
                  >
                    <span className="co-opt-ck">{selected && <Ic n="check" />}</span>
                    <span className="co-opt-n">{o.label}</span>
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
      <div className="inp co-prod">
        <ProductAvatar imageUrl={selected.image_url ?? null} productName={selected.name} size={24} />
        <span className="co-prod-n" dir="auto" title={selected.name}>
          {selected.name}
        </span>
        {price !== null && (
          <span className="co-prod-p">
            {formatPrice(price)} {currency}
          </span>
        )}
        <button type="button" className="co-x" onClick={onClear} aria-label={t("productClear")}>
          <Ic n="x" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="co-dd">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={"inp co-trig" + (open ? " on" : "")}
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
      >
        <span className="co-ph">{t("productPlaceholder")}</span>
        <Ic n="down" />
      </button>

      {open && (
        <div className="co-menu co-menu-wide">
          <div className="co-menu-q">
            <Ic n="search" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("productSearchPlaceholder")}
              dir="auto"
            />
          </div>
          <div role="listbox" className="co-menu-list">
            {visible.length === 0 ? (
              <p className="co-menu-empty">{t("cityNoResults")}</p>
            ) : (
              visible.map((p) => {
                const price = priceOf(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="co-opt"
                    onClick={() => {
                      onSelect(p.id);
                      setOpen(false);
                    }}
                  >
                    <ProductAvatar imageUrl={p.image_url ?? null} productName={p.name} size={26} />
                    <span className="co-opt-n" dir="auto">
                      {p.name}
                    </span>
                    {price !== null && (
                      <span className="co-opt-p">
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
