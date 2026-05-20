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
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useOrderMutation } from "@/hooks/useOrderMutation";
import { LY_MARKET_ID } from "@/lib/markets";
import type { Role } from "@/types";

const ScheduleDispatchModal = dynamic(
  () => import("./ScheduleDispatchModal").then((m) => m.ScheduleDispatchModal),
  { ssr: false },
);

const DexpressDispatchModal = dynamic(
  () => import("./DexpressDispatchModal").then((m) => m.DexpressDispatchModal),
  { ssr: false },
);

const TrackingBarcode = dynamic(
  () => import("@/components/orders/TrackingBarcode").then((m) => m.TrackingBarcode),
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
  dexpress_state_id: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_fee: number;
  currency: string;
  status: string;
  assigned_to: string | null;
  market_id: string;
  attempts_count?: number | null;
  updated_at: string;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_barcode_deleted_at: string | null;
  carrier_barcode_deleted_carrier_code: string | null;
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
  "deleted",
  "cancelled",
]);

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "neutral",
  assigned: "neutral",
  attempt_1: "warning",
  attempt_2: "warning",
  attempt_3: "warning",
  callback_scheduled: "warning",
  confirmed: "action",
  dispatch_scheduled: "action",
  uploaded: "action",
  scanned: "action",
  dispatched: "action",
  deposit: "action",
  in_transit: "action",
  unverified: "warning",
  to_be_returned: "warning",
  received: "action",
  delivered: "success",
  returned: "critical",
  rejected: "critical",
  cancelled: "critical",
  deleted: "neutral",
};

const FULFILLMENT_STATUS_VALUES = [
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
] as const;

export interface CallTerminatedContext {
  orderId: string;
  status: string;
  marketId: string;
  attemptsCount: number;
}

