"use client";

/**
 * The order panel — one panel for everyone (prototypes/commandes-v4.html, the
 * drawer). Managers open it over /orders ("overlay": the prototype's drawer);
 * agents open it beside the call queue ("side": a sticky card on a desktop,
 * the whole screen on a phone). Same content, same behaviour, either way.
 *
 * This file is the orchestrator: state, handlers, data fetching. The visual
 * layer lives in the sibling files, top to bottom as the prototype draws it:
 *
 *   PanelHeader.tsx       — .dr-top: status pill · reçue … · late chip · #ref · ×
 *   CustomerHero.tsx      — .pc: name, WhatsApp + Appeler, phone, reliability, 2nd phone
 *   OrderFacts.tsx        — .facts: Ville, Adresse, Note, Total, Agent, Transporteur, Boutique
 *   PanelTabs.tsx         — .tabwrap: Articles · Livraison · Historique · Messages
 *   OrderItemsCard.tsx    — the Articles pane (.line, .pane-acts, .tot)
 *   TrackingSection.tsx   — the Livraison pane's step list (.tl)
 *   HistoryTimeline.tsx   — the Historique pane (.tl)
 *   AlertBanners.tsx      — .notes: one short line per problem, above the footer
 *   ActionFooter.tsx      — .dr-foot: the buttons per status, ⋯ for the rest
 *   usePrimaryAction.ts   — pure resolver: (status, role, ...) → which actions exist
 *
 * Styles: commandes.css (the prototype's classes, scoped under .cmd) and
 * panel.css (the side card, the phone layout). The root carries `.cmd`.
 *
 * Callers import from "@/components/queue/OrderDetailPanel" (a re-export
 * shim at ../OrderDetailPanel.tsx). Don't rename this `OrderDetailPanel`
 * export — the shim depends on it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { Sheet } from "@/components/ui/Sheet";
import { panelShellClasses, type PanelVariant } from "./shell";
import { canReopenOrder, EDIT_BLOCKED_STATUSES, isReferenceDeletedUpload } from "@/lib/order-permissions";
import { fetcher } from "@/lib/swr-config";
import { isEditableTarget } from "@/lib/dom";
import { type ComboboxOption } from "@/components/ui/Combobox";
import { useOrderMutation, OrderConflictError } from "@/hooks/useOrderMutation";
import { readActionFailure } from "@/lib/orders/action-failure";
import { useOrderDetailRealtime } from "@/hooks/useOrderDetailRealtime";
import { useCarriers } from "@/hooks/useCarriers";
import { useMaxCallAttempts } from "@/hooks/useMaxCallAttempts";
import { useCustomerHistory } from "@/hooks/useCustomerHistory";
import { useSlaMinutes } from "@/hooks/useSlaMinutes";
import { useProductSheet } from "@/hooks/useProductSheet";
import { ProductBriefBanner } from "../ProductBriefBanner";
import { ProductSheetDrawer } from "../ProductSheetDrawer";
import { TrackingSection } from "./TrackingSection";
import { DexpressStatusSection } from "../DexpressStatusSection";
import { DarbStatusSection } from "../DarbStatusSection";
import { formatDisplayCurrencyCode, LY_MARKET_ID } from "@/lib/markets";
import { isValidLibyanPhone } from "@/lib/carriers/phone";
import { coverageFor, type CoverageState } from "@/lib/carriers/coverage";
import { useDarbDestinations } from "@/hooks/useDarbDestinations";
import { useCarrierRates } from "@/hooks/useCarrierRates";
import { destinationKey } from "@/lib/carriers/destination-key";
import { useResetOnDestinationChange } from "@/hooks/useResetOnDestinationChange";
import { useCarrierPerformance } from "@/hooks/useCarrierPerformance";
import { compareCarriers } from "@/lib/carriers/carrier-comparison";
import { CarrierComparisonCard } from "../CarrierComparisonCard";
import type { Role } from "@/types";
import { PanelHeader } from "./PanelHeader";
import { CustomerHero } from "./CustomerHero";
import { ActionFooter } from "./ActionFooter";
import { OrderItemsCard } from "./OrderItemsCard";
import { MergeOrderPanel } from "@/components/orders/merge/MergeOrderPanel";
import { HistoryTimeline } from "./HistoryTimeline";
import { AlertBanners, panelNotes, type ExtraNote } from "./AlertBanners";
import { OrderFacts } from "./OrderFacts";
import { PanelTabs, type PanelTab } from "./PanelTabs";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { useWhatsAppThread } from "@/hooks/useWhatsAppThread";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { MessageThread } from "@/components/whatsapp/MessageThread";
import { WhatsAppComposer } from "@/components/whatsapp/WhatsAppComposer";
import { resolveOrderVariables } from "@/lib/whatsapp/render";
import { toWhatsAppE164 } from "@/lib/whatsapp/phone";
import { usePrimaryAction } from "./usePrimaryAction";
import type { PanelActionKind } from "./types";
import { useOrderPresence } from "@/hooks/useOrderPresence";
import { OrderTakeoverScreen } from "../OrderTakeoverScreen";
import { useOrderLocks } from "@/hooks/useOrderLocks";
import { useTypingMode } from "@/hooks/useTypingMode";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useRegisterFeedbackContext } from "@/components/feedback/FeedbackCaptureProvider";
import { PanelFeedbackButton } from "@/components/feedback/PanelFeedbackButton";
import { TypingActivityProvider } from "@/components/ui/typing-activity";
import { Ic, type StoreInfo } from "@/components/orders/commandes/ui";
import { useRejectionBadge } from "@/hooks/useRejectionBadge";
import { reliabilityChip, type HistoryInput, type ReliabilityChip } from "@/lib/orders/row-signals";
import "@/components/orders/commandes/commandes.css";
import "./panel.css";

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
  darb_destination_id: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_fee: number;
  card_payment: boolean;
  currency: string;
  status: string;
  assigned_to: string | null;
  /** Resolved server-side — `null` means unassigned, never "not looked up". */
  assigned_agent_name: string | null;
  market_id: string;
  attempts_count?: number | null;
  /** Intake time — drives the header's elapsed-time reading. */
  created_at: string;
  updated_at: string;
  /** Storefront order number. Preferred over the UUID as the human reference. */
  external_id: string | null;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_barcode_deleted_at: string | null;
  carrier_barcode_deleted_carrier_code: string | null;
  callback_scheduled_at: string | null;
  scheduled_dispatch_at: string | null;
  scheduled_dispatch_auto: boolean | null;
  scheduled_dispatch_carrier_id: string | null;
  rejection_reason?: string | null;
  rejection_subreason?: string | null;
  rejection_note?: string | null;
  storefront_id?: string | null;
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

