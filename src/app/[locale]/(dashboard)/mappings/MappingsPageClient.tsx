"use client";

import React, { useState, useCallback } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode } from "@/lib/markets";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const fetcher = (url: string) => fetch(url, { credentials: "same-origin" }).then((r) => r.json());

type Tab = "products" | "cities";

interface MappingsPageClientProps {
  role: Role;
  marketId: string;
  locale: string;
}

// --- shared row shapes ------------------------------------------------------

interface UnmatchedOrder {
  id: string;
  created_at: string;
  mapping_status: "needs_review" | "unmatched";
  external_platform: string;
  storefront_id: string;
  product_name: string;
  external_product_id: string | null;
  external_variant_id: string | null;
  product_id: string | null;
  customer_city: string | null;
  external_route_id: string | null;
  city_id: string | null;
  dexpress_state_id: number | null;
}

interface ProductMappingRow {
  id: string;
  storefront_id: string;
  external_variant_id: string;
  external_product_id: string | null;
  product_id: string;
  storefronts: { name: string } | null;
  products: { name: string; sku: string | null } | null;
  product_variants: { label: string } | null;
}

/**
 * A city bind-target option — a cities row (TN) or a dexpress_states row (LY),
 * as returned by GET /api/mappings/cities. dexpress_states has no name_ar.
 */
interface CityBindOption {
  id: string | number;
  name: string;
  name_ar: string | null;
}

function statusTone(status: string): BadgeTone {
  if (status === "mapped") return "success";
  if (status === "needs_review") return "warning";
  return "critical";
}

// ---------------------------------------------------------------------------

