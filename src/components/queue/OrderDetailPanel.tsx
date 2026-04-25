"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { getStatusLabel } from "@/lib/status-labels";
import { canReopenOrder, EDIT_BLOCKED_STATUSES } from "@/lib/order-permissions";
import { fetcher } from "@/lib/swr-config";
import { isEditableTarget } from "@/lib/dom";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { StepperField } from "@/components/ui/StepperField";
import { useOrderMutation } from "@/hooks/useOrderMutation";
import type { Role } from "@/types";

const ScheduleDispatchModal = dynamic(
  () => import("./ScheduleDispatchModal").then((m) => m.ScheduleDispatchModal),
  { ssr: false },
);

interface HistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: string | null;
  actor_type: string | null;
  created_at: string;
}

interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}

interface OrderDetail {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_phone_2: string | null;
  customer_city: string | null;
  customer_address: string | null;
  customer_note: string | null;
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  city_id: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_fee: number;
  currency: string;
  status: string;
  assigned_to: string | null;
  market_id: string;
  updated_at: string;
  tracking_number: string | null;
  callback_scheduled_at: string | null;
  scheduled_dispatch_at: string | null;
  scheduled_dispatch_auto: boolean | null;
  scheduled_dispatch_carrier_id: string | null;
  history: HistoryEntry[];
  order_items: OrderItem[];
}

interface ProductSearchResult {
  id: string;
  name: string;
  unit_price: number;
  current_stock: number;
  is_active: boolean;
  product_variants: { id: string; label: string; is_active: boolean }[];
}

interface CitySearchResult {
  id: string;
  name: string;
  name_ar: string | null;
}

const TERMINAL_STATUSES = new Set([
  "delivered",
  "returned",
  "rejected",
  "cancelled",
]);

const FULFILLMENT_STATUS_VALUES = [
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
] as const;

interface OrderDetailPanelProps {
  orderId: string | null;
  onClose: () => void;
  onCallTerminated: (orderId: string) => void;
  onReturnToPool?: () => Promise<void>;
  role?: Role;
  userId?: string;
  onReopened?: () => void;
  /**
   * Optional pre-fetched order data (from the queue list). Shows the panel
   * instantly; SWR revalidates in the background and fills in history/stock.
   */
  fallbackOrder?: Record<string, unknown> | null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "#6B7280",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 8,
        marginTop: 20,
      }}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 2 }}>
      {children}
    </div>
  );
}

function translateHistoryNote(
  note: string | null,
  th: (k: string) => string,
): string | null {
  if (!note) return null;
  const map: Record<string, string> = {
    "Order received via webhook": th("createdFromWebhook"),
    "Assigned to agent": th("assignedToAgent"),
    "Reassigned to agent": th("reassignedToAgent"),
    "Cancelled via storefront webhook": th("cancelled"),
  };
  return map[note] ?? note;
}