/** Kept in lockstep with return_order_to_pool (20260505233818). */
const RETURN_TO_POOL_STATUSES = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
]);

const TERMINAL_STATUSES = new Set([
  "delivered",
  "returned",
  "rejected",
  "deleted",
  "cancelled",
]);


export interface CallTerminatedContext {
  orderId: string;
  status: string;
  marketId: string;
  attemptsCount: number;
  /**
   * Which step the post-call sheet should open on. Set when the footer already
   * knows how the call ended, so the agent is not asked the same question
   * twice. Omitted means the full outcome picker.
   */
  flow?: "option_select" | "reject_flow" | "callback_expanded" | "confirm_now" | "no_answer_now";
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
  /**
   * Where the panel sits. "overlay" is the original slide-over; "side" puts it
   * in the page grid beside the list on desktop (rev 2). Only the shell
   * changes — everything inside is identical.
   */
  variant?: PanelVariant;
  /** Open on a given tab — the bell's "a répondu sur WhatsApp" lands on Messages. */
  initialTab?: PanelTab;
  /**
   * The call sheet is open on top of this panel. The panel stays mounted —
   * « Annuler » on the sheet must land back on the order — but its keyboard
   * shortcuts stand down: both layers listen on `document`, and one Escape
   * used to close the two at once.
   */
  covered?: boolean;
}

