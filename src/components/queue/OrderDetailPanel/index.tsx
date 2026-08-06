"use client";

/**
 * ─── How to redesign this panel without rewriting it ─────────────────────
 *
 * This file is the orchestrator: state, handlers, data fetching. The visual
 * layer lives in sibling files — each one is replaceable in isolation.
 *
 *   PanelHeader.tsx       — sticky header (status badge + id + close)
 *   CustomerHero.tsx      — name + phone capsule + city chip
 *   AlertBanners.tsx      — edit-blocked / callback / dispatch banners
 *   CustomerCard.tsx      — address + city + note
 *   OrderItemsCard.tsx    — collapsible receipt + line items + total
 *   HistoryTimeline.tsx   — collapsible status-change timeline
 *   FulfillmentCard.tsx   — manager-only override block
 *   ActionFooter.tsx      — primary CTA + overflow menu
 *   SectionCard.tsx       — shared white card shell (label + icon header)
 *   usePrimaryAction.ts   — pure resolver: (status, role, ...) → CTA + overflow
 *
 * To ship a new look:
 *   1. Build the new visual as `<Name>V2.tsx` next to the original.
 *   2. Swap the import in this file. Props stay the same → no orchestrator
 *      changes. If a prop shape needs to evolve, update both implementations.
 *   3. For an A/B rollout, gate behind a feature flag here and keep both.
 *
 * For a wholesale rework:
 *   - Tokens live in tailwind.config.ts (shadow-panel-elevated,
 *     surface.elevated) and docs/design-system.md §4.9–4.10.
 *   - Modal/drawer primitive: src/components/ui/Sheet.tsx (placement="end"
 *     for drawer, "center" for modal). Use this rather than ad-hoc overlays.
 *   - Overflow menu primitive: src/components/ui/Menu.tsx (portaled,
 *     flip-up aware, destructive item support).
 *
 * The footer's action map (state → primary CTA + overflow) is data-driven
 * by `resolvePanelActions` in usePrimaryAction.ts. Changing which action
 * shows when never requires touching the JSX — just edit the resolver and
 * its tests (__tests__/usePrimaryAction.test.ts).
 *
 * Callers import from "@/components/queue/OrderDetailPanel" (a re-export
 * shim at ../OrderDetailPanel.tsx). Don't rename this `OrderDetailPanel`
 * export — the shim depends on it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { Plus, AlertTriangle } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { canReopenOrder, EDIT_BLOCKED_STATUSES, isReferenceDeletedUpload } from "@/lib/order-permissions";
import { fetcher } from "@/lib/swr-config";
import { isEditableTarget } from "@/lib/dom";
import { type ComboboxOption } from "@/components/ui/Combobox";
import { type BadgeTone } from "@/components/ui/Badge";
import { useOrderMutation } from "@/hooks/useOrderMutation";
import { useOrderDetailRealtime } from "@/hooks/useOrderDetailRealtime";
import { useCarriers } from "@/hooks/useCarriers";
import { useProductSheet } from "@/hooks/useProductSheet";
import { ProductBriefBanner } from "../ProductBriefBanner";
import { ProductSheetDrawer } from "../ProductSheetDrawer";
import { DexpressStatusSection } from "../DexpressStatusSection";
import { DarbStatusSection } from "../DarbStatusSection";
import { formatDisplayCurrencyCode, LY_MARKET_ID } from "@/lib/markets";
import { isValidLibyanPhone } from "@/lib/carriers/phone";
import { coverageFor, type CoverageState } from "@/lib/carriers/coverage";
import type { Role } from "@/types";
import { PanelHeader } from "./PanelHeader";
import { CustomerHero } from "./CustomerHero";
import { ActionFooter } from "./ActionFooter";
import { CustomerCard } from "./CustomerCard";
import { OrderItemsCard } from "./OrderItemsCard";
import { HistoryTimeline } from "./HistoryTimeline";
import { FulfillmentCard, FULFILLMENT_STATUS_VALUES as FULFILLMENT_VALUES_FROM_CARD } from "./FulfillmentCard";
import type { FulfillmentStatusValue } from "./FulfillmentCard";
import { AlertBanners } from "./AlertBanners";
import { usePrimaryAction } from "./usePrimaryAction";
import type { PanelActionKind } from "./types";

const ScheduleDispatchModal = dynamic(
  () => import("../ScheduleDispatchModal").then((m) => m.ScheduleDispatchModal),
  { ssr: false },
);

const DexpressDispatchModal = dynamic(
  () => import("../DexpressDispatchModal").then((m) => m.DexpressDispatchModal),
  { ssr: false },
);

const DarbAssabilDispatchModal = dynamic(
  () =>
    import("../DarbAssabilDispatchModal").then(
      (m) => m.DarbAssabilDispatchModal,
    ),
  { ssr: false },
);

const TrackingBarcode = dynamic(
  () => import("@/components/orders/TrackingBarcode").then((m) => m.TrackingBarcode),
  { ssr: false },
);

const AddProductPicker = dynamic(
  () => import("../AddProductPicker").then((m) => m.AddProductPicker),
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
  card_payment: boolean;
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
  image_url?: string | null;
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
  /**
   * Called when a Supabase Realtime event indicates the open order has been
   * reassigned away from this agent. The panel closes and the host should
   * surface a toast.
   */
  onReassignedAway?: () => void;
  /**
   * Called when a Realtime event indicates the open order has been
   * cancelled or hard-deleted by a manager.
   */
  onTerminatedByManager?: (kind: "cancelled" | "deleted") => void;
}