export function MappingsPageClient({ role, marketId }: MappingsPageClientProps) {
  const t = useTranslations("mappings");
  const { marketId: scopeMarketId } = useMarketScope();

  // super_admin follows the global market scope; market_manager is pinned.
  const selectedMarketId = role === "super_admin" ? scopeMarketId ?? "" : marketId;

  const [tab, setTab] = useState<Tab>("products");

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex gap-0 border-b border-line">
        {(["products", "cities"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-5 py-2 text-[14px] font-semibold transition-colors ${
              tab === key
                ? "border-ink-primary text-ink-primary"
                : "border-transparent text-ink-secondary hover:text-ink-primary"
            }`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {/* Each tab owns its own data fetching so the ?type= filter is applied
          server-side — only resolver-era, bindable orders are surfaced. */}
      {tab === "products" ? (
        <ProductTab marketId={selectedMarketId} />
      ) : (
        <CityTab marketId={selectedMarketId} />
      )}
    </div>
  );
}

// --- list state wrapper -----------------------------------------------------
// Distinguishes loading / error / empty so a failed fetch never silently
// looks like "nothing to review".

function ListState({
  isLoading,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("mappings");
  if (isLoading) {
    return (
      <div className="px-6 py-10 text-center text-[14px] text-ink-secondary">
        {t("loading")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 text-center text-[14px] text-status-critical">
        {t("loadError")}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="px-6 py-10 text-center text-[14px] text-ink-secondary">
        {emptyText}
      </div>
    );
  }
  return <>{children}</>;
}

// === Products tab ===========================================================

function ProductTab({ marketId }: { marketId: string }) {
  const t = useTranslations("mappings");
  const [binding, setBinding] = useState<UnmatchedOrder | null>(null);

  const marketQuery = marketId ? `&market_id=${marketId}` : "";

  // Bindable, resolver-era orders missing a product (server-filtered).
  const {
    data: ordersData,
    error: ordersError,
    isLoading: ordersLoading,
    mutate: mutateOrders,
  } = useSWR<{ data: UnmatchedOrder[] }>(
    `/api/mappings/unmatched?type=products${marketQuery}`,
    fetcher,
  );
  const {
    data: mappingsData,
    error: mappingsError,
    isLoading: mappingsLoading,
    mutate: mutateMappings,
  } = useSWR<{ data: ProductMappingRow[] }>(
    marketId ? `/api/mappings/products?market_id=${marketId}` : `/api/mappings/products`,
    fetcher,
  );
  // Products of the current market — the bind target options.
  const { data: productsData } = useSWR<{ data: { id: string; name: string }[] }>(
    marketId ? `/api/products?market_id=${marketId}` : null,
    fetcher,
  );

  const orders = ordersData?.data ?? [];
  const mappings = mappingsData?.data ?? [];
  const products = productsData?.data ?? [];

  const onSaved = useCallback(() => {
    setBinding(null);
    mutateOrders();
    mutateMappings();
  }, [mutateOrders, mutateMappings]);

  return (
    <>
      {/* Unmatched orders review panel */}
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
          {t("products.reviewHeading")}
        </h2>
        <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card">
          <ListState
            isLoading={ordersLoading}
            error={ordersError}
            isEmpty={orders.length === 0}
            emptyText={t("products.reviewEmpty")}
          >
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between border-b border-line-subtle px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] text-ink-primary">{o.product_name}</span>
                  <span className="text-[12px] text-ink-muted">
                    {o.external_platform} · {t("products.variantId")}:{" "}
                    {o.external_variant_id ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(o.mapping_status)} dot>
                    {t(`status.${o.mapping_status}`)}
                  </Badge>
                  <Button variant="secondary" size="sm" onClick={() => setBinding(o)}>
                    {t("products.bind")}
                  </Button>
                </div>
              </div>
            ))}
          </ListState>
        </div>
      </section>

      {/* Existing mappings */}
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
          {t("products.mappingsHeading")}
        </h2>
        <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card">
          <ListState
            isLoading={mappingsLoading}
            error={mappingsError}
            isEmpty={mappings.length === 0}
            emptyText={t("products.mappingsEmpty")}
          >
            <div className="flex items-center border-b border-line bg-surface-page px-4 py-2 text-[11px] font-semibold uppercase text-ink-secondary">
              <div className="flex-1">{t("products.colStorefront")}</div>
              <div className="flex-1">{t("products.colVariantId")}</div>
              <div className="flex-1">{t("products.colProduct")}</div>
            </div>
            {mappings.map((m) => (
              <div
                key={m.id}
                className="flex items-center border-b border-line-subtle px-4 py-3 text-[14px] text-ink-primary last:border-b-0"
              >
                <div className="flex-1">{m.storefronts?.name ?? "—"}</div>
                <div className="flex-1 tabular-nums">{m.external_variant_id}</div>
                <div className="flex-1">
                  {m.products?.name ?? "—"}
                  {m.product_variants?.label ? ` · ${m.product_variants.label}` : ""}
                </div>
              </div>
            ))}
          </ListState>
        </div>
      </section>

      {binding && (
        <BindProductModal
          order={binding}
          products={products}
          onClose={() => setBinding(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function BindProductModal({
  order,
  products,
  onClose,
  onSaved,
}: {
  order: UnmatchedOrder;
  products: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("mappings");
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!productId) {
      setError(t("products.selectProduct"));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/mappings/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storefront_id: order.storefront_id,
        external_variant_id: order.external_variant_id,
        external_product_id: order.external_product_id,
        product_id: productId,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `Error ${res.status}`);
      return;
    }
    onSaved();
  }, [productId, order, onSaved, t]);

  return (
    <ModalShell title={t("products.bindTitle")} onClose={onClose}>
      <p className="mb-4 text-[13px] text-ink-secondary">
        {t("products.bindDescription", {
          variant: order.external_variant_id ?? "—",
          name: order.product_name,
        })}
      </p>
      <label className="mb-2 block text-[13px] font-medium text-ink-secondary">
        {t("products.colProduct")}
      </label>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="mb-4 w-full rounded-md border border-line-strong bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
      >
        <option value="">{t("products.selectProduct")}</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <p className="mb-3 text-[13px] text-status-critical">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="primary" size="md" onClick={save} disabled={saving}>
          {t("save")}
        </Button>
      </div>
    </ModalShell>
  );
}

// === Cities tab =============================================================

function CityTab({ marketId }: { marketId: string }) {
  const t = useTranslations("mappings");
  const [binding, setBinding] = useState<UnmatchedOrder | null>(null);

  const marketQuery = marketId ? `&market_id=${marketId}` : "";
  // Libya binds to a Dexpress state; Tunisia binds to an OMS city.
  const isDexpress = marketIdToCode(marketId) === "ly";

  const {
    data: ordersData,
    error: ordersError,
    isLoading: ordersLoading,
    mutate: mutateOrders,
  } = useSWR<{ data: UnmatchedOrder[] }>(
    `/api/mappings/unmatched?type=cities${marketQuery}`,
    fetcher,
  );
  // The destination catalogue for this market — the bind-target options.
  // GET /api/mappings/cities returns cities (TN) or dexpress_states (LY).
  const { data: optionsData } = useSWR<{ data: CityBindOption[] }>(
    marketId ? `/api/mappings/cities?market_id=${marketId}` : `/api/mappings/cities`,
    fetcher,
  );

  const orders = ordersData?.data ?? [];
  const bindOptions = optionsData?.data ?? [];

  const onSaved = useCallback(() => {
    setBinding(null);
    mutateOrders();
  }, [mutateOrders]);

  return (
    <>
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
          {t("cities.reviewHeading")}
        </h2>
        <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card">
          <ListState
            isLoading={ordersLoading}
            error={ordersError}
            isEmpty={orders.length === 0}
            emptyText={t("cities.reviewEmpty")}
          >
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between border-b border-line-subtle px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] text-ink-primary">
                    {o.customer_city ?? "—"}
                  </span>
                  <span className="text-[12px] text-ink-muted">
                    {o.external_platform}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(o.mapping_status)} dot>
                    {t(`status.${o.mapping_status}`)}
                  </Badge>
                  <Button variant="secondary" size="sm" onClick={() => setBinding(o)}>
                    {t("cities.bind")}
                  </Button>
                </div>
              </div>
            ))}
          </ListState>
        </div>
      </section>

      {binding && (
        <BindCityModal
          order={binding}
          isDexpress={isDexpress}
          options={bindOptions}
          onClose={() => setBinding(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function BindCityModal({
  order,
  isDexpress,
  options,
  onClose,
  onSaved,
}: {
  order: UnmatchedOrder;
  isDexpress: boolean;
  options: CityBindOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("mappings");
  // The <select> value is always a string; coerce to the right type on submit.
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!selectedId) {
      setError(t("cities.selectCity"));
      return;
    }
    setSaving(true);
    setError(null);
    // The bind is per-order: Libya → dexpress_state_id (number); Tunisia →
    // city_id (uuid string). The order itself carries the market, so no
    // market_id is needed.
    const destination = isDexpress
      ? { dexpress_state_id: Number(selectedId) }
      : { city_id: selectedId };
    const res = await fetch("/api/mappings/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: order.id, ...destination }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `Error ${res.status}`);
      return;
    }
    onSaved();
  }, [selectedId, isDexpress, order, onSaved, t]);

  return (
    <ModalShell title={t("cities.bindTitle")} onClose={onClose}>
      <p className="mb-4 text-[13px] text-ink-secondary">
        {t("cities.bindDescription", { name: order.customer_city ?? "—" })}
      </p>
      <label className="mb-2 block text-[13px] font-medium text-ink-secondary">
        {t("cities.colCity")}
      </label>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="mb-4 w-full rounded-md border border-line-strong bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
      >
        <option value="">{t("cities.selectCity")}</option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.name}
            {o.name_ar ? ` · ${o.name_ar}` : ""}
          </option>
        ))}
      </select>
      {error && <p className="mb-3 text-[13px] text-status-critical">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="primary" size="md" onClick={save} disabled={saving}>
          {t("save")}
        </Button>
      </div>
    </ModalShell>
  );
}

// === shared modal shell =====================================================

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] rounded-card border border-line-subtle bg-surface-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[16px] font-semibold text-ink-primary">{title}</h2>
        {children}
      </div>
    </div>
  );
}
