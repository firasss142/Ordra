"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { X, Phone as PhoneIcon, Copy, Check, MapPin, Plus, Calendar, RotateCcw, AlertTriangle, Pencil } from "lucide-react";
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

function SectionCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "bg-surface-card border border-line-subtle rounded-card overflow-hidden",
        className,
      ].join(" ")}
    >
      <div className="px-4 pt-3 pb-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {title}
        </h3>
      </div>
      <div className="px-4 pb-4 pt-2 flex flex-col gap-0">{children}</div>
    </section>
  );
}

/** A single read/edit row inside SectionCard */
function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 py-2.5 border-b border-line-subtle last:border-0">
      <span className="w-[88px] flex-shrink-0 text-[12px] text-ink-secondary leading-[1.4]">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
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
      <div className="fixed inset-0 z-40 bg-ink-primary/40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 end-0 h-full w-full sm:w-[480px] z-50 flex flex-col overflow-hidden bg-surface-page border-s border-line-subtle shadow-panel animate-[slideInEnd_180ms_ease-out]">

        {/* ── Sticky header ─────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-surface-card border-b border-line-subtle">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center h-5 px-1.5 rounded bg-surface-page border border-line-subtle text-[10px] font-semibold tabular-nums text-ink-muted tracking-wide flex-shrink-0">
                #{(order?.id ?? orderId ?? "").slice(0, 8).toUpperCase()}
              </span>
              {order && (
                <span className="text-[12px] text-ink-secondary truncate">
                  {ts(order.status as Parameters<typeof ts>[0])}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {saveFlash === "saved" && (
                <span className="inline-flex items-center gap-1 text-[11px] text-status-success font-medium">
                  <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                  {t("inlineSaved")}
                </span>
              )}
              {saveFlash === "error" && (
                <span className="text-[11px] text-status-critical">{t("inlineSaveError")}</span>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                className="inline-flex items-center justify-center w-8 h-8 rounded-card text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Loading / error */}
          {isLoading && !order && (
            <div className="py-16 text-center text-[13px] text-ink-secondary">{t("loading")}</div>
          )}
          {errorMessage && (
            <div className="py-16 text-center text-[13px] text-status-critical">{errorMessage}</div>
          )}

          {order && (
            <>
              {/* ── Identity hero ── */}
              <div className="px-5 pt-5 pb-4 bg-surface-card border-b border-line-subtle">
                {/* Name */}
                <div ref={nameFieldRef} className="mb-1">
                  <InlineField
                    value={order.customer_name}
                    onCommit={(v) => runCommit({ customer_name: v })}
                    displayMode
                    readOnly={!canEdit}
                    displayClassName="text-[20px] font-bold text-ink-primary leading-tight"
                  />
                </div>

                {/* City · status pills */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {order.customer_city && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-ink-secondary">
                      <MapPin size={11} strokeWidth={2} aria-hidden="true" />
                      {order.customer_city}
                    </span>
                  )}
                </div>

                {/* Primary phone — the agent's main action target */}
                <a
                  href={`tel:${order.customer_phone}`}
                  className="flex items-center gap-3 w-full rounded-card bg-ink-primary text-white px-4 py-3 hover:bg-[#2A2A2A] transition-colors duration-fast group"
                  aria-label={`Call ${order.customer_phone}`}
                >
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/10 flex-shrink-0">
                    <PhoneIcon size={16} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="text-[18px] font-bold tabular-nums tracking-wide flex-1">
                    {order.customer_phone}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); handleCopyPhone(); }}
                    aria-label={t("copyPhone")}
                    className="opacity-50 hover:opacity-100 transition-opacity duration-fast"
                  >
                    {phoneCopied
                      ? <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                      : <Copy size={14} strokeWidth={2} aria-hidden="true" />}
                  </button>
                </a>

                {/* Phone 2 — only if present */}
                {(order.customer_phone_2 || canEdit) && (
                  <div className="flex items-center gap-2 mt-2">
                    <InlineField
                      value={order.customer_phone_2 ?? ""}
                      onCommit={(v) => runCommit({ customer_phone_2: v || null })}
                      type="tel"
                      displayMode
                      readOnly={!canEdit}
                      placeholder={canEdit ? t("fieldPhone2") : ""}
                      displayClassName="text-[13px] text-ink-secondary tabular-nums"
                    />
                    {order.customer_phone_2 && (
                      <a
                        href={`tel:${order.customer_phone_2}`}
                        aria-label="Call secondary"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-card border border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast flex-shrink-0"
                      >
                        <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                )}

                {/* Customer note */}
                {order.customer_note && (
                  <div className="mt-3 px-3 py-2 rounded-card bg-status-warningBg border border-status-warning/20 text-[12px] text-status-warning leading-snug italic">
                    {order.customer_note}
                  </div>
                )}
              </div>

              {/* ── Alert banners ── */}
              <div className="flex flex-col gap-0">
                {!canEdit && (
                  <div className="flex items-start gap-2 px-4 py-2.5 bg-surface-page border-b border-line-subtle text-[12px] text-ink-secondary">
                    <AlertTriangle size={13} strokeWidth={2} className="flex-shrink-0 mt-0.5 text-status-warning" aria-hidden="true" />
                    <span>{t("editBlockedStatus")}</span>
                  </div>
                )}

                {order.status === "callback_scheduled" && order.callback_scheduled_at && (
                  <div className="flex items-center gap-2.5 px-4 py-2.5 bg-status-actionBg border-b border-status-action/15 text-[12px] text-status-action">
                    <Calendar size={13} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold">{t("scheduledCallbackBanner")}</span>
                      <span className="text-status-action/70 ms-2 tabular-nums">
                        {new Date(order.callback_scheduled_at).toLocaleString(
                          locale === "ar" ? "ar-LY" : "fr-TN",
                          { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {isDispatchScheduled && order.scheduled_dispatch_at && (
                  <div className="flex items-center gap-2.5 px-4 py-2.5 bg-status-actionBg border-b border-status-action/15 text-[12px] text-status-action">
                    <Calendar size={13} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold">
                        {order.scheduled_dispatch_auto ? t("scheduledDispatchAutoBanner") : t("scheduledDispatchBanner")}
                      </span>
                      <span className="text-status-action/70 ms-2 tabular-nums">
                        {new Date(order.scheduled_dispatch_at).toLocaleString(
                          locale === "ar" ? "ar-LY" : "fr-TN",
                          { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={cancelingSchedule}
                      onClick={handleCancelSchedule}
                      className="flex-shrink-0 text-[11px] font-medium text-status-action border border-status-action/30 rounded-md px-2 py-1 hover:bg-status-action/10 transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {cancelingSchedule ? t("scheduledDispatchCanceling") : t("scheduledDispatchCancel")}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Body sections ── */}
              <div className="flex flex-col gap-3 px-4 py-4 pb-8">

                {/* Client details card */}
                <SectionCard title={t("client")}>
                  <FieldRow label={t("fieldAddress")}>
                    <InlineField
                      value={order.customer_address ?? ""}
                      onCommit={(v) => runCommit({ customer_address: v })}
                      displayMode
                      readOnly={!canEdit}
                      placeholder={canEdit ? "—" : ""}
                      displayClassName="text-[13px]"
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldCity")}>
                    <Combobox
                      value={order.customer_city ?? ""}
                      options={[]}
                      loadOptions={loadCities}
                      onCommit={(id) => runCommit({ city_id: id })}
                      placeholder={t("pickCity")}
                      displayMode
                      readOnly={!canEdit}
                      displayClassName="text-[13px]"
                    />
                  </FieldRow>
                  {mapsHref && (
                    <div className="pt-1 pb-0.5">
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-status-action hover:underline"
                      >
                        <MapPin size={12} strokeWidth={2} aria-hidden="true" />
                        {t("openMaps")}
                      </a>
                    </div>
                  )}
                </SectionCard>

                {/* Order / receipt card */}
                <SectionCard title={t("order")}>
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
                      <>
                        {/* Line items */}
                        {items.map((item, idx) => (
                          <div key={item.id} className="py-2.5 border-b border-line-subtle last:border-0">
                            {/* Product name row */}
                            <div className="flex items-start justify-between gap-3 mb-1">
                              <div className="flex-1 min-w-0">
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
                                  displayMode
                                  readOnly={!canEdit}
                                  displayClassName="text-[14px] font-semibold"
                                />
                                {item.variant_label && (
                                  <span className="text-[12px] text-ink-secondary">{item.variant_label}</span>
                                )}
                              </div>
                              {/* Line total */}
                              <span className="text-[15px] font-bold text-ink-primary tabular-nums whitespace-nowrap">
                                {item.line_total}
                                <span className="text-[11px] font-normal text-ink-secondary ms-1">{order.currency}</span>
                              </span>
                            </div>

                            {/* Qty × price row */}
                            <div className="flex items-center gap-3">
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
                                displayMode
                                readOnly={!canEdit}
                              />
                              <span className="text-[12px] text-ink-secondary">×</span>
                              <span className="text-[13px] text-ink-secondary tabular-nums">
                                {item.unit_price} {order.currency}
                              </span>
                              {canEdit && items.length > 1 && item.id !== "legacy" && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await fetch(`/api/orders/${order.id}/items/${item.id}`, { method: "DELETE" });
                                    mutate();
                                  }}
                                  title={t("removeItem")}
                                  aria-label={t("removeItem")}
                                  className="ms-auto inline-flex items-center justify-center w-6 h-6 rounded text-ink-muted hover:text-status-critical hover:bg-status-criticalBg transition-colors duration-fast"
                                >
                                  <X size={13} strokeWidth={2} aria-hidden="true" />
                                </button>
                              )}
                            </div>

                            {/* Variant selector (edit mode, first item only) */}
                            {(idx === 0 || item.id === "legacy") && variantOptions.length > 0 && canEdit && (
                              <div className="mt-2">
                                <select
                                  value={item.variant_id ?? ""}
                                  disabled={!canEdit}
                                  onChange={(e) => {
                                    if (item.id === "legacy") runCommit({ variant_id: e.target.value });
                                  }}
                                  className="w-full h-8 px-2.5 text-[12px] rounded-card border border-line-subtle bg-surface-card text-ink-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
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

                        {/* Add product */}
                        {canEdit && (() => {
                          const firstItem = items[0];
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
                                  body: JSON.stringify({ product_id: addProductId, quantity: 1, unit_price: addUnitPrice }),
                                });
                                if (res.ok) mutate();
                                else {
                                  const body = await res.json().catch(() => ({}));
                                  alert(body.error ?? "Failed to add product");
                                }
                              }}
                              className="inline-flex items-center justify-center gap-1.5 w-full text-[12px] font-medium text-ink-secondary border border-dashed border-line-strong rounded-card py-1.5 hover:text-ink-primary hover:border-ink-primary hover:bg-surface-hover transition-colors duration-fast mt-1"
                            >
                              <Plus size={12} strokeWidth={2} aria-hidden="true" />
                              {t("addProduct")}
                            </button>
                          );
                        })()}

                        {/* Receipt footer */}
                        <div className="mt-2 pt-2 border-t border-line-subtle flex flex-col gap-1.5">
                          {/* Delivery fee */}
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] text-ink-secondary">{t("fieldDeliveryFee")}</span>
                            <div className="w-[90px]">
                              <InlineField
                                value={String(order.delivery_fee ?? 0)}
                                onCommit={(v) => runCommit({ delivery_fee: parseFloat(v) || 0 })}
                                type="number"
                                displayMode
                                readOnly={!canEdit}
                                displayClassName="text-[13px] text-ink-secondary tabular-nums text-end"
                              />
                            </div>
                          </div>
                          {/* Grand total */}
                          <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-line-subtle">
                            <span className="text-[12px] font-semibold text-ink-primary uppercase tracking-wider">{t("grandTotal")}</span>
                            <span className="text-[22px] font-black text-ink-primary tabular-nums tracking-tight">
                              {order.total_price}
                              <span className="text-[12px] font-semibold text-ink-secondary ms-1.5">{order.currency}</span>
                            </span>
                          </div>
                        </div>

                        {saveError && (
                          <div className="text-[12px] text-status-critical mt-1">{saveError}</div>
                        )}
                      </>
                    );
                  })()}
                </SectionCard>

                {/* History card — compact */}
                <SectionCard title={t("history")}>
                  {order.history.length === 0 ? (
                    <div className="text-[12px] text-ink-muted py-1">{t("emptyHistory")}</div>
                  ) : (
                    <ol className="flex flex-col gap-0">
                      {order.history.map((entry, i) => (
                        <li
                          key={entry.id}
                          className={[
                            "flex items-start gap-3 py-2.5",
                            i < order.history.length - 1 ? "border-b border-line-subtle" : "",
                          ].join(" ")}
                        >
                          {/* Dot */}
                          <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-line-strong" aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-ink-primary leading-snug">
                              {entry.from_status
                                ? th("transition", {
                                    from: getStatusLabel(entry.from_status, locale),
                                    to: getStatusLabel(entry.to_status, locale),
                                  })
                                : getStatusLabel(entry.to_status, locale)}
                            </div>
                            {entry.note && (
                              <div className="text-[11px] text-ink-secondary mt-0.5">
                                {translateHistoryNote(entry.note, th)}
                              </div>
                            )}
                          </div>
                          <span className="flex-shrink-0 text-[11px] text-ink-muted tabular-nums mt-0.5">
                            {new Date(entry.created_at).toLocaleString(
                              locale === "ar" ? "ar-LY" : "fr-TN",
                              { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </SectionCard>

                {/* Fulfillment override — managers only */}
                {canFulfillmentOverride && (
                  <SectionCard title={t("fulfillmentTitle")}>
                    <div className="flex flex-col gap-2.5 pt-1">
                      <select
                        value={fulfillmentStatus}
                        onChange={(e) => setFulfillmentStatus(e.target.value)}
                        className="w-full h-10 px-3 text-[13px] rounded-card border border-line-subtle bg-surface-card text-ink-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      >
                        <option value="">{t("fulfillmentPlaceholder")}</option>
                        {FULFILLMENT_STATUS_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {ts(value as Parameters<typeof ts>[0])}
                          </option>
                        ))}
                      </select>
                      {fulfillmentStatus === "returned" && (
                        <label className="inline-flex items-center gap-2 text-[13px] text-ink-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isDamaged}
                            onChange={(e) => setIsDamaged(e.target.checked)}
                            className="w-4 h-4 rounded border-line-strong accent-ink-primary"
                          />
                          {t("fulfillmentDamaged")}
                        </label>
                      )}
                      <input
                        type="text"
                        placeholder={t("fulfillmentNote")}
                        value={fulfillmentNote}
                        onChange={(e) => setFulfillmentNote(e.target.value)}
                        className="w-full h-10 px-3 text-[13px] rounded-card border border-line-subtle bg-surface-card text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                      {fulfillmentError && (
                        <div className="text-[12px] text-status-critical">{fulfillmentError}</div>
                      )}
                      <button
                        type="button"
                        disabled={!fulfillmentStatus || fulfillmentLoading}
                        onClick={handleFulfillmentOverride}
                        className="inline-flex items-center justify-center h-10 px-4 text-[13px] font-semibold rounded-card bg-ink-primary text-white hover:bg-[#2A2A2A] transition-colors duration-fast disabled:bg-line-strong disabled:text-ink-muted disabled:cursor-not-allowed"
                      >
                        {fulfillmentLoading ? t("fulfillmentUpdating") : t("fulfillmentApply")}
                      </button>
                    </div>
                  </SectionCard>
                )}

              </div>
            </>
          )}
        </div>

        {/* ── Reopen warning ─────────────────────────────────────── */}
        {reopenWarning && (
          <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2.5 bg-status-warningBg border-t border-status-warning/30 text-[12px] text-status-warning">
            <AlertTriangle size={13} strokeWidth={2} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{t("reopenWarning")}</span>
          </div>
        )}

        {/* ── Action bar ─────────────────────────────────────────── */}
        {order && (
          <div className="flex-shrink-0 bg-surface-card border-t border-line-subtle">
            {/* Secondary row */}
            {(canReturnToPool || canReopen || canScheduleDispatch) && (
              <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-0">
                {canReturnToPool && (
                  <button
                    type="button"
                    disabled={returningToPool}
                    onClick={handleReturnToPool}
                    className="inline-flex items-center gap-1 h-8 px-2.5 text-[12px] font-medium text-status-critical hover:bg-status-criticalBg rounded-card transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
                    {t("returnToPool")}
                  </button>
                )}
                <div className="flex-1" />
                {canReopen && (
                  <button
                    type="button"
                    disabled={reopening}
                    onClick={() => setReopenModalOpen(true)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 text-[12px] font-medium text-ink-primary border border-line-subtle rounded-card hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reopening ? t("reopening") : t("reopen")}
                  </button>
                )}
                {canScheduleDispatch && (
                  <button
                    type="button"
                    onClick={() => setScheduleDispatchOpen(true)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 text-[12px] font-medium text-ink-primary border border-line-subtle rounded-card hover:bg-surface-hover transition-colors duration-fast"
                  >
                    <Calendar size={12} strokeWidth={2} aria-hidden="true" />
                    {t("scheduleDispatchAction")}
                  </button>
                )}
              </div>
            )}
            {/* Primary CTA */}
            <div className="px-4 py-3">
              <button
                type="button"
                onClick={() => onCallTerminated(orderId!)}
                className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-card bg-ink-primary text-white text-[14px] font-semibold hover:bg-[#2A2A2A] active:scale-[0.99] transition-all duration-fast"
              >
                <PhoneIcon size={15} strokeWidth={2.25} aria-hidden="true" />
                {t("callEnded")}
              </button>
              {canEdit && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-ink-muted mt-1.5">
                  <Pencil size={9} strokeWidth={2} aria-hidden="true" />
                  <span>{t("pressEToEdit")}</span>
                </div>
              )}
            </div>
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
            className="fixed inset-0 z-[60] bg-ink-primary/50"
            onClick={() => !reopening && setReopenModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-[min(400px,95vw)] bg-surface-card border border-line-subtle rounded-card shadow-floating overflow-hidden"
          >
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-ink-primary mb-1">
                {t("reopenConfirmTitle")}
              </h2>
              <p className="text-[13px] text-ink-secondary leading-relaxed">
                {order.tracking_number ? t("reopenConfirmBody") : t("reopenConfirmBodyNoTracking")}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 bg-surface-page border-t border-line-subtle">
              <button
                type="button"
                disabled={reopening}
                onClick={() => setReopenModalOpen(false)}
                className="inline-flex items-center justify-center h-9 px-4 text-[13px] font-medium text-ink-primary border border-line-subtle rounded-card bg-surface-card hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50"
              >
                {t("reopenCancel")}
              </button>
              <button
                type="button"
                disabled={reopening}
                onClick={handleReopen}
                className="inline-flex items-center justify-center h-9 px-4 text-[13px] font-semibold text-white bg-ink-primary rounded-card hover:bg-[#2A2A2A] transition-colors duration-fast disabled:bg-line-strong disabled:text-ink-muted disabled:cursor-not-allowed"
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