/**
 * Subtle per-section color so cards are easy to tell apart at a glance.
 * Intentionally faint (tinted header strip + matching title), never bold —
 * the content surface stays white per the design system.
 */
type SectionAccent = "neutral" | "client" | "order" | "note" | "history" | "fulfillment";

// Phase 2 — section accents removed. Every variant collapses to the pure
// white treatment (bg-surface-card + border-line-subtle + muted label).
// SECTION_ACCENT survives only because the legacy in-file SectionCard helper
// reads from it; the fulfillment block (Phase 3 extraction) is the last
// consumer. New code uses ./OrderDetailPanel/SectionCard instead.
const SECTION_ACCENT: Record<
  SectionAccent,
  { body: string; border: string; title: string; dot: string }
> = {
  neutral: { body: "bg-surface-card", border: "border-line-subtle", title: "text-ink-muted", dot: "bg-ink-muted" },
  client: { body: "bg-surface-card", border: "border-line-subtle", title: "text-ink-muted", dot: "bg-ink-muted" },
  order: { body: "bg-surface-card", border: "border-line-subtle", title: "text-ink-muted", dot: "bg-ink-muted" },
  note: { body: "bg-surface-card", border: "border-line-subtle", title: "text-ink-muted", dot: "bg-ink-muted" },
  history: { body: "bg-surface-card", border: "border-line-subtle", title: "text-ink-muted", dot: "bg-ink-muted" },
  fulfillment: { body: "bg-surface-card", border: "border-line-subtle", title: "text-ink-muted", dot: "bg-ink-muted" },
};