export function OrderDetailPanel({
  orderId,
  onClose,
  onCallTerminated,
  onReturnToPool,
  role,
  userId,
  onReopened,
  fallbackOrder,
}: OrderDetailPanelProps) {
  const t = useTranslations("orders.detail");
  const th = useTranslations("orders.history");
  const ts = useTranslations("orders.statuses");
  const locale = useLocale();

  const swrKey = orderId ? `/api/orders/${orderId}` : null;

  // Build fallback envelope { data: OrderDetail } from the queue row.
  // Empty history[] avoids the length crash; SWR revalidate will fill it in.
  const fallbackEnvelope = useMemo(
    () =>
      fallbackOrder && orderId
        ? {
            data: {
              history: [],
              product_current_stock: null,
              ...fallbackOrder,
              id: orderId,
            } as unknown as OrderDetail,
          }
        : undefined,
    [fallbackOrder, orderId],
  );

  const { data: swrData, error: swrError, isLoading, mutate } = useSWR<{ data: OrderDetail }>(
    swrKey,
    fetcher,
    { keepPreviousData: false, fallbackData: fallbackEnvelope },
  );
  const order = swrData?.data ?? null;

  const [returningToPool, setReturningToPool] = useState(false);
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [fulfillmentNote, setFulfillmentNote] = useState("");
  const [isDamaged, setIsDamaged] = useState(false);
  const [fulfillmentError, setFulfillmentError] = useState<string | null>(null);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenWarning, setReopenWarning] = useState<string | null>(null);

  const [saveFlash, setSaveFlash] = useState<"saved" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scheduleDispatchOpen, setScheduleDispatchOpen] = useState(false);
  const [cancelingSchedule, setCancelingSchedule] = useState(false);

  const nameFieldRef = useRef<HTMLDivElement>(null);

  const { commit } = useOrderMutation(orderId ?? "__none__");

  const canEdit = order !== null && !EDIT_BLOCKED_STATUSES.has(order.status);

  // Single /api/products/search fetch provides both the picker list and current-product variants
  const { data: productsData, mutate: mutateProducts } = useSWR<{ data: ProductSearchResult[] }>(
    canEdit ? "/api/products/search" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60 * 1000 },
  );
  const currentProduct =
    productsData?.data?.find((p) => p.id === order?.product_id) ?? null;
  const variantOptions = currentProduct?.product_variants?.filter((v) => v.is_active) ?? [];

  const productOptions = useMemo<ComboboxOption[]>(
    () =>
      (productsData?.data ?? []).map((p) => ({
        id: p.id,
        label: p.name,
        hint:
          p.current_stock <= 0
            ? t("outOfStock")
            : `${p.current_stock} · ${p.unit_price}`,
      })),
    [productsData, t],
  );

  const loadProducts = useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      const q = query.toLowerCase();
      return q
        ? productOptions.filter((o) => o.label.toLowerCase().includes(q))
        : productOptions;
    },
    [productOptions],
  );

  const { data: citiesData } = useSWR<{ data: CitySearchResult[] }>(
    canEdit ? "/api/cities" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );

  const cityOptions = useMemo(
    () =>
      (citiesData?.data ?? []).map((c) => ({
        id: c.id,
        label: locale === "ar" && c.name_ar ? c.name_ar : c.name,
      })),
    [citiesData, locale],
  );

  const loadCities = useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      const q = query.toLowerCase();
      return q
        ? cityOptions.filter((o) => o.label.toLowerCase().includes(q))
        : cityOptions;
    },
    [cityOptions],
  );

  const runCommit = useCallback(
    async (updates: Record<string, unknown>) => {
      try {
        setSaveError(null);
        await commit(updates);
        setSaveFlash("saved");
        if ("product_id" in updates) mutateProducts();
        setTimeout(() => setSaveFlash(null), 1500);
      } catch (e) {
        setSaveFlash("error");
        setSaveError(e instanceof Error ? e.message : t("inlineSaveError"));
        setTimeout(() => setSaveFlash(null), 2500);
      }
    },
    [commit, mutateProducts, t],
  );

  useEffect(() => {
    if (!order || !canEdit) return;
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "e" || e.key === "E") {
        const input = nameFieldRef.current?.querySelector("input");
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [order, canEdit, onClose]);

  if (orderId === null) return null;

  const errorMessage = swrError
    ? t("loadError")
    : !isLoading && swrData && !swrData.data
      ? t("orderNotFound")
      : null;

  const canReturnToPool =
    onReturnToPool !== undefined &&
    order !== null &&
    order.assigned_to !== null &&
    !TERMINAL_STATUSES.has(order.status);

  const canFulfillmentOverride =
    role &&
    (role === "market_manager" || role === "super_admin") &&
    order !== null;

  async function handleFulfillmentOverride() {
    if (!fulfillmentStatus || !orderId) return;
    if (!fulfillmentNote.trim()) {
      setFulfillmentError(t("fulfillmentNoteRequired"));
      return;
    }
    setFulfillmentLoading(true);
    setFulfillmentError(null);
    try {
      const body: Record<string, unknown> = {
        status: fulfillmentStatus,
        note: fulfillmentNote.trim(),
      };
      if (fulfillmentStatus === "returned" && isDamaged) body.is_damaged = true;
      const res = await fetch(`/api/orders/${orderId}/fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setFulfillmentError(json.error ?? `Erreur ${res.status}`);
        return;
      }
      await mutate();
      setFulfillmentStatus("");
      setFulfillmentNote("");
      setIsDamaged(false);
    } catch {
      setFulfillmentError(t("loadError"));
    } finally {
      setFulfillmentLoading(false);
    }
  }

  async function handleReturnToPool() {
    if (!onReturnToPool) return;
    setReturningToPool(true);
    try {
      await onReturnToPool();
    } finally {
      setReturningToPool(false);
    }
  }

  async function handleCopyPhone() {
    if (!order?.customer_phone) return;
    try {
      await navigator.clipboard.writeText(order.customer_phone);
      setPhoneCopied(true);
      setTimeout(() => setPhoneCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const canReopen =
    role === undefined &&
    userId !== undefined &&
    order !== null &&
    canReopenOrder("agent", userId, {
      status: order.status,
      assigned_to: order.assigned_to,
      updated_at: order.updated_at,
    });

  async function handleReopen() {
    if (!orderId) return;
    setReopening(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/reopen`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReopenModalOpen(false);
        return;
      }
      if (json.warning) setReopenWarning(json.warning as string);
      setReopenModalOpen(false);
      await mutate();
      onReopened?.();
    } finally {
      setReopening(false);
    }
  }

  const mapsHref =
    order && (order.customer_address || order.customer_city)
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [order.customer_address, order.customer_city].filter(Boolean).join(", "),
        )}`
      : null;

  const canScheduleDispatch =
    role === undefined && order !== null && order.status === "confirmed";
  const isDispatchScheduled =
    order !== null && order.status === "dispatch_scheduled";

  async function handleCancelSchedule() {
    if (!orderId) return;
    setCancelingSchedule(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "confirmed",
          note: "Livraison planifiée annulée",
        }),
      });
      if (res.ok) await mutate();
    } finally {
      setCancelingSchedule(false);
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-ink-primary/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 end-0 h-full w-[480px] z-50 flex flex-col overflow-hidden bg-surface-card border-s border-line-subtle shadow-panel"
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderBottom: "1px solid #E1E3E5",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
            {t("title")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {saveFlash === "saved" && (
              <span style={{ fontSize: 12, color: "#059669" }}>✓ {t("inlineSaved")}</span>
            )}
            {saveFlash === "error" && (
              <span style={{ fontSize: 12, color: "#DC2626" }}>{t("inlineSaveError")}</span>
            )}
            <button
              style={{
                background: "none",
                border: "none",
                fontSize: 14,
                color: "#6B7280",
                cursor: "pointer",
                padding: 0,
              }}
              onClick={onClose}
            >
              {t("close")}
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 100px" }}>
          {isLoading && !order && (
            <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#6B7280" }}>
              {t("loading")}
            </div>
          )}

          {errorMessage && (
            <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#DC2626" }}>
              {errorMessage}
            </div>
          )}

          {order && (
            <>
              {!canEdit && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "8px 12px",
                    backgroundColor: "#FEF3C7",
                    border: "1px solid #FCD34D",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "#92400E",
                  }}
                >
                  {t("editBlockedStatus")}
                </div>
              )}

              {order.status === "callback_scheduled" && order.callback_scheduled_at && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 12px",
                    backgroundColor: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "#1E3A8A",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    {t("scheduledCallbackBanner")}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {new Date(order.callback_scheduled_at).toLocaleString(
                      locale === "ar" ? "ar-LY" : "fr-TN",
                      {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </div>
                </div>
              )}

              {isDispatchScheduled && order.scheduled_dispatch_at && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 12px",
                    backgroundColor: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "#1E3A8A",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {order.scheduled_dispatch_auto
                        ? t("scheduledDispatchAutoBanner")
                        : t("scheduledDispatchBanner")}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {new Date(order.scheduled_dispatch_at).toLocaleString(
                        locale === "ar" ? "ar-LY" : "fr-TN",
                        {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={cancelingSchedule}
                    onClick={handleCancelSchedule}
                    style={{
                      background: "none",
                      border: "1px solid #BFDBFE",
                      color: cancelingSchedule ? "#9CA3AF" : "#1E3A8A",
                      fontSize: 12,
                      cursor: cancelingSchedule ? "not-allowed" : "pointer",
                      padding: "4px 10px",
                      borderRadius: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cancelingSchedule
                      ? t("scheduledDispatchCanceling")
                      : t("scheduledDispatchCancel")}
                  </button>
                </div>
              )}

              <SectionLabel>{t("client")}</SectionLabel>

              <div ref={nameFieldRef} style={{ marginBottom: 8 }}>
                <FieldLabel>{t("fieldName")}</FieldLabel>
                <InlineField
                  value={order.customer_name}
                  onCommit={(v) => runCommit({ customer_name: v })}
                  readOnly={!canEdit}
                />
              </div>

              <div style={{ marginBottom: 8 }}>
                <FieldLabel>{t("fieldPhone")}</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <InlineField
                      value={order.customer_phone}
                      onCommit={(v) => runCommit({ customer_phone: v })}
                      type="tel"
                      readOnly={!canEdit}
                    />
                  </div>
                  <a
                    href={`tel:${order.customer_phone}`}
                    style={{ fontSize: 12, color: "#6B7280", textDecoration: "none" }}
                  >
                    ☎
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    style={{
                      fontSize: 12,
                      background: "none",
                      border: "1px solid #E1E3E5",
                      color: "#6B7280",
                      cursor: "pointer",
                      padding: "2px 8px",
                      borderRadius: 4,
                    }}
                  >
                    {phoneCopied ? t("copied") : t("copyPhone")}
                  </button>
                </div>
              </div>

              {/* Phone 2 */}
              <div style={{ marginBottom: 8 }}>
                <FieldLabel>{t("fieldPhone2")}</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <InlineField
                      value={order.customer_phone_2 ?? ""}
                      onCommit={(v) => runCommit({ customer_phone_2: v || null })}
                      type="tel"
                      readOnly={!canEdit}
                    />
                  </div>
                  {order.customer_phone_2 && (
                    <a
                      href={`tel:${order.customer_phone_2}`}
                      style={{ fontSize: 12, color: "#6B7280", textDecoration: "none" }}
                    >
                      ☎
                    </a>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <FieldLabel>{t("fieldCity")}</FieldLabel>
                <Combobox
                  value={order.customer_city ?? ""}
                  options={[]}
                  loadOptions={loadCities}
                  onCommit={(id) => runCommit({ city_id: id })}
                  placeholder={t("pickCity")}
                  readOnly={!canEdit}
                />
              </div>

              <div style={{ marginBottom: 8 }}>
                <FieldLabel>{t("fieldAddress")}</FieldLabel>
                <InlineField
                  value={order.customer_address ?? ""}
                  onCommit={(v) => runCommit({ customer_address: v })}
                  readOnly={!canEdit}
                />
              </div>

              {mapsHref && (
                <div style={{ marginBottom: 6 }}>
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}
                  >
                    📍 {t("openMaps")}
                  </a>
                </div>
              )}

              {order.customer_note && (
                <div style={{ marginBottom: 6, fontSize: 13, color: "#6B7280", fontStyle: "italic" }}>
                  {t("note")}: {order.customer_note}
                </div>
              )}

              <SectionLabel>{t("order")}</SectionLabel>

              {/* Multi-item order section */}
              {(() => {
                const items: OrderItem[] = order.order_items?.length
                  ? order.order_items
                  : [{
                      id: "legacy",
                      order_id: order.id,
                      product_id: order.product_id,
                      product_name: order.product_name,
                      variant_id: order.variant_id,
                      variant_label: order.variant_label,
                      quantity: order.quantity,
                      unit_price: order.unit_price,
                      line_total: order.total_price - (order.delivery_fee ?? 0),
                      created_at: order.updated_at,
                      updated_at: order.updated_at,
                    }];

                return (
                  <div>
                    {items.map((item, idx) => (
                      <div
                        key={item.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto auto auto",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 6,
                        }}
                      >
                        <Combobox
                          value={item.product_name}
                          options={[]}
                          loadOptions={loadProducts}
                          onCommit={async (productId) => {
                            if (item.id === "legacy") {
                              runCommit({ product_id: productId });
                            } else {
                              await fetch(`/api/orders/${order.id}/items/${item.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ product_id: productId }),
                              });
                              mutate();
                            }
                          }}
                          placeholder={t("pickProduct")}
                          readOnly={!canEdit}
                        />
                        <StepperField
                          value={item.quantity}
                          onCommit={async (qty) => {
                            if (item.id === "legacy") {
                              runCommit({ quantity: qty });
                            } else {
                              await fetch(`/api/orders/${order.id}/items/${item.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ quantity: qty }),
                              });
                              mutate();
                            }
                          }}
                          min={1}
                          readOnly={!canEdit}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", whiteSpace: "nowrap" }}>
                          {item.line_total} {order.currency}
                        </span>
                        {canEdit && items.length > 1 && item.id !== "legacy" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await fetch(`/api/orders/${order.id}/items/${item.id}`, { method: "DELETE" });
                              mutate();
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#9CA3AF",
                              fontSize: 16,
                              cursor: "pointer",
                              padding: "0 4px",
                            }}
                            title={t("removeItem")}
                          >
                            ×
                          </button>
                        )}
                        {(idx === 0 || item.id === "legacy") && variantOptions.length > 0 && (
                          <div
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <select
                              value={item.variant_id ?? ""}
                              disabled={!canEdit}
                              onChange={(e) => {
                                if (item.id === "legacy") {
                                  runCommit({ variant_id: e.target.value });
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                fontSize: 13,
                                border: "1px solid #E1E3E5",
                                borderRadius: 4,
                                color: "#1A1A1A",
                                backgroundColor: "#FFFFFF",
                              }}
                            >
                              <option value="">—</option>
                              {variantOptions.map((v) => (
                                <option key={v.id} value={v.id}>{v.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}

                    {canEdit && (() => {
                      const firstItem = items[0];
                      // We need a valid product_id to POST — use the first item's product
                      const addProductId = firstItem?.product_id ?? order.product_id;
                      const addUnitPrice = firstItem?.unit_price ?? order.unit_price;
                      if (!addProductId) return null;
                      return (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await fetch(`/api/orders/${order.id}/items`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                product_id: addProductId,
                                quantity: 1,
                                unit_price: addUnitPrice,
                              }),
                            });
                            if (res.ok) {
                              mutate();
                            } else {
                              const body = await res.json().catch(() => ({}));
                              alert(body.error ?? "Failed to add product");
                            }
                          }}
                          style={{
                            fontSize: 13,
                            color: "#6B7280",
                            background: "none",
                            border: "1px dashed #D1D5DB",
                            borderRadius: 4,
                            padding: "4px 10px",
                            cursor: "pointer",
                            marginBottom: 8,
                            width: "100%",
                          }}
                        >
                          {t("addProduct")}
                        </button>
                      );
                    })()}

                    {/* Delivery fee */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 4 }}>
                      <FieldLabel>{t("fieldDeliveryFee")}</FieldLabel>
                      <div style={{ width: 100 }}>
                        <InlineField
                          value={String(order.delivery_fee ?? 0)}
                          onCommit={(v) => runCommit({ delivery_fee: parseFloat(v) || 0 })}
                          type="number"
                          readOnly={!canEdit}
                        />
                      </div>
                    </div>

                    {/* Grand total */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 8, paddingTop: 8, borderTop: "1px solid #E1E3E5" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>{t("grandTotal")}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A" }}>
                        {order.total_price} {order.currency}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {saveError && (
                <div style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>{saveError}</div>
              )}

              <SectionLabel>{t("history")}</SectionLabel>
              {order.history.length === 0 ? (
                <div style={{ fontSize: 13, color: "#6B7280" }}>{t("emptyHistory")}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {order.history.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        fontSize: 13,
                      }}
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          backgroundColor: "#9CA3AF",
                          marginTop: 5,
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div style={{ color: "#1A1A1A" }}>
                          {entry.from_status
                            ? th("transition", {
                                from: getStatusLabel(entry.from_status, locale),
                                to: getStatusLabel(entry.to_status, locale),
                              })
                            : getStatusLabel(entry.to_status, locale)}
                        </div>
                        {entry.note && (
                          <div style={{ color: "#6B7280", fontSize: 12 }}>
                            {translateHistoryNote(entry.note, th)}
                          </div>
                        )}
                        <div style={{ color: "#9CA3AF", fontSize: 12 }}>
                          {new Date(entry.created_at).toLocaleString(
                            locale === "ar" ? "ar-LY" : "fr-TN",
                            {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canFulfillmentOverride && (
                <>
                  <SectionLabel>{t("fulfillmentTitle")}</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <select
                      value={fulfillmentStatus}
                      onChange={(e) => setFulfillmentStatus(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: 13,
                        border: "1px solid #E1E3E5",
                        borderRadius: 4,
                        color: "#1A1A1A",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="">{t("fulfillmentPlaceholder")}</option>
                      {FULFILLMENT_STATUS_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {ts(value as Parameters<typeof ts>[0])}
                        </option>
                      ))}
                    </select>
                    {fulfillmentStatus === "returned" && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1A1A1A" }}>
                        <input
                          type="checkbox"
                          checked={isDamaged}
                          onChange={(e) => setIsDamaged(e.target.checked)}
                        />
                        {t("fulfillmentDamaged")}
                      </label>
                    )}
                    <input
                      type="text"
                      placeholder={t("fulfillmentNote")}
                      value={fulfillmentNote}
                      onChange={(e) => setFulfillmentNote(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: 13,
                        border: "1px solid #E1E3E5",
                        borderRadius: 4,
                        color: "#1A1A1A",
                        boxSizing: "border-box",
                      }}
                    />
                    {fulfillmentError && (
                      <div style={{ fontSize: 12, color: "#DC2626" }}>{fulfillmentError}</div>
                    )}
                    <button
                      disabled={!fulfillmentStatus || fulfillmentLoading}
                      onClick={handleFulfillmentOverride}
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        backgroundColor: fulfillmentStatus && !fulfillmentLoading ? "#1A1A1A" : "#E1E3E5",
                        color: fulfillmentStatus && !fulfillmentLoading ? "#FFFFFF" : "#9CA3AF",
                        border: "none",
                        borderRadius: 4,
                        cursor: fulfillmentStatus && !fulfillmentLoading ? "pointer" : "not-allowed",
                      }}
                    >
                      {fulfillmentLoading ? t("fulfillmentUpdating") : t("fulfillmentApply")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Reopen warning banner */}
        {reopenWarning && (
          <div style={{ padding: "10px 24px", backgroundColor: "#FEF3C7", borderTop: "1px solid #FCD34D", fontSize: 13, color: "#92400E" }}>
            {t("reopenWarning")}
          </div>
        )}

        {/* Fixed bottom action bar */}
        {order && (
          <div
            style={{
              padding: "12px 24px",
              borderTop: "1px solid #E1E3E5",
              flexShrink: 0,
              backgroundColor: "#FFFFFF",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {canEdit && (
              <div style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center" }}>
                {t("pressEToEdit")}
              </div>
            )}
            {canReturnToPool && (
              <button
                disabled={returningToPool}
                onClick={handleReturnToPool}
                style={{
                  background: "none",
                  border: "none",
                  color: returningToPool ? "#9CA3AF" : "#DC2626",
                  fontSize: 13,
                  cursor: returningToPool ? "not-allowed" : "pointer",
                  padding: 0,
                  textAlign: "start",
                }}
              >
                {t("returnToPool")}
              </button>
            )}
            {canReopen && (
              <button
                disabled={reopening}
                onClick={() => setReopenModalOpen(true)}
                style={{
                  background: "none",
                  border: "1px solid #E1E3E5",
                  color: reopening ? "#9CA3AF" : "#374151",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: reopening ? "not-allowed" : "pointer",
                  padding: "8px 0",
                  borderRadius: 4,
                  width: "100%",
                }}
              >
                {reopening ? t("reopening") : t("reopen")}
              </button>
            )}
            {canScheduleDispatch && (
              <button
                type="button"
                onClick={() => setScheduleDispatchOpen(true)}
                style={{
                  background: "none",
                  border: "1px solid #E1E3E5",
                  color: "#374151",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: "8px 0",
                  borderRadius: 4,
                  width: "100%",
                }}
              >
                {t("scheduleDispatchAction")}
              </button>
            )}
            <button
              style={{
                width: "100%",
                backgroundColor: "#1A1A1A",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "0.25rem",
                fontSize: 14,
                padding: "12px 0",
                cursor: "pointer",
              }}
              onClick={() => onCallTerminated(orderId!)}
            >
              {t("callEnded")}
            </button>
          </div>
        )}
      </div>

      {scheduleDispatchOpen && order && (
        <ScheduleDispatchModal
          orderId={order.id}
          marketId={order.market_id}
          onClose={() => setScheduleDispatchOpen(false)}
          onSuccess={async () => {
            setScheduleDispatchOpen(false);
            await mutate();
          }}
        />
      )}

      {/* Reopen confirmation modal */}
      {reopenModalOpen && order && (
        <>
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(26,26,26,0.5)", zIndex: 60 }}
            onClick={() => !reopening && setReopenModalOpen(false)}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#FFFFFF",
              borderRadius: 8,
              padding: 24,
              width: 400,
              zIndex: 70,
              boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", marginBottom: 12 }}>
              {t("reopenConfirmTitle")}
            </div>
            <div style={{ fontSize: 14, color: "#374151", marginBottom: 20, lineHeight: 1.5 }}>
              {order.tracking_number ? t("reopenConfirmBody") : t("reopenConfirmBodyNoTracking")}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                disabled={reopening}
                onClick={() => setReopenModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  background: "none",
                  border: "1px solid #E1E3E5",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                {t("reopenCancel")}
              </button>
              <button
                disabled={reopening}
                onClick={handleReopen}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  backgroundColor: reopening ? "#E1E3E5" : "#1A1A1A",
                  color: reopening ? "#9CA3AF" : "#FFFFFF",
                  border: "none",
                  borderRadius: 4,
                  cursor: reopening ? "not-allowed" : "pointer",
                  fontWeight: 500,
                }}
              >
                {reopening ? t("reopening") : t("reopenConfirm")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