interface OrderDetailPanelProps {
  orderId: string | null;
  onClose: () => void;
  onCallTerminated: (orderId: string, ctx?: CallTerminatedContext) => void;
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
    "Cancelled via storefront webhook": th("deleted"),
    "Scheduled dispatch cancelled": th("scheduledDispatchCancelled"),
    // Legacy French note kept so historical rows still render translated.
    "Livraison planifiée annulée": th("scheduledDispatchCancelled"),
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

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadingCarrierId, setUploadingCarrierId] = useState<string | null>(null);
  const [dexpressModalOpen, setDexpressModalOpen] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<
    | { kind: "success"; tracking: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  // Feedback for carrier-barcode deletion (independent from uploadFeedback so
  // a delete-success doesn't get confused with an upload-success toast).
  const [deleteFeedback, setDeleteFeedback] = useState<
    | { kind: "success" }
    | { kind: "warning"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);

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

  // Libya orders use the carrier (Dexpress) state list — same one shown at
  // dispatch time. Fetched only when editing a Libya order.
  const isLibyaOrder = order?.market_id === LY_MARKET_ID;
  const { data: dexpressStatesData } = useSWR<{
    states: Array<{ id: number; name: string }>;
  }>(
    canEdit && isLibyaOrder ? "/api/dexpress/states" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );
  const dexpressStates = dexpressStatesData?.states ?? [];

  const [libyaCityPickerOpen, setLibyaCityPickerOpen] = useState(false);
  const [libyaCityQuery, setLibyaCityQuery] = useState("");
  const filteredDexpressStates = useMemo(() => {
    const q = libyaCityQuery.trim();
    if (!q) return dexpressStates;
    return dexpressStates.filter((s) => s.name.includes(q));
  }, [dexpressStates, libyaCityQuery]);

  // Reset Libya picker state when switching orders.
  useEffect(() => {
    setLibyaCityPickerOpen(false);
    setLibyaCityQuery("");
  }, [order?.id]);

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

  const canUploadToCarrier =
    order !== null &&
    (order.status === "confirmed" || order.status === "dispatch_scheduled") &&
    (role === "super_admin" ||
      role === "market_manager" ||
      role === "warehouse_agent" ||
      // Agent (or agent queue, where role prop is undefined) can upload
      // their own assigned orders. The dispatch API enforces the same
      // ownership check server-side.
      ((role === "agent" || role === undefined) &&
        userId !== undefined &&
        order.assigned_to === userId));

  const { data: uploadCarriersData } = useSWR<{
    data: Array<{ id: string; name: string; code: string; is_active: boolean }>;
  }>(
    canUploadToCarrier && uploadOpen && order
      ? `/api/carriers?market_id=${order.market_id}`
      : null,
    fetcher,
  );
  const activeCarriers = (uploadCarriersData?.data ?? []).filter((c) => c.is_active);

  async function handleUploadToCarrier(carrierId: string) {
    if (!orderId) return;
    setUploadingCarrierId(carrierId);
    setUploadFeedback(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrier_id: carrierId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { tracking_number?: string | null };
        error?: string;
        debug?: Record<string, unknown>;
      };
      if (!res.ok) {
        const detail = json.debug
          ? ` (${Object.entries(json.debug).map(([k, v]) => `${k}=${v}`).join(", ")})`
          : "";
        setUploadFeedback({
          kind: "error",
          message: `${json.error ?? t("errors.uploadHttp", { status: res.status })}${detail}`,
        });
        return;
      }
      setUploadFeedback({
        kind: "success",
        tracking: json.data?.tracking_number ?? "—",
      });
      setUploadOpen(false);
      await mutate();
    } catch (err) {
      setUploadFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : t("errors.uploadNetwork"),
      });
    } finally {
      setUploadingCarrierId(null);
    }
  }

  // Carrier-barcode deletion: trash icon on the TrackingBarcode component.
  // Only available for uploaded orders with a tracking number, and only to
  // the assigned agent / market manager / super_admin.
  const canDeleteCarrierBarcode =
    order !== null &&
    order.status === "uploaded" &&
    Boolean(order.tracking_number) &&
    Boolean(order.carrier_id) &&
    (role === "super_admin" ||
      role === "market_manager" ||
      ((role === "agent" || role === undefined) &&
        userId !== undefined &&
        order.assigned_to === userId));

  async function handleDeleteCarrierBarcode(): Promise<void> {
    if (!orderId) return;
    setDeleteFeedback(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/carrier-delete`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { void_outcome?: string };
        warning?: string;
        error?: string;
      };
      if (!res.ok) {
        setDeleteFeedback({
          kind: "error",
          message: json.error ?? t("errors.deleteHttp", { status: res.status }),
        });
        return;
      }
      setDeleteFeedback(
        json.warning
          ? { kind: "warning", message: json.warning }
          : { kind: "success" },
      );
      await mutate();
    } catch (err) {
      setDeleteFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : t("errors.deleteNetwork"),
      });
    }
  }

  async function handleCancelSchedule() {
    if (!orderId) return;
    setCancelingSchedule(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "confirmed",
          note: "Scheduled dispatch cancelled",
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
      <div className="fixed top-0 end-0 h-full w-full sm:w-[480px] z-50 flex flex-col overflow-hidden bg-surface-card border-s border-line-subtle shadow-panel animate-[slideInEnd_180ms_ease-out]">

        {/* ── Sticky header ─────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-surface-card border-b border-line-subtle">
          <div className="flex items-center justify-between gap-3 px-4 h-[52px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center h-[22px] px-2 rounded-card bg-surface-page border border-line-subtle font-mono text-[11px] font-semibold tabular-nums text-ink-secondary flex-shrink-0">
                #{(order?.id ?? orderId ?? "").slice(0, 8).toUpperCase()}
              </span>
              {order && (
                <Badge tone={STATUS_TONE[order.status] ?? "neutral"} dot>
                  {ts(order.status as Parameters<typeof ts>[0])}
                </Badge>
              )}
              {order?.status === "confirmed" &&
                (role === "super_admin" ||
                  role === "market_manager" ||
                  ((role === "agent" || role === undefined) &&
                    userId !== undefined &&
                    order.assigned_to === userId)) && (
                  <button
                    type="button"
                    onClick={() =>
                      onCallTerminated(orderId!, {
                        orderId: orderId!,
                        status: order.status,
                        marketId: order.market_id,
                        attemptsCount: order.attempts_count ?? 0,
                      })
                    }
                    className="text-[11px] font-medium text-ink-secondary hover:text-ink-primary underline-offset-2 hover:underline"
                  >
                    {t("changeStatus")}
                  </button>
                )}
              {order?.carrier_barcode_deleted_at && !order.tracking_number && (
                <span
                  className="inline-flex items-center gap-1 h-[22px] px-2 rounded-card border border-line-subtle bg-surface-page text-[11px] font-medium text-ink-secondary"
                  title={t("carrierBarcodeDeletedTooltip", {
                    date: new Date(
                      order.carrier_barcode_deleted_at,
                    ).toLocaleDateString(locale === "ar" ? "ar" : "fr"),
                  })}
                >
                  <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
                  {t("carrierBarcodeDeletedBadge", {
                    carrier:
                      order.carrier_barcode_deleted_carrier_code ?? "carrier",
                  })}
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
              {/* ── Tracking barcode (only after carrier upload) ── */}
              {deleteFeedback && (
                <div
                  role={deleteFeedback.kind === "success" ? "status" : "alert"}
                  className={[
                    "px-4 py-2 text-[12px] border-b border-line-subtle",
                    deleteFeedback.kind === "success"
                      ? "bg-status-successBg text-status-success"
                      : deleteFeedback.kind === "warning"
                        ? "bg-status-warningBg text-status-warning"
                        : "bg-status-criticalBg text-status-critical",
                  ].join(" ")}
                >
                  {deleteFeedback.kind === "success"
                    ? t("deleteBarcodeSuccess")
                    : deleteFeedback.message}
                </div>
              )}
              <TrackingBarcode
                value={order.tracking_number}
                onDelete={
                  canDeleteCarrierBarcode
                    ? handleDeleteCarrierBarcode
                    : undefined
                }
              />

              {/* ── Customer summary ── */}
              <div className="px-4 pt-4 pb-4 bg-surface-card border-b border-line-subtle">
                {/* Name */}
                <div ref={nameFieldRef}>
                  <InlineField
                    value={order.customer_name}
                    onCommit={(v) => runCommit({ customer_name: v })}
                    displayMode
                    readOnly={!canEdit}
                    displayClassName="text-[17px] font-semibold text-ink-primary leading-tight"
                  />
                </div>

                {/* City + maps link */}
                {(order.customer_city || mapsHref) && (
                  <div className="flex items-center gap-2 mt-1.5 mb-3 flex-wrap text-[12px]">
                    {order.customer_city && (
                      <span className="inline-flex items-center gap-1 text-ink-secondary">
                        <MapPin size={11} strokeWidth={2} aria-hidden="true" />
                        {order.customer_city}
                      </span>
                    )}
                    {mapsHref && (
                      <>
                        {order.customer_city && (
                          <span className="text-ink-muted" aria-hidden="true">·</span>
                        )}
                        <a
                          href={mapsHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-status-action hover:underline"
                        >
                          {t("openMaps")}
                        </a>
                      </>
                    )}
                  </div>
                )}

                {/* Primary phone — the agent's main action target */}
                <a
                  href={`tel:${order.customer_phone}`}
                  className="flex items-center gap-3 w-full rounded-card bg-ink-primary text-white ps-3 pe-2 py-2.5 hover:bg-[#2A2A2A] transition-colors duration-fast"
                  aria-label={`Call ${order.customer_phone}`}
                >
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 flex-shrink-0">
                    <PhoneIcon size={14} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="text-[16px] font-semibold tabular-nums tracking-wide flex-1">
                    {order.customer_phone}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); handleCopyPhone(); }}
                    aria-label={t("copyPhone")}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-card text-white/60 hover:text-white hover:bg-white/10 transition-colors duration-fast"
                  >
                    {phoneCopied
                      ? <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                      : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
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

                {/* Customer note — calm, non-dominant. Editable when the order
                    is still editable; otherwise a read-only italic note. Shown
                    even when empty (in edit mode) so an agent can add one. */}
                {(order.customer_note || canEdit) && (
                  <div className="mt-3 ps-2.5 border-s-2 border-line-strong">
                    <InlineField
                      value={order.customer_note ?? ""}
                      onCommit={(v) => runCommit({ customer_note: v.trim() || null })}
                      multiline
                      displayMode
                      readOnly={!canEdit}
                      placeholder={canEdit ? t("fieldNotePlaceholder") : ""}
                      displayClassName="text-[12px] text-ink-secondary leading-snug italic"
                    />
                  </div>
                )}
              </div>

              {/* ── Alert banners ── */}
              <div className="flex flex-col gap-0">
                {!canEdit && !canReopen && (
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
                    {isLibyaOrder ? (
                      !canEdit ? (
                        <span className="text-[13px] text-ink-primary" dir="auto">
                          {order.customer_city ?? "—"}
                        </span>
                      ) : !libyaCityPickerOpen ? (
                        <button
                          type="button"
                          onClick={() => {
                            setLibyaCityQuery("");
                            setLibyaCityPickerOpen(true);
                          }}
                          className="group flex items-center justify-between gap-2 w-full text-start cursor-text rounded-card -mx-1 px-1 py-0.5 hover:bg-surface-hover transition-colors duration-fast"
                          aria-label={t("cityChange")}
                        >
                          <span
                            className="truncate text-[13px] text-ink-primary"
                            dir="auto"
                          >
                            {order.customer_city ?? "—"}
                          </span>
                          <span
                            aria-hidden="true"
                            className="flex-shrink-0 text-[12px] font-medium text-ink-secondary group-hover:text-ink-primary underline-offset-2 group-hover:underline"
                          >
                            {t("cityChange")}
                          </span>
                        </button>
                      ) : (
                        <div className="flex flex-col gap-2 w-full">
                          <input
                            type="text"
                            value={libyaCityQuery}
                            onChange={(e) => setLibyaCityQuery(e.target.value)}
                            placeholder={t("citySearch")}
                            className="w-full h-9 px-3 text-[13px] rounded-card border border-line-subtle bg-surface-card text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-ink-primary"
                            dir="auto"
                            autoFocus
                          />
                          <div className="max-h-40 overflow-y-auto rounded-card border border-line-subtle">
                            {filteredDexpressStates.length === 0 ? (
                              <div className="px-3 py-2 text-[12px] text-ink-secondary">
                                {t("cityNoResults")}
                              </div>
                            ) : (
                              filteredDexpressStates.map((state) => (
                                <button
                                  key={state.id}
                                  type="button"
                                  onClick={() => {
                                    runCommit({ dexpress_state_id: state.id });
                                    setLibyaCityPickerOpen(false);
                                  }}
                                  className="w-full border-b border-line-subtle px-3 py-2 text-start text-[13px] last:border-b-0 text-ink-primary hover:bg-surface-hover"
                                  dir="auto"
                                >
                                  {state.name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )
                    ) : (
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
                    )}
                  </FieldRow>
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
                        {items.map((item, idx) => {
                          const itemProduct =
                            productsData?.data?.find((p) => p.id === item.product_id) ?? null;
                          const stock = itemProduct?.current_stock ?? null;
                          let stockTone: BadgeTone = "success";
                          let stockLabel: string = t("inStock");
                          if (stock !== null) {
                            if (stock <= 0) {
                              stockTone = "critical";
                              stockLabel = t("outOfStock");
                            } else if (stock <= 5) {
                              stockTone = "warning";
                              stockLabel = t("stockLeft", { count: stock });
                            } else {
                              stockTone = "success";
                              stockLabel = t("inStock");
                            }
                          }

                          return (
                          <div
                            key={item.id}
                            className="group -mx-2 px-2 py-3 rounded-card border-b border-line-subtle last:border-0 hover:bg-surface-hover transition-colors duration-fast"
                          >
                            {/* Header: product name + delete */}
                            <div className="flex items-start justify-between gap-3">
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
                                  displayClassName="text-[15px] font-semibold text-ink-primary leading-snug"
                                />
                              </div>
                              {canEdit && items.length > 1 && item.id !== "legacy" && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await fetch(`/api/orders/${order.id}/items/${item.id}`, { method: "DELETE" });
                                    mutate();
                                  }}
                                  title={t("removeItem")}
                                  aria-label={t("removeItem")}
                                  className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-ink-muted opacity-0 group-hover:opacity-100 hover:text-status-critical hover:bg-status-criticalBg transition-all duration-fast"
                                >
                                  <X size={13} strokeWidth={2} aria-hidden="true" />
                                </button>
                              )}
                            </div>

                            {/* Badges row: variant + stock */}
                            {(item.variant_label || stock !== null) && (
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {item.variant_label && (
                                  <Badge tone="neutral">{item.variant_label}</Badge>
                                )}
                                {stock !== null && (
                                  <Badge tone={stockTone} dot>
                                    {stockLabel}
                                  </Badge>
                                )}
                              </div>
                            )}

                            {/* Footer: qty stepper · unit price · line total */}
                            <div className="flex items-center justify-between gap-3 mt-2.5">
                              <div className="flex items-center gap-2 min-w-0">
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
                                <span className="text-[12px] text-ink-muted">×</span>
                                <span className="text-[12px] text-ink-secondary tabular-nums truncate">
                                  {item.unit_price} {order.currency}
                                </span>
                              </div>
                              <span className="text-[14px] font-semibold text-ink-primary tabular-nums whitespace-nowrap">
                                {item.line_total}
                                <span className="text-[11px] font-normal text-ink-muted ms-1">{order.currency}</span>
                              </span>
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
                          );
                        })}

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
                                  alert(body.error ?? t("errors.addProductFailed"));
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
                        <div className="mt-3 pt-3 border-t border-line-subtle flex flex-col gap-2">
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
                          {/* Grand total — emphasised band */}
                          <div className="-mx-2 mt-1 flex items-center justify-between rounded-card bg-surface-page px-3 py-2.5">
                            <span className="text-[11px] font-semibold text-ink-secondary uppercase tracking-[0.08em]">{t("grandTotal")}</span>
                            <span className="text-[20px] font-bold text-ink-primary tabular-nums tracking-tight leading-none">
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

                {/* History timeline */}
                <SectionCard title={t("history")}>
                  {order.history.length === 0 ? (
                    <div className="text-[12px] text-ink-muted py-1">{t("emptyHistory")}</div>
                  ) : (
                    <ol className="relative flex flex-col gap-0 pt-1">
                      {/* Vertical connector */}
                      <span
                        aria-hidden="true"
                        className="absolute top-2 bottom-2 w-px bg-line-subtle"
                        style={{ insetInlineStart: 3 }}
                      />
                      {order.history.map((entry, i) => {
                        const isLatest = i === 0;
                        return (
                          <li
                            key={entry.id}
                            className="relative flex items-start gap-3 py-2"
                          >
                            <span
                              className={[
                                "relative z-[1] mt-[5px] flex-shrink-0 w-[7px] h-[7px] rounded-full",
                                isLatest ? "bg-ink-primary" : "bg-line-strong",
                              ].join(" ")}
                              aria-hidden="true"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <div className="text-[13px] text-ink-primary leading-snug min-w-0">
                                  {entry.from_status
                                    ? th("transition", {
                                        from: getStatusLabel(entry.from_status, locale),
                                        to: getStatusLabel(entry.to_status, locale),
                                      })
                                    : getStatusLabel(entry.to_status, locale)}
                                </div>
                                <span className="flex-shrink-0 text-[11px] text-ink-muted tabular-nums">
                                  {new Date(entry.created_at).toLocaleString(
                                    locale === "ar" ? "ar-LY" : "fr-TN",
                                    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                                  )}
                                </span>
                              </div>
                              {entry.note && (
                                <div className="text-[11px] text-ink-secondary mt-0.5 leading-snug">
                                  {translateHistoryNote(entry.note, th)}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
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
        {order && (() => {
          // Context-aware primary CTA
          // 1. Agent with active call → "Terminer l'appel"
          // 2. Reopenable order      → "Réouvrir la commande"
          // 3. Otherwise             → "Fermer"
          // The "Appel terminé" CTA opens the post-call action sheet. Statuses
          // where confirm/reject/callback/no-answer are valid: pre-confirm pool.
          const CALL_ACTION_STATUSES = new Set([
            "pending",
            "assigned",
            "attempt_1",
            "attempt_2",
            "attempt_3",
            "callback_scheduled",
          ]);
          const isCallActionable = CALL_ACTION_STATUSES.has(order.status);
          // Agent-on-queue (no role prop) on a non-terminal order, OR
          // manager/admin on a call-actionable order (take-over flow).
          const isAgentCall =
            (role === undefined && !TERMINAL_STATUSES.has(order.status)) ||
            ((role === "market_manager" || role === "super_admin") &&
              isCallActionable);
          type PrimaryAction = {
            label: string;
            onClick: () => void;
            icon: React.ReactNode;
            tone: "dark" | "muted";
          };
          let primary: PrimaryAction;
          if (isAgentCall) {
            primary = {
              label: t("callEnded"),
              onClick: () =>
                onCallTerminated(orderId!, {
                  orderId: orderId!,
                  status: order.status,
                  marketId: order.market_id,
                  attemptsCount: order.attempts_count ?? 0,
                }),
              icon: <PhoneIcon size={15} strokeWidth={2.25} aria-hidden="true" />,
              tone: "dark",
            };
          } else if (canReopen) {
            primary = {
              label: reopening ? t("reopening") : t("reopen"),
              onClick: () => setReopenModalOpen(true),
              icon: <RotateCcw size={15} strokeWidth={2.25} aria-hidden="true" />,
              tone: "dark",
            };
          } else {
            primary = {
              label: t("close"),
              onClick: onClose,
              icon: null,
              tone: "muted",
            };
          }

          const hasSecondary = canReturnToPool || canScheduleDispatch || canUploadToCarrier;

          return (
            <div className="flex-shrink-0 bg-surface-card border-t border-line-subtle">
              {/* Secondary row — return to pool + schedule dispatch + upload to carrier */}
              {hasSecondary && (
                <div className="flex items-center gap-1.5 px-4 pt-2.5">
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
                  {canUploadToCarrier && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadFeedback(null);
                        setUploadOpen(true);
                      }}
                      className="inline-flex items-center gap-1 h-8 px-2.5 text-[12px] font-medium text-white bg-ink-primary rounded-card hover:bg-[#2A2A2A] transition-colors duration-fast"
                    >
                      {t("uploadToCarrier")}
                    </button>
                  )}
                </div>
              )}
              {uploadFeedback && (
                <div
                  role="status"
                  className={[
                    "mx-4 mt-2 rounded-card px-3 py-2 text-[12px] border",
                    uploadFeedback.kind === "success"
                      ? "bg-status-successBg border-status-success/30 text-status-success"
                      : "bg-status-criticalBg border-status-critical/30 text-status-critical",
                  ].join(" ")}
                >
                  {uploadFeedback.kind === "success"
                    ? t("uploadCarrierSuccess", { tracking: uploadFeedback.tracking })
                    : t("uploadCarrierError", { error: uploadFeedback.message })}
                </div>
              )}
              {/* Primary CTA */}
              <div className="px-4 py-3">
                <button
                  type="button"
                  onClick={primary.onClick}
                  disabled={reopening || returningToPool}
                  className={[
                    "inline-flex items-center justify-center gap-2 w-full h-11 rounded-card text-[14px] font-semibold transition-all duration-fast active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed",
                    primary.tone === "dark"
                      ? "bg-ink-primary text-white hover:bg-[#2A2A2A]"
                      : "bg-surface-page text-ink-primary border border-line-subtle hover:bg-surface-hover",
                  ].join(" ")}
                >
                  {primary.icon}
                  {primary.label}
                </button>
                {canEdit && isAgentCall && role === undefined && (
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-ink-muted mt-1.5">
                    <Pencil size={9} strokeWidth={2} aria-hidden="true" />
                    <span>{t("pressEToEdit")}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
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

      {uploadOpen && order && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-ink-primary/50"
            onClick={() => uploadingCarrierId === null && setUploadOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-[min(420px,95vw)] bg-surface-card border border-line-subtle rounded-card shadow-floating overflow-hidden"
          >
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-ink-primary mb-1">
                {t("uploadCarrierPickTitle")}
              </h2>
              <p className="text-[12px] text-ink-secondary leading-relaxed">
                {t("uploadCarrierPickHint")}
              </p>
            </div>
            {uploadFeedback?.kind === "error" && (
              <div
                role="alert"
                className="mx-5 mb-2 rounded-card border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[12px] text-status-critical"
              >
                {t("uploadCarrierError", { error: uploadFeedback.message })}
              </div>
            )}
            <div className="px-5 pb-3 flex flex-col gap-1.5">
              {activeCarriers.length === 0 ? (
                <p className="text-[13px] text-ink-secondary py-2">
                  {t("uploadCarrierNoActive")}
                </p>
              ) : (
                activeCarriers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={uploadingCarrierId !== null}
                    onClick={() => {
                      if (c.code === "dexpress") {
                        setUploadOpen(false);
                        setDexpressModalOpen(true);
                        return;
                      }
                      handleUploadToCarrier(c.id);
                    }}
                    className="flex items-center justify-between h-10 px-3 text-[13px] text-ink-primary border border-line-subtle rounded-card hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-[11px] text-ink-secondary uppercase tracking-wide">
                      {uploadingCarrierId === c.id ? t("uploadingToCarrier") : c.code}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 bg-surface-page border-t border-line-subtle">
              <button
                type="button"
                disabled={uploadingCarrierId !== null}
                onClick={() => setUploadOpen(false)}
                className="inline-flex items-center justify-center h-9 px-4 text-[13px] font-medium text-ink-primary border border-line-subtle rounded-card bg-surface-card hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50"
              >
                {t("uploadCarrierCancel")}
              </button>
            </div>
          </div>
        </>
      )}

      {dexpressModalOpen && order && orderId && (
        <DexpressDispatchModal
          orderId={orderId}
          marketId={order.market_id}
          orderTotal={order.total_price}
          market={order.market_id === LY_MARKET_ID ? "LY" : "TN"}
          customerAddress={order.customer_address}
          presetStateId={order.dexpress_state_id}
          presetStateName={order.customer_city}
          onClose={() => setDexpressModalOpen(false)}
          onSuccess={(trackingNumber) => {
            setDexpressModalOpen(false);
            setUploadFeedback({
              kind: "success",
              tracking: trackingNumber ?? "—",
            });
            void mutate();
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