function SectionCard({
  title,
  children,
  className = "",
  accent = "neutral",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  accent?: SectionAccent;
}) {
  const tone = SECTION_ACCENT[accent];
  return (
    <section
      className={[
        "border rounded-card overflow-hidden",
        tone.body,
        tone.border,
        className,
      ].join(" ")}
    >
      <div className="flex items-center gap-2 px-5 pt-3 pb-1">
        <span
          aria-hidden="true"
          className={["w-1.5 h-1.5 rounded-full flex-shrink-0", tone.dot].join(" ")}
        />
        <h3
          className={[
            "text-[10px] font-semibold uppercase tracking-[0.1em]",
            tone.title,
          ].join(" ")}
        >
          {title}
        </h3>
      </div>
      <div className="px-5 pb-2 pt-1 flex flex-col">{children}</div>
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
    <div className="flex items-baseline gap-4 py-2.5 border-b border-line-subtle last:border-0">
      <span className="w-[88px] flex-shrink-0 text-[12px] font-medium text-ink-muted leading-[1.4]">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
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
  onReassignedAway,
  onTerminatedByManager,
}: OrderDetailPanelProps) {
  const t = useTranslations("orders.detail");
  const ts = useTranslations("orders.statuses");
  const tCov = useTranslations("dispatch.coverage");
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

  // Live-sync via Supabase Realtime. Only relevant for the agent role —
  // managers and super_admins skip the reassign-away check because they
  // don't own assignments. We still subscribe so field edits propagate.
  useOrderDetailRealtime({
    orderId,
    swrKey,
    agentId: role === "agent" ? userId ?? null : null,
    onReassignedAway: useCallback(() => {
      onReassignedAway?.();
      onClose();
    }, [onReassignedAway, onClose]),
    onTerminated: useCallback(
      ({ kind }: { kind: "cancelled" | "deleted" }) => {
        onTerminatedByManager?.(kind);
        onClose();
      },
      [onTerminatedByManager, onClose],
    ),
  });

  // Dexpress status section: gated on (carrier === "dexpress" && tracking_number).
  // We resolve the carrier code by looking up order.carrier_id in the cached
  // /api/carriers list for the order's market — the hook already dedupes across
  // panel + upload-picker callers.
  const { carriers: carriersForOrderMarket } = useCarriers(order?.market_id ?? null);
  const dexpressEligible = Boolean(
    order?.tracking_number &&
      order?.carrier_id &&
      carriersForOrderMarket.find((c) => c.id === order.carrier_id)?.code ===
        "dexpress",
  );
  const darbEligible = Boolean(
    order?.tracking_number &&
      order?.carrier_id &&
      carriersForOrderMarket.find((c) => c.id === order.carrier_id)?.code ===
        "darb_assabil",
  );

  const [returningToPool, setReturningToPool] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenWarning, setReopenWarning] = useState<string | null>(null);

  const [saveFlash, setSaveFlash] = useState<"saved" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scheduleDispatchOpen, setScheduleDispatchOpen] = useState(false);
  const [cancelingSchedule, setCancelingSchedule] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadingCarrierId, setUploadingCarrierId] = useState<string | null>(null);
  const [dexpressModalOpen, setDexpressModalOpen] = useState(false);
  const [darbAssabilModalOpen, setDarbAssabilModalOpen] = useState(false);
  // The Darb account the agent picked in the upload sheet — dispatch targets
  // this exact id (a market can have more than one Darb Assabil account).
  const [selectedDarbCarrierId, setSelectedDarbCarrierId] = useState<string | null>(
    null,
  );
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

  const { commit, patchItemOptimistic, deleteItemOptimistic } = useOrderMutation(
    orderId ?? "__none__",
  );

  // An uploaded order whose carrier reference was deleted falls back into the
  // editable pool (treated like confirmed); otherwise uploaded is edit-blocked.
  const canEdit =
    order !== null &&
    (isReferenceDeletedUpload(order) || !EDIT_BLOCKED_STATUSES.has(order.status));

  // Single /api/products/search fetch provides both the picker list and current-product variants.
  // The key MUST include the order's market_id so super_admin gets the right market and
  // switching between orders in different markets uses separate SWR cache entries.
  const productsKey =
    canEdit && order
      ? `/api/products/search?market_id=${order.market_id}`
      : null;
  const { data: productsData, mutate: mutateProducts } = useSWR<{ data: ProductSearchResult[] }>(
    productsKey,
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

  // ── Agent product sheet ──
  // Fetched as soon as the panel opens: the pinned brief and the verification
  // checks render inline, without the agent opening anything.
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [productSheetProductId, setProductSheetProductId] = useState<string | null>(null);
  const productSheet = useProductSheet(
    order?.id ?? null,
    productSheetProductId,
    Boolean(order),
  );

  const closeProductSheet = useCallback(() => {
    setProductSheetOpen(false);
    // Back to the order's primary product so the inline banner reflects the
    // order as a whole again.
    setProductSheetProductId(null);
  }, []);

  const openProductSheet = useCallback((productId?: string | null) => {
    if (productId !== undefined) setProductSheetProductId(productId);
    setProductSheetOpen(true);
  }, []);

  // "p" opens the sheet. Deliberately not gated on canEdit — an agent must be
  // able to read the product even on an order they can no longer modify.
  useEffect(() => {
    if (!order || productSheetOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setProductSheetOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [order, productSheetOpen]);
  const { data: dexpressStatesData } = useSWR<{
    states: Array<{ id: number; name: string }>;
  }>(
    canEdit && isLibyaOrder ? "/api/dexpress/states" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );
  const dexpressStates = dexpressStatesData?.states ?? [];

  // Reset transient UI state when switching orders.
  useEffect(() => {
    setAddProductOpen(false);
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

  const runItemPatch = useCallback(
    async (itemId: string, body: Record<string, unknown>) => {
      try {
        setSaveError(null);
        await patchItemOptimistic(itemId, body);
        setSaveFlash("saved");
        if ("product_id" in body) mutateProducts();
        setTimeout(() => setSaveFlash(null), 1500);
      } catch (e) {
        setSaveFlash("error");
        setSaveError(e instanceof Error ? e.message : t("inlineSaveError"));
        setTimeout(() => setSaveFlash(null), 2500);
      }
    },
    [patchItemOptimistic, mutateProducts, t],
  );

  const runItemDelete = useCallback(
    async (itemId: string) => {
      try {
        setSaveError(null);
        await deleteItemOptimistic(itemId);
        setSaveFlash("saved");
        setTimeout(() => setSaveFlash(null), 1500);
      } catch (e) {
        setSaveFlash("error");
        setSaveError(e instanceof Error ? e.message : t("inlineSaveError"));
        setTimeout(() => setSaveFlash(null), 2500);
      }
    },
    [deleteItemOptimistic, t],
  );

  useEffect(() => {
    if (!order || !canEdit) return;
    // While the product sheet is stacked on top, it owns Escape. Both
    // listeners sit on `document`, so without this guard one Escape would
    // collapse both layers at once.
    if (productSheetOpen) return;
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
  }, [order, canEdit, onClose, productSheetOpen]);

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

  async function handleRecover() {
    if (!orderId) return;
    setRecoverError(null);
    if (!window.confirm(t("recoverConfirm"))) return;
    setRecovering(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setRecoverError((json as { error?: string }).error ?? t("recoverError"));
        return;
      }
      await mutate();
      onReopened?.();
    } catch {
      setRecoverError(t("recoverError"));
    } finally {
      setRecovering(false);
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

  // `confirmManualCancel` is `unknown` because onClick passes a MouseEvent here;
  // only the literal `true` from the override path counts.
  async function handleReopen(confirmManualCancel: unknown = false) {
    if (!orderId) return;
    const force = confirmManualCancel === true;
    setReopening(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/reopen`, {
        method: "POST",
        ...(force
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirm_manual_cancel: true }),
            }
          : {}),
      });
      const json = await res.json().catch(() => ({}));
      // Carrier cancellation couldn't be confirmed — don't silently reopen (that
      // orphans the live shipment). Ask the operator to confirm a manual cancel.
      if (res.status === 409 && json?.code === "carrier_void_failed" && !force) {
        const proceed = window.confirm(
          `${json?.error ?? ""}\n\n${t("confirmManualCancel")}`,
        );
        if (proceed) {
          await handleReopen(true);
          return;
        }
        setReopenModalOpen(false);
        return;
      }
      if (!res.ok) {
        setReopenWarning((json?.error as string) ?? null);
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

  // Carriers are pre-loaded as soon as the order is upload-eligible so the
  // primary CTA's enabled state (`hasActiveCarrier`) reflects the truth
  // without waiting for the user to open the picker.
  const { data: uploadCarriersData } = useSWR<{
    data: Array<{ id: string; name: string; code: string; is_active: boolean }>;
  }>(
    canUploadToCarrier && order
      ? `/api/carriers?market_id=${order.market_id}`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );
  const activeCarriers = (uploadCarriersData?.data ?? []).filter((c) => c.is_active);

  // Per-carrier destination coverage for this order's city (see lib/carriers/coverage).
  // Carriers with no coverage model are treated as "covered" (never blocked).
  const carrierCoverage = coverageFor(
    order?.customer_city ?? null,
    order?.dexpress_state_id ?? null,
  );
  function coverageForCode(code: string): CoverageState {
    if (code === "dexpress") return carrierCoverage.dexpress;
    if (code === "darb_assabil") return carrierCoverage.darb_assabil;
    return "covered";
  }
  const displayCurrency = order
    ? formatDisplayCurrencyCode(order.currency, order.market_id)
    : "";
  // The timeline's chrome follows the interface language. Forcing it to the
  // market's language put an Arabic log inside an otherwise French panel.
  // Agent-authored note text is stored as written and is unaffected.
  const historyLocale = locale;

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

  async function handleDeleteCarrierBarcode(
    confirmManualCancel: unknown = false,
  ): Promise<void> {
    if (!orderId) return;
    const force = confirmManualCancel === true;
    setDeleteFeedback(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/carrier-delete`, {
        method: "POST",
        ...(force
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirm_manual_cancel: true }),
            }
          : {}),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { void_outcome?: string };
        warning?: string;
        error?: string;
        code?: string;
      };
      // Carrier cancellation couldn't be confirmed — offer a manual-cancel
      // override rather than leaving the shipment live behind the order.
      if (res.status === 409 && json.code === "carrier_void_failed" && !force) {
        if (window.confirm(`${json.error ?? ""}\n\n${t("confirmManualCancel")}`)) {
          await handleDeleteCarrierBarcode(true);
        }
        return;
      }
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

  const panelActions = usePrimaryAction({
    order: order ?? {
      status: "pending",
      assigned_to: null,
      updated_at: new Date().toISOString(),
      tracking_number: null,
      carrier_barcode_deleted_at: null,
    },
    role,
    userId,
    hasActiveCarrier: activeCarriers.length > 0,
    canReturnToPool,
  });

  const invokeAction = useCallback(
    (kind: PanelActionKind) => {
      if (!order || !orderId) return;
      switch (kind) {
        case "endCall":
        case "changeStatus":
        case "rescheduleCallback":
          onCallTerminated(orderId, {
            orderId,
            status: order.status,
            marketId: order.market_id,
            attemptsCount: order.attempts_count ?? 0,
          });
          return;
        case "uploadToCarrier":
        case "uploadNow":
          setUploadFeedback(null);
          setUploadOpen(true);
          return;
        case "scheduleDispatch":
          setScheduleDispatchOpen(true);
          return;
        case "cancelSchedule":
          void handleCancelSchedule();
          return;
        case "returnToPool":
          void handleReturnToPool();
          return;
        case "reopen":
          setReopenModalOpen(true);
          return;
        case "recover":
          void handleRecover();
          return;
        case "deleteCarrierBarcode":
          void handleDeleteCarrierBarcode();
          return;
        case "fulfillmentOverride": {
          // Existing fulfillment card lives inline in the body. Best we can do
          // from the footer is scroll it into view; the manager fills it in
          // and hits "Appliquer" on the card itself.
          const card = document.querySelector('[data-fulfillment-card="true"]');
          card?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        case "cancel":
          // Phase 1: cancel from the panel still routes through the manager's
          // bulk-cancel flow on the list. The dedicated /api/orders/:id/cancel
          // hook lands in a follow-up; surfacing it here is a no-op for now
          // so the menu item stays discoverable without misfiring.
          return;
        case "close":
        default:
          onClose();
      }
    },
    [
      order,
      orderId,
      onCallTerminated,
      handleCancelSchedule,
      handleReturnToPool,
      handleDeleteCarrierBarcode,
      handleRecover,
      onClose,
    ],
  );

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-ink-primary/40"
        onClick={(e) => {
          // Only close on a direct click on the overlay surface itself —
          // portaled overflow menus and centered sheets bubble through here.
          if (e.target === e.currentTarget) onClose();
        }}
      />

      {/* Panel */}
      <div className="fixed top-0 end-0 h-full w-full sm:w-[480px] z-50 flex flex-col overflow-hidden bg-surface-card border-s border-line-subtle shadow-panel animate-[slideInEnd_180ms_ease-out]">

        {/* ── Sticky header ─────────────────────────────────────── */}
        <PanelHeader
          shortId={(order?.id ?? orderId ?? "").slice(0, 8).toUpperCase()}
          statusLabel={
            order
              ? ts(order.status as Parameters<typeof ts>[0])
              : ts("pending")
          }
          statusTone={order ? STATUS_TONE[order.status] ?? "neutral" : "neutral"}
          saveFlash={saveFlash}
          carrierDeletedChip={
            order?.carrier_barcode_deleted_at && !order.tracking_number
              ? {
                  label: t("carrierBarcodeDeletedBadge", {
                    carrier:
                      order.carrier_barcode_deleted_carrier_code ?? "carrier",
                  }),
                  tooltip: t("carrierBarcodeDeletedTooltip", {
                    date: new Date(
                      order.carrier_barcode_deleted_at,
                    ).toLocaleDateString(locale === "ar" ? "ar" : "fr"),
                  }),
                }
              : null
          }
          onClose={onClose}
        />

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

              {/* ── Dexpress carrier-side status (Libya only, after upload) ── */}
              <DexpressStatusSection
                orderId={order.id}
                enabled={dexpressEligible}
                role={role}
              />

              {/* ── Darb Assabil carrier-side status (Libya only, after upload) ── */}
              <DarbStatusSection orderId={order.id} enabled={darbEligible} />

              {/* ── Customer hero ── */}
              <div ref={nameFieldRef}>
                <CustomerHero
                  name={order.customer_name}
                  phone={order.customer_phone}
                  phone2={order.customer_phone_2}
                  city={order.customer_city}
                  terminal={TERMINAL_STATUSES.has(order.status)}
                  canEdit={canEdit}
                  isLibyaOrder={isLibyaOrder}
                  onCommitName={(v) => runCommit({ customer_name: v })}
                  onCommitPhone={(v) => runCommit({ customer_phone: v.trim() })}
                  onCommitPhone2={(v) => runCommit({ customer_phone_2: v })}
                  onCopyPhone={() => { void handleCopyPhone(); }}
                  phoneCopied={phoneCopied}
                  validatePhone={(v) => {
                    const trimmed = v.trim();
                    if (trimmed === "") return t("invalidPhone");
                    if (isLibyaOrder && !isValidLibyanPhone(trimmed))
                      return t("invalidPhone");
                    return null;
                  }}
                />
              </div>

              {/* ── Alert banners ── */}
              <AlertBanners
                locale={locale === "ar" ? "ar" : "fr"}
                editBlocked={!canEdit && !canReopen}
                callbackScheduledAt={
                  order.status === "callback_scheduled" ? order.callback_scheduled_at : null
                }
                dispatchScheduledAt={isDispatchScheduled ? order.scheduled_dispatch_at : null}
                dispatchScheduledAuto={order.scheduled_dispatch_auto ?? false}
                cancelingSchedule={cancelingSchedule}
                onCancelSchedule={handleCancelSchedule}
                // A missing city stops the carrier upload. Worth saying out
                // loud on any order that still has somewhere to go — not on
                // one that is already finished.
                cityUnmatched={
                  !order.customer_city?.trim() && !TERMINAL_STATUSES.has(order.status)
                }
                onResolveCity={() => {
                  document
                    .querySelector<HTMLElement>('[data-field="city"]')
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  document.querySelector<HTMLElement>('[data-field="city"] button')?.click();
                }}
              />

              {/* ── Product must-know + catalogue mismatches (zero clicks) ── */}
              <ProductBriefBanner
                brief={productSheet.data?.product?.agent_brief ?? null}
                tone={productSheet.data?.product?.agent_brief_tone ?? "info"}
                checks={productSheet.data?.checks ?? []}
                onOpenSheet={() => openProductSheet()}
              />

              {/* ── Body sections ── */}
              <div className="flex flex-col gap-3 px-4 py-4 pb-10">

                {/* Customer card — address, city, note (no tints) */}
                <CustomerCard
                  address={order.customer_address}
                  city={order.customer_city}
                  note={order.customer_note}
                  canEdit={canEdit}
                  isLibyaOrder={isLibyaOrder}
                  dexpressStates={dexpressStates}
                  loadCities={loadCities}
                  onCommitAddress={(v) => runCommit({ customer_address: v })}
                  onCommitCity={(id) => runCommit({ city_id: id })}
                  onCommitDexpressState={(id) => runCommit({ dexpress_state_id: id })}
                  onCommitNote={(v) => runCommit({ customer_note: v })}
                />

                {/* Order receipt card — collapsible (default-open on
                    confirmed so the agent can verify before upload). */}
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
                    <OrderItemsCard
                      items={items}
                      currentProductId={order.product_id}
                      products={productsData?.data ?? []}
                      variantOptions={variantOptions}
                      loadProducts={loadProducts}
                      deliveryFee={order.delivery_fee ?? 0}
                      cardPayment={order.card_payment}
                      grandTotal={order.total_price}
                      displayCurrency={displayCurrency}
                      canEdit={canEdit}
                      isLibyaOrder={isLibyaOrder}
                      saveError={saveError}
                      defaultOpen={order.status === "confirmed"}
                      onCommitLegacyProduct={(productId) => runCommit({ product_id: productId })}
                      onCommitLegacyQuantity={(qty) => runCommit({ quantity: qty })}
                      onCommitLegacyPrice={(price) => runCommit({ unit_price: price })}
                      onCommitLegacyVariant={(variantId) => runCommit({ variant_id: variantId })}
                      onPatchItem={(itemId, body) => runItemPatch(itemId, body)}
                      onDeleteItem={(itemId) => runItemDelete(itemId)}
                      onCommitDeliveryFee={(v) => runCommit({ delivery_fee: v })}
                      onOpenProductSheet={(productId) => openProductSheet(productId)}
                      renderAddProduct={() => (
                        <AddProductTrigger
                          orderId={order.id}
                          marketId={order.market_id}
                          currentItemIds={items.map((it) => it.product_id)}
                          open={addProductOpen}
                          onOpenChange={setAddProductOpen}
                          onAdded={() => {}}
                          label={t("addProduct")}
                        />
                      )}
                    />
                  );
                })()}


                {/* History timeline */}
                <HistoryTimeline
                  entries={order.history}
                  historyLocale={historyLocale === "ar" ? "ar" : "fr"}
                  defaultOpen={TERMINAL_STATUSES.has(order.status)}
                />

                {/* Fulfillment override — managers only */}
                {canFulfillmentOverride && (
                  <FulfillmentCard
                    statusLabels={Object.fromEntries(
                      FULFILLMENT_VALUES_FROM_CARD.map((v) => [
                        v,
                        ts(v as Parameters<typeof ts>[0]),
                      ]),
                    ) as Record<FulfillmentStatusValue, string>}
                    anchorId="order-fulfillment-card"
                    onSubmit={async ({ status, note, isDamaged: damaged }) => {
                      if (!orderId) return t("loadError");
                      try {
                        const body: Record<string, unknown> = { status, note };
                        if (status === "returned" && damaged) body.is_damaged = true;
                        const res = await fetch(`/api/orders/${orderId}/fulfillment`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(body),
                        });
                        if (!res.ok) {
                          const json = await res.json().catch(() => ({}));
                          return json.error ?? `Erreur ${res.status}`;
                        }
                        await mutate();
                        return null;
                      } catch {
                        return t("loadError");
                      }
                    }}
                  />
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

        {/* ── Upload feedback strip ──────────────────────────────── */}
        {uploadFeedback && (
          <div
            role="status"
            className={[
              "flex-shrink-0 mx-4 mt-2 rounded-card px-3 py-2 text-[12px] border",
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

        {/* ── Recover error strip ────────────────────────────────── */}
        {recoverError && (
          <div
            role="alert"
            className="flex-shrink-0 mx-4 mt-2 rounded-card px-3 py-2 text-[12px] border bg-status-criticalBg border-status-critical/30 text-status-critical"
          >
            {recoverError}
          </div>
        )}

        {/* ── Action footer ──────────────────────────────────────── */}
        {order && (
          <ActionFooter
            actions={panelActions}
            primaryPending={reopening || returningToPool || cancelingSchedule || recovering}
            onInvoke={invokeAction}
          />
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

      <Sheet
        open={uploadOpen && order !== null}
        onClose={() => uploadingCarrierId === null && setUploadOpen(false)}
        placement="center"
        ariaLabel={t("uploadCarrierPickTitle")}
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
            activeCarriers.map((c) => {
              const cov = coverageForCode(c.code);
              const blocked = cov === "uncovered";
              const city = order?.customer_city ?? "";
              return (
                <div key={c.id}>
                  <button
                    type="button"
                    disabled={uploadingCarrierId !== null || blocked}
                    aria-disabled={blocked}
                    onClick={() => {
                      if (blocked) return;
                      if (c.code === "dexpress") {
                        setUploadOpen(false);
                        setDexpressModalOpen(true);
                        return;
                      }
                      if (c.code === "darb_assabil") {
                        setSelectedDarbCarrierId(c.id);
                        setUploadOpen(false);
                        setDarbAssabilModalOpen(true);
                        return;
                      }
                      handleUploadToCarrier(c.id);
                    }}
                    className={[
                      "flex w-full items-center justify-between h-10 px-3 text-[13px] border rounded-card transition-colors duration-fast disabled:cursor-not-allowed",
                      blocked
                        ? "border-status-critical/40 bg-status-criticalBg text-ink-muted"
                        : "border-line-subtle text-ink-primary hover:bg-surface-hover disabled:opacity-50",
                    ].join(" ")}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span
                      className={[
                        "text-[11px] uppercase tracking-wide",
                        blocked ? "text-status-critical" : "text-ink-secondary",
                      ].join(" ")}
                    >
                      {blocked
                        ? tCov("badge")
                        : uploadingCarrierId === c.id
                          ? t("uploadingToCarrier")
                          : c.code}
                    </span>
                  </button>
                  {blocked && (
                    <p className="mt-1 px-1 text-[11px] text-status-critical">
                      {tCov("notCovered", { city })}
                    </p>
                  )}
                </div>
              );
            })
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
      </Sheet>

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

      {darbAssabilModalOpen && order && orderId && selectedDarbCarrierId && (
        <DarbAssabilDispatchModal
          orderId={orderId}
          carrierId={selectedDarbCarrierId}
          customerAddress={order.customer_address}
          customerCity={order.customer_city}
          onClose={() => setDarbAssabilModalOpen(false)}
          onSuccess={(trackingNumber) => {
            setDarbAssabilModalOpen(false);
            setUploadFeedback({
              kind: "success",
              tracking: trackingNumber ?? "—",
            });
            void mutate();
          }}
        />
      )}

      {/* Reopen confirmation modal */}
      <Sheet
        open={reopenModalOpen && order !== null}
        onClose={() => !reopening && setReopenModalOpen(false)}
        placement="center"
        ariaLabel={t("reopenConfirmTitle")}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-[15px] font-semibold text-ink-primary mb-1">
            {t("reopenConfirmTitle")}
          </h2>
          <p className="text-[13px] text-ink-secondary leading-relaxed">
            {order?.tracking_number
              ? t("reopenConfirmBody")
              : t("reopenConfirmBodyNoTracking")}
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
      </Sheet>

      {/* Stacks over this panel; the panel's own Escape handler stands down
          while it is open. */}
      <ProductSheetDrawer
        open={productSheetOpen}
        onClose={closeProductSheet}
        data={productSheet.data}
        isLoading={productSheet.isLoading}
        isError={productSheet.isError}
        customerPhone={order?.customer_phone ?? null}
        market={isLibyaOrder ? "ly" : "tn"}
        locale={locale === "ar" ? "ar" : "fr"}
        onOpenProduct={(productId) => setProductSheetProductId(productId)}
      />
    </>
  );
}

/**
 * The "+ Add product" button + portaled picker. Lives inside OrderDetailPanel
 * so it shares the panel's translation namespace, but the picker itself is
 * rendered in a portal anchored to this button so the receipt card's
 * overflow-hidden can never clip the dropdown.
 */
function AddProductTrigger({
  orderId,
  marketId,
  currentItemIds,
  open,
  onOpenChange,
  onAdded,
  label,
}: {
  orderId: string;
  marketId: string;
  currentItemIds: (string | null)[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  label: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center justify-center gap-1.5 w-full text-[12px] font-medium text-ink-secondary border border-dashed border-line-strong rounded-card py-1.5 hover:text-ink-primary hover:border-ink-primary hover:bg-surface-hover transition-colors duration-fast mt-1"
      >
        <Plus size={12} strokeWidth={2} aria-hidden="true" />
        {label}
      </button>
      {open && (
        <AddProductPicker
          orderId={orderId}
          marketId={marketId}
          currentItemIds={currentItemIds}
          anchorRef={buttonRef}
          onClose={() => onOpenChange(false)}
          onAdded={onAdded}
        />
      )}
    </>
  );
}