/** Below Tailwind's `lg`, where the panel is the whole screen. */
const PHONE_QUERY = "(max-width: 1023px)";

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    setPhone(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return phone;
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
  variant = "overlay",
  initialTab,
  covered = false,
}: OrderDetailPanelProps) {
  const t = useTranslations("orders.detail");

  // On a phone the panel covers the queue. Without this, a drag on its header
  // or footer — or one that runs past the end of its scroll — scrolls the
  // list hidden behind it, and the panel appears to jump. On a desktop the
  // list beside it must keep scrolling, so the lock is phone-only.
  const isPhone = useIsPhone();
  useBodyScrollLock(isPhone && orderId !== null);

  // « Voix du client » (plans/voix-du-client.md): this order is the capture context, and
  // while the capture window is up the panel's keys stand down exactly as under the call
  // sheet — both layers listen on `document`.
  const feedback = useRegisterFeedbackContext(orderId);
  const layered = covered || feedback.captureOpen;
  const ts = useTranslations("orders.statuses");
  const tCov = useTranslations("dispatch.coverage");
  const tMerge = useTranslations("orderMerge");
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

  // Announce that this tab has the order open. An agent's row is what blocks
  // manager writes; a manager's row is advisory and blocks nobody, so an agent
  // mid-call is never frozen by a manager reading over their shoulder.
  //
  // `mode` flips to "editing" as soon as anything is dirty, which is what turns
  // the manager's hollow "consulte" ring into a filled "modifie" one.
  // `editing` is a live state, not a latch. It used to be set on the first
  // commit and never cleared, so anyone who touched one field showed as editing
  // for the rest of the session — survivable when it was only a ring colour,
  // an outright lie now that it drives a typing bubble.
  const { mode: presenceMode, noteActivity: noteTyping, stop: stopTyping } = useTypingMode();

  // Closing the panel ends the typing immediately. Waiting out the idle timer
  // would let the final heartbeat still report "editing" on an order nobody has
  // open any more.
  useEffect(() => stopTyping, [orderId, stopTyping]);
  const [takenOverBy, setTakenOverBy] = useState<string | null>(null);
  const [wasTakenOver, setWasTakenOver] = useState(false);

  // Who else is in this order, for the header. Scoped to this viewer: an agent
  // sees managers standing on their own orders; a manager sees the market.
  const { othersOn } = useOrderLocks({
    marketId: null,
    enabled: Boolean(userId && orderId),
    scope: role === "agent" && userId ? { kind: "agent", userId } : { kind: "market" },
    selfId: userId ?? null,
  });

  useOrderPresence({
    orderId,
    role,
    mode: presenceMode,
    onLockLost: useCallback(() => {
      // Belt to the broadcast's braces: if the socket is down, the next beat is
      // what tells the agent a super_admin took the order.
      if (role === "agent") setWasTakenOver(true);
    }, [role]),
  });

  // Live-sync via Supabase Realtime. Only relevant for the agent role —
  // managers and super_admins skip the reassign-away check because they
  // don't own assignments. We still subscribe so field edits propagate.
  useOrderDetailRealtime({
    orderId,
    swrKey,
    agentId: role === "agent" ? userId ?? null : null,
    onForceReleased: useCallback((releasedByName: string | null) => {
      setTakenOverBy(releasedByName);
      setWasTakenOver(true);
    }, []),
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

  // Same cached list, so naming the carrier costs no extra request. `null` is
  // "no carrier yet", which is a real state — not a lookup that hasn't landed.
  const maxCallAttempts = useMaxCallAttempts(order?.market_id ?? null);

  // The customer's record, for the reliability strip. Fetched as soon as the
  // panel has an order — unlike the queue row's popover, which waits for a
  // hover, this one is read at a glance while the agent is dialling, so making
  // it appear a beat late would mean it appears after the decision.
  const { detail: customerHistory } = useCustomerHistory("order", order?.id ?? null, Boolean(order));
  const customerStats = customerHistory?.stats ?? null;

  // « À risque » / « Fiable » / « Nouveau client » reads the customer's record
  // BEFORE this order. A row from the orders list already carries it (prior_*
  // counts); a queue row does not, so the panel falls back to the history it
  // fetches — which excludes the open order too (get_customer_history_detail).
  const reliability: ReliabilityChip | null = useMemo(() => {
    const row = fallbackOrder as HistoryInput | null | undefined;
    if (row && typeof row.prior_order_count === "number") return reliabilityChip(row);
    if (!customerStats) return null;
    return reliabilityChip({
      prior_order_count: customerStats.total_orders,
      prior_delivered_count: customerStats.delivered_count,
      prior_returned_count: customerStats.returned_count,
      prior_rejected_count: customerStats.rejected_count,
    });
  }, [fallbackOrder, customerStats]);

  // A rejected order's pill names the sub-reason with its group's icon.
  const rejectionBadge = useRejectionBadge(order?.market_id ?? null);

  // The store the order came from — name, colour dot, platform.
  const { data: storesData } = useSWR<{ data: StoreInfo[] }>(
    order ? `/api/storefronts?market_id=${order.market_id}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );
  const store = order?.storefront_id
    ? storesData?.data?.find((st) => st.id === order.storefront_id)
    : undefined;

  const slaMinutes = useSlaMinutes(order?.market_id ?? null);

  const assignedCarrierName = order?.carrier_id
    ? carriersForOrderMarket.find((c) => c.id === order.carrier_id)?.name ?? null
    : null;

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
  const [mergeOpen, setMergeOpen] = useState(false);
  // Articles opens by default — it is the section that changes most.
  const [tab, setTab] = useState<PanelTab>(initialTab ?? "items");

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

  const { commit, patchItemOptimistic, deleteItemOptimistic, noteServerRow } =
    useOrderMutation(orderId ?? "__none__");

  // Seed the save precondition from whatever the server last told us about this
  // order — the initial GET, a revalidation, a realtime-driven refetch. Without
  // this the first edit after opening the panel would save unguarded.
  useEffect(() => {
    if (order) noteServerRow(order);
    // noteServerRow is stable for the life of the hook; re-running on every
    // render would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.updated_at]);

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

  // Libya orders bind to the Darb Assabil (city, area) catalogue — the same
  // list the dispatch step ships from, so the zone is picked once.
  const isLibyaOrder = order?.market_id === LY_MARKET_ID;
  const { destinations: darbDestinations, hasIds: darbHasIds } = useDarbDestinations(
    Boolean(order) && isLibyaOrder,
  );

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
    if (!order || productSheetOpen || layered) return;
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setProductSheetOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [order, productSheetOpen, layered]);

  // Reset transient UI state when switching orders.
  useEffect(() => {
    setAddProductOpen(false);
  }, [order?.id]);

  // ── WhatsApp (business number) ──
  // The tab and the hero button are always there once we know whether the
  // market is connected — "show it disabled" was the owner's call
  // (2026-09-25): not connected, the tab explains why and offers today's
  // wa.me link; connected, it is the thread and the composer.
  const { active: whatsappActive, known: whatsappKnown } = useWhatsAppAvailability(order?.market_id ?? null);
  const whatsappThread = useWhatsAppThread(order ? { order_id: order.id, market_id: order.market_id } : null);
  const { templates: whatsappTemplates } = useWhatsAppTemplates(whatsappActive && order ? order.market_id : null);
  const whatsappUnread = whatsappThread.unread;
  const markWhatsAppRead = whatsappThread.markRead;
  useEffect(() => {
    if (tab === "messages" && whatsappUnread > 0) void markWhatsAppRead();
  }, [tab, whatsappUnread, markWhatsAppRead]);
  const whatsappState: "active" | "not_connected" | "opted_out" | null = !whatsappKnown
    ? null
    : !whatsappActive
      ? "not_connected"
      : whatsappThread.thread?.conversation?.opted_out_at
        ? "opted_out"
        : "active";
  const whatsappFallbackHref = useMemo(() => {
    if (!order) return null;
    const e164 = toWhatsAppE164(order.customer_phone, isLibyaOrder ? "ly" : "tn");
    return e164 ? `https://wa.me/${e164}` : null;
  }, [order, isLibyaOrder]);

  const runCommit = useCallback(
    async (updates: Record<string, unknown>) => {
      // Anyone actually changing a field is "modifie", not "consulte". For a
      // manager this is what turns the hollow ring on the agent's card into a
      // filled one — the difference between being read and being touched.
      noteTyping();
      try {
        setSaveError(null);
        await commit(updates);
        setSaveFlash("saved");
        if ("product_id" in updates) mutateProducts();
        setTimeout(() => setSaveFlash(null), 1500);
      } catch (e) {
        setSaveFlash("error");
        if (e instanceof OrderConflictError) {
          // Somebody else saved first. Put THEIR order in the cache — rolling
          // back to our pre-edit value would show a number that is also wrong —
          // and leave the field editable with the fresh value in it.
          await mutate({ data: e.fresh as unknown as OrderDetail }, { revalidate: false });
          setSaveError(t("conflictReloaded"));
        } else {
          setSaveError(e instanceof Error ? e.message : t("inlineSaveError"));
        }
        setTimeout(() => setSaveFlash(null), 2500);
      }
    },
    [commit, mutate, mutateProducts, t],
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
    // collapse both layers at once. The call sheet stacked above is the same.
    if (productSheetOpen || layered) return;
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
  }, [order, canEdit, onClose, productSheetOpen, layered]);

  if (orderId === null) return null;

  const errorMessage = swrError
    ? t("loadError")
    : !isLoading && swrData && !swrData.data
      ? t("orderNotFound")
      : null;

  // Mirrors return_order_to_pool's own allow-list, not merely "not terminal":
  // the RPC raises `Cannot return to pool from status: %` for anything past
  // dispatch_scheduled, and an affordance that is guaranteed to fail is worse
  // than no affordance at all.
  const canReturnToPool =
    onReturnToPool !== undefined &&
    order !== null &&
    order.assigned_to !== null &&
    RETURN_TO_POOL_STATUSES.has(order.status);

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

  // `role === undefined` is the agent queue, which mounts the panel without
  // one. Managers reach the same action from the orders page; the permission
  // helper is what decides, not the surface the panel happens to be on.
  const canReopen =
    order !== null &&
    canReopenOrder(role ?? "agent", userId ?? "", {
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
  const allActiveCarriers = (uploadCarriersData?.data ?? []).filter((c) => c.is_active);

  // Per-destination price per carrier account. Libya runs two Darb Assabil
  // accounts whose prices for the same address differ by 5-25 LYD, so the flat
  // carriers.delivery_fee cannot tell them apart.
  // The destination rides in the SWR key: a quote is only true for one address,
  // and this order's destination can change while the panel is open.
  const orderDestinationKey = destinationKey(order);
  const { ratesByCarrierId } = useCarrierRates(
    order?.id,
    Boolean(canUploadToCarrier && order && uploadOpen),
    orderDestinationKey,
  );

  // The Darb account picked in the upload sheet was never cleared — not on
  // close, not on success. A destination edit is the one moment it is certainly
  // wrong to keep, since the accounts swap places by geography.
  useResetOnDestinationChange(orderDestinationKey, () => setSelectedDarbCarrierId(null));
  // 30-day delivery rate + median transit, the other two legs of "meilleur
  // choix". Fails soft: no data just means those stats render as "—".
  const { performanceByCarrierId } = useCarrierPerformance(
    order?.market_id,
    Boolean(canUploadToCarrier && order && uploadOpen),
  );

  // Same ranking as the post-call picker and the schedule modal: cost +
  // delivery rate + transit time, not cost alone. One rule, three surfaces.
  const carrierComparison = compareCarriers(
    allActiveCarriers.map((c) => ({
      carrierId: c.id,
      cost: ratesByCarrierId[c.id]?.quotedFee ?? null,
      deliveryRate: performanceByCarrierId[c.id]?.deliveryRate30d ?? null,
      transitHours: performanceByCarrierId[c.id]?.medianTransitHours ?? null,
    })),
  );
  const comparisonByCarrierId: Record<
    string,
    (typeof carrierComparison.rows)[number]
  > = {};
  for (const row of carrierComparison.rows) {
    comparisonByCarrierId[row.carrierId] = row;
  }

  // Best choice first, but ONLY once scoring has something to say — a list
  // that reshuffles itself when a request lands is worse than a static one.
  const activeCarriers = carrierComparison.bestChoiceCarrierId
    ? [...allActiveCarriers].sort((a, b) => {
        const scoreOf = (id: string) => comparisonByCarrierId[id]?.score;
        const sa = scoreOf(a.id);
        const sb = scoreOf(b.id);
        if (sa == null && sb == null) return 0;
        if (sa == null) return 1;
        if (sb == null) return -1;
        return sb - sa;
      })
    : allActiveCarriers;

  // Per-carrier destination coverage for this order's city (see lib/carriers/coverage).
  // Carriers with no coverage model are treated as "covered" (never blocked).
  const carrierCoverage = coverageFor(
    order?.customer_city ?? null,
    order?.dexpress_state_id ?? null,
    order?.darb_destination_id ?? null,
  );
  function coverageForCode(code: string): CoverageState {
    if (code === "dexpress") return carrierCoverage.dexpress;
    if (code === "darb_assabil") return carrierCoverage.darb_assabil;
    return "covered";
  }
  const displayCurrency = order
    ? formatDisplayCurrencyCode(order.currency, order.market_id)
    : "";

  // Orders predating the order_items table carry their single product on the
  // order row itself. The receipt has always synthesised a line for them; the
  // facts grid counted the empty array instead and captioned a one-product
  // order "0 articles".
  const orderItems: OrderItem[] = useMemo(() => {
    if (!order) return [];
    if (order.order_items?.length) return order.order_items;
    return [
      {
        id: "legacy",
        order_id: order.id,
        product_id: order.product_id,
        product_name: order.product_name,
        variant_id: order.variant_id,
        variant_label: order.variant_label,
        // Defaulted, because a receipt that prints "1 × undefined" during a
        // revalidation is worse than one that briefly prints a zero.
        quantity: order.quantity ?? 1,
        unit_price: order.unit_price ?? 0,
        line_total: (order.total_price ?? 0) - (order.delivery_fee ?? 0),
        created_at: order.updated_at,
        updated_at: order.updated_at,
      },
    ];
  }, [order]);

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
      if (res.ok) {
        await mutate();
      } else {
        // This used to be swallowed entirely: a failed cancel just stopped the
        // spinner and left the schedule on screen. The common failure is a lost
        // race — the cron uploaded the order while the panel was open — and the
        // refresh is what makes the panel agree with the database again.
        const body = await res.json().catch(() => null);
        const failure = readActionFailure(res.status, body);
        if (failure.conflict) await mutate();
        setSaveError(failure.message ?? t("inlineSaveError"));
      }
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
        case "confirm":
        case "callback":
        case "reject":
          onCallTerminated(orderId, {
            orderId,
            status: order.status,
            marketId: order.market_id,
            attemptsCount: order.attempts_count ?? 0,
            // Each of the four buttons names its ending, so each carries the
            // agent straight to it — nothing re-asks the question the button
            // just answered. `rescheduleCallback` deliberately lands on the
            // callback step; only `changeStatus` opens the plain picker.
            flow:
              kind === "confirm"
                ? "confirm_now"
                : kind === "endCall"
                  ? "no_answer_now"
                  : kind === "reject"
                    ? "reject_flow"
                    : kind === "callback" || kind === "rescheduleCallback"
                      ? "callback_expanded"
                      : undefined,
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

  const shell = panelShellClasses(variant);

  const cityMissing = order !== null && !order.customer_city?.trim() && !order.darb_destination_id;
  const outOfStock =
    order !== null &&
    orderItems.some((it) => {
      const p = productsData?.data?.find((x) => x.id === it.product_id);
      return p !== undefined && p.current_stock <= 0;
    });
  const fallbackFlags = (fallbackOrder ?? {}) as { is_potential_duplicate?: boolean | null; has_uploaded_sibling?: boolean | null };
  const notes = order
    ? panelNotes({
        status: order.status,
        cityMissing,
        outOfStock,
        dupShipped: Boolean(fallbackFlags.is_potential_duplicate && fallbackFlags.has_uploaded_sibling),
        editBlocked: !canEdit,
        callbackScheduledAt: order.callback_scheduled_at,
        dispatchScheduledAt: order.scheduled_dispatch_at,
      })
    : [];

  // The panel's own feedback, as lines in the same stack as the notices.
  const extraNotes: ExtraNote[] = [];
  if (reopenWarning) extraNotes.push({ key: "reopen", hue: "amber", icon: "alert", text: t("reopenWarning"), alert: true });
  if (uploadFeedback?.kind === "success")
    extraNotes.push({ key: "upload", hue: "green", icon: "check", text: t("uploadCarrierSuccess", { tracking: uploadFeedback.tracking }) });
  if (uploadFeedback?.kind === "error")
    extraNotes.push({ key: "upload", hue: "red", icon: "alert", text: t("uploadCarrierError", { error: uploadFeedback.message }), alert: true });
  if (recoverError) extraNotes.push({ key: "recover", hue: "red", icon: "alert", text: recoverError, alert: true });
  if (deleteFeedback)
    extraNotes.push(
      deleteFeedback.kind === "success"
        ? { key: "delete", hue: "green", icon: "check", text: t("deleteBarcodeSuccess") }
        : { key: "delete", hue: deleteFeedback.kind === "warning" ? "amber" : "red", icon: "alert", text: deleteFeedback.message, alert: true },
    );
  if (saveError) extraNotes.push({ key: "save", hue: "red", icon: "alert", text: saveError, alert: true });

  const reference = order?.external_id ?? order?.id ?? orderId ?? "";

  async function copyTracking() {
    if (!order?.tracking_number) return;
    try {
      await navigator.clipboard.writeText(order.tracking_number);
    } catch {
      /* clipboard denied — the number is still on screen */
    }
  }

  return (
    // Every InlineField below reports keystrokes through this, so the presence
    // "is typing" bubble reacts to the typing rather than to the save.
    <TypingActivityProvider onActivity={noteTyping}>
      <div className={shell.root}>
        {/* Scrim — only over the orders page. Beside the queue there is none:
            the point is that the list stays readable. */}
        {shell.overlay && (
          <div
            className={shell.overlay}
            onClick={(e) => {
              // Only a click on the scrim itself — portaled menus bubble through here.
              if (e.target === e.currentTarget) onClose();
            }}
          />
        )}

        <aside
          className={shell.panel}
          role={variant === "overlay" ? "dialog" : undefined}
          aria-label={t("panelAria", { ref: reference })}
        >
          {wasTakenOver && (
            <OrderTakeoverScreen
              releasedByName={takenOverBy}
              onDismiss={() => {
                setWasTakenOver(false);
                onClose();
              }}
            />
          )}

          <PanelHeader
            // The storefront number is what a customer quotes and what a carrier
            // search box expects; the UUID is only a fallback.
            reference={reference}
            marketId={order?.market_id ?? null}
            createdAt={order?.created_at ?? new Date().toISOString()}
            pill={{
              status: order?.status ?? "pending",
              attempts_count: order?.attempts_count,
              callback_scheduled_at: order?.callback_scheduled_at,
              rejection_reason: order?.rejection_reason,
              rejection_subreason: order?.rejection_subreason,
              rejection_note: order?.rejection_note,
            }}
            maxAttempts={maxCallAttempts}
            rejection={rejectionBadge}
            locale={locale}
            slaMinutes={slaMinutes}
            saveFlash={saveFlash}
            presenceRows={orderId ? othersOn(orderId) : undefined}
            feedbackSlot={feedback.enabled && orderId ? <PanelFeedbackButton orderId={orderId} /> : undefined}
            carrierDeletedChip={
              order?.carrier_barcode_deleted_at && !order.tracking_number
                ? {
                    label: t("carrierBarcodeDeletedBadge", {
                      carrier: order.carrier_barcode_deleted_carrier_code ?? "carrier",
                    }),
                    tooltip: t("carrierBarcodeDeletedTooltip", {
                      date: new Date(order.carrier_barcode_deleted_at).toLocaleDateString(locale === "ar" ? "ar" : "fr"),
                    }),
                  }
                : null
            }
            onClose={onClose}
          />

          {isLoading && !order && <div className="odp-msg">{t("loading")}</div>}
          {errorMessage && <div className="odp-msg bad">{errorMessage}</div>}

          {order && (
            /* The one scroll region: client, facts, the tab strip (sticky) and
               the pane all scroll together, as in the prototype. */
            <div className="dr-body" data-testid="panel-scroll">
              <div ref={nameFieldRef}>
                <CustomerHero
                  name={order.customer_name}
                  phone={order.customer_phone}
                  phone2={order.customer_phone_2}
                  terminal={TERMINAL_STATUSES.has(order.status)}
                  reliability={reliability}
                  canEdit={canEdit}
                  onCommitName={(v) => runCommit({ customer_name: v })}
                  onCommitPhone={(v) => runCommit({ customer_phone: v.trim() })}
                  onCommitPhone2={(v) => runCommit({ customer_phone_2: v })}
                  onCopyPhone={() => {
                    void handleCopyPhone();
                  }}
                  phoneCopied={phoneCopied}
                  whatsappState={whatsappState}
                  whatsappUnread={whatsappUnread}
                  onWhatsApp={() => setTab("messages")}
                  validatePhone={(v) => {
                    const trimmed = v.trim();
                    if (trimmed === "") return t("invalidPhone");
                    if (isLibyaOrder && !isValidLibyanPhone(trimmed)) return t("invalidPhone");
                    return null;
                  }}
                />
              </div>

              <OrderFacts
                total={order.total_price}
                currencyCode={displayCurrency}
                // Same list the receipt renders, so the count and the receipt agree.
                itemCount={orderItems.reduce((n, it) => n + (Number(it.quantity) || 0), 0)}
                city={order.customer_city}
                address={order.customer_address}
                note={order.customer_note}
                agent={order.assigned_to ? { id: order.assigned_to, name: order.assigned_agent_name ?? "—" } : null}
                carrierName={assignedCarrierName}
                store={store}
                canEdit={canEdit}
                isLibyaOrder={isLibyaOrder}
                darbDestinations={darbHasIds ? darbDestinations : []}
                darbDestinationId={order.darb_destination_id ?? null}
                loadCities={loadCities}
                onCommitAddress={(v) => runCommit({ customer_address: v })}
                onCommitCity={(id) => runCommit({ city_id: id })}
                onCommitDarbDestination={(id) => runCommit({ darb_destination_id: id })}
                onCommitNote={(v) => runCommit({ customer_note: v })}
              />

              <PanelTabs active={tab} onChange={setTab} showMessages={whatsappKnown} messagesCount={whatsappUnread} />

              <div role="tabpanel" hidden={tab !== "items"} className="pane">
                {/* Product must-know + catalogue mismatches. */}
                <ProductBriefBanner
                  brief={productSheet.data?.product?.agent_brief ?? null}
                  tone={productSheet.data?.product?.agent_brief_tone ?? "info"}
                  checks={productSheet.data?.checks ?? []}
                  onOpenSheet={() => openProductSheet()}
                />
                <OrderItemsCard
                  items={orderItems}
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
                  onCommitLegacyProduct={(productId) => runCommit({ product_id: productId })}
                  onCommitLegacyQuantity={(qty) => runCommit({ quantity: qty })}
                  onCommitLegacyPrice={(price) => runCommit({ unit_price: price })}
                  onCommitLegacyVariant={(variantId) => runCommit({ variant_id: variantId })}
                  onPatchItem={(itemId, body) => runItemPatch(itemId, body)}
                  onDeleteItem={(itemId) => runItemDelete(itemId)}
                  onCommitDeliveryFee={(v) => runCommit({ delivery_fee: v })}
                  onOpenProductSheet={(productId) => openProductSheet(productId)}
                  renderAddProduct={() => (
                    <>
                      <AddProductTrigger
                        orderId={order.id}
                        marketId={order.market_id}
                        currentItemIds={orderItems.map((it) => it.product_id)}
                        open={addProductOpen}
                        onOpenChange={setAddProductOpen}
                        onAdded={() => {}}
                        label={t("addProduct")}
                      />
                      {/* The basket split: the same customer ordered another
                          product separately. The merge panel decides whether
                          the market has merging on and lists the candidates. */}
                      <button type="button" className="btn2" onClick={() => setMergeOpen(true)}>
                        <Ic n="merge" />
                        {tMerge("action")}
                      </button>
                    </>
                  )}
                />
              </div>

              <div role="tabpanel" hidden={tab !== "shipping"} className="pane">
                {order.tracking_number ? (
                  <div className="trk h-teal">
                    <span className="hold">
                      <Ic n="truck" />
                    </span>
                    <div>
                      <small>{t("trackingOf", { carrier: assignedCarrierName ?? "—" })}</small>
                      <b>{order.tracking_number}</b>
                    </div>
                    <button type="button" className="mini" onClick={() => void copyTracking()} aria-label={t("copyTracking")}>
                      <Ic n="copy" />
                    </button>
                  </div>
                ) : (
                  <div className="reco h-teal">
                    <span className="hold">
                      <Ic n="truck" />
                    </span>
                    <div>
                      <b>{t("notAtCarrier")}</b>
                      <small>{cityMissing ? t("recoNoCity") : t("trackingPending")}</small>
                    </div>
                  </div>
                )}
                <TrackingBarcode
                  value={order.tracking_number}
                  onDelete={canDeleteCarrierBarcode ? handleDeleteCarrierBarcode : undefined}
                />
                {/* Ordra's own reading of the parcel's progress first; the
                    carrier blocks below say what the carrier portal last said. */}
                <TrackingSection orderId={order.id} status={order.status} marketId={order.market_id} />
                <DexpressStatusSection orderId={order.id} enabled={dexpressEligible} role={role} />
                <DarbStatusSection orderId={order.id} enabled={darbEligible} />
              </div>

              <div role="tabpanel" hidden={tab !== "history"} className="pane">
                <HistoryTimeline entries={order.history} historyLocale={locale === "ar" ? "ar" : "fr"} />
              </div>

              {whatsappKnown && (
                <div role="tabpanel" hidden={tab !== "messages"} className="pane msgs">
                  <div className="odp-thread">
                    <MessageThread
                      messages={whatsappThread.thread?.messages ?? []}
                      conversation={whatsappThread.thread?.conversation ?? null}
                      onRetry={whatsappActive ? (m) => void whatsappThread.retry(m) : undefined}
                    />
                  </div>
                  <WhatsAppComposer
                    className="sticky bottom-0"
                    target={{ order_id: order.id }}
                    thread={whatsappThread.thread}
                    loadError={Boolean(whatsappThread.error)}
                    fallbackHref={whatsappFallbackHref}
                    templates={whatsappTemplates}
                    variables={resolveOrderVariables({
                      order_number: order.external_id,
                      customer_name: order.customer_name,
                      customer_address: order.customer_address,
                      customer_city: order.customer_city,
                      product_name: order.product_name,
                      total_price: order.total_price,
                      currency: displayCurrency,
                      tracking_number: order.tracking_number,
                      carrier_name: assignedCarrierName,
                      agent_name: order.assigned_agent_name ?? null,
                    })}
                    defaultLanguage={isLibyaOrder ? "ar" : "fr"}
                    templateSet="agent"
                    onThreadChanged={() => void whatsappThread.mutate()}
                    onCall={() => {
                      window.location.href = `tel:${order.customer_phone}`;
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Notices sit directly above the buttons they are about. */}
          {order && (
            <AlertBanners
              notes={notes}
              extra={extraNotes}
              marketId={order.market_id}
              callbackScheduledAt={order.callback_scheduled_at}
              dispatchScheduledAt={order.scheduled_dispatch_at}
              dispatchScheduledAuto={order.scheduled_dispatch_auto ?? false}
            />
          )}

          {order && (
            <ActionFooter
              actions={panelActions}
              primaryPending={reopening || returningToPool || cancelingSchedule || recovering}
              onInvoke={invokeAction}
              showNavHint={variant === "side"}
              feedbackHint={feedback.enabled}
            />
          )}
        </aside>
      </div>

      {scheduleDispatchOpen && order && (
        <ScheduleDispatchModal
          orderId={order.id}
          marketId={order.market_id}
          destinationKey={orderDestinationKey}
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
        <div className="px-5 pb-3 flex flex-col gap-2" role="radiogroup" aria-label={t("uploadCarrierPickTitle")}>
          {activeCarriers.length === 0 ? (
            <p className="text-[13px] text-ink-secondary py-2">
              {t("uploadCarrierNoActive")}
            </p>
          ) : (
            activeCarriers.map((c) => {
              const cov = coverageForCode(c.code);
              const blocked = cov === "uncovered";
              const city = order?.customer_city ?? "";
              const row = comparisonByCarrierId[c.id];
              return (
                <div key={c.id}>
                  <CarrierComparisonCard
                    name={c.name}
                    code={c.code}
                    // This picker dispatches on click rather than holding a
                    // selection, so the only "selected" state is the row
                    // currently uploading.
                    selected={uploadingCarrierId === c.id}
                    blocked={blocked || uploadingCarrierId !== null}
                    isBestChoice={row?.isBestChoice ?? false}
                    cost={row?.cost ?? null}
                    deliveryRate={row?.deliveryRate ?? null}
                    transitHours={row?.transitHours ?? null}
                    marketId={order?.market_id}
                    onSelect={() => {
                      if (blocked || uploadingCarrierId !== null) return;
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
                  />
                  {blocked && (
                    <p className="mt-1 px-1 text-[11px] text-status-critical">
                      {tCov("notCovered", { city })}
                    </p>
                  )}
                  {uploadingCarrierId === c.id && (
                    <p className="mt-1 px-1 text-[11px] text-ink-secondary">
                      {t("uploadingToCarrier")}
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
          totalPrice={order.total_price}
          darbDestinationId={order.darb_destination_id ?? null}
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

      {/* Same customer, another product, ordered separately — one parcel
          instead of two. The panel resolves the market's merge window itself
          and closes with `enabled: false` where merging is switched off. */}
      {order && (
        <MergeOrderPanel
          open={mergeOpen}
          onClose={() => setMergeOpen(false)}
          survivor={{
            id: order.id,
            external_id: order.external_id ?? null,
            customer_address: order.customer_address ?? null,
            customer_city: order.customer_city ?? null,
            delivery_fee: Number(order.delivery_fee ?? 0),
            card_payment: Boolean(order.card_payment),
            dexpress_state_id: order.dexpress_state_id ?? null,
            market_code: isLibyaOrder ? "ly" : "tn",
            items: orderItems.map((it) => ({
              quantity: it.quantity,
              unit_price: Number(it.unit_price ?? 0),
            })),
          }}
          locale={locale}
          currencyCode={displayCurrency}
          onMerged={() => {
            void mutate();
          }}
        />
      )}

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
        orderId={order?.id ?? null}
        customerName={order?.customer_name ?? null}
        whatsappActive={whatsappActive}
        whatsappKnown={whatsappKnown}
        customerOptedOut={Boolean(whatsappThread.thread?.conversation?.opted_out_at)}
        customerLanguage={whatsappThread.thread?.customer_language ?? (isLibyaOrder ? "ar" : "fr")}
        onWhatsAppSent={() => void whatsappThread.mutate()}
      />
    </TypingActivityProvider>
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
        // One of the two ways to change what was ordered (prototype .pane-acts).
        className="btn2"
      >
        <Ic n="plus" />
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
