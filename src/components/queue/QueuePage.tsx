"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Phone, X } from "lucide-react";
import { useAuth } from "@/context/auth";
import {
  QueueHeader,
  type BucketKey,
  type EnCoursSubfilter,
  type TentativeSubfilter,
} from "./QueueHeader";
import { QueueList } from "./QueueList";
import { useAgentQueue } from "@/hooks/useAgentQueue";
import { isEditableTarget } from "@/lib/dom";
import { AGENT_NEW_ORDER_EVENT } from "@/lib/agent-events";
import type { QueueOrder } from "@/types/queue";

const OrderDetailPanel = dynamic(() =>
  import("./OrderDetailPanel").then((m) => m.OrderDetailPanel), { ssr: false }
);
const PostCallActionSheet = dynamic(() =>
  import("./PostCallActionSheet").then((m) => m.PostCallActionSheet), { ssr: false }
);
const ShortcutsOverlay = dynamic(() =>
  import("./ShortcutsOverlay").then((m) => m.ShortcutsOverlay), { ssr: false }
);
const CreateOrderModal = dynamic(() =>
  import("@/components/orders/CreateOrderModal").then((m) => m.CreateOrderModal), { ssr: false }
);

type Flow =
  | "option_select"
  | "reject_flow"
  | "callback_expanded";

const jsonFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

function toQueueOrder(raw: Record<string, unknown>): QueueOrder {
  return {
    id: raw.id as string,
    status: raw.status as string,
    customer_name: (raw.customer_name as string) ?? "",
    customer_phone: (raw.customer_phone as string) ?? "",
    customer_address: (raw.customer_address as string | null) ?? null,
    customer_city: (raw.customer_city as string) ?? "",
    product_name: (raw.product_name as string) ?? "",
    variant_label: (raw.variant_label as string) ?? "",
    total_price: (raw.total_price as number) ?? 0,
    currency: (raw.currency as string) ?? "TND",
    attempt_count: (raw.attempts_count as number) ?? (raw.attempt_count as number) ?? 0,
    callback_time: (raw.callback_scheduled_at as string | null) ?? null,
    scheduled_dispatch_at: (raw.scheduled_dispatch_at as string | null) ?? null,
    scheduled_dispatch_auto: Boolean(raw.scheduled_dispatch_auto),
    customer_note: (raw.customer_note as string | null) ?? null,
    customer_phone_2: (raw.customer_phone_2 as string | null) ?? null,
    created_at: raw.created_at as string,
    assigned_at: (raw.assigned_at as string) ?? (raw.created_at as string),
    repeat_kind: (raw.repeat_kind as QueueOrder["repeat_kind"]) ?? "none",
    prior_order_count: (raw.prior_order_count as number) ?? 0,
    prior_lead_count: (raw.prior_lead_count as number) ?? 0,
    prior_rejected_count: (raw.prior_rejected_count as number) ?? 0,
    last_known_address: (raw.last_known_address as string | null) ?? null,
  };
}

const VALID_BUCKETS: BucketKey[] = [
  "nouveau",
  "en_cours",
  "confirme",
  "fermees",
];

// Old deep-links (?bucket=a_rappeler, ?bucket=planifie, ?bucket=tentative, ?bucket=rappel_prevu)
// land on the merged en_cours tab so existing bookmarks still work.
const LEGACY_BUCKET_MAP: Record<string, BucketKey> = {
  a_rappeler: "en_cours",
  planifie: "en_cours",
  all: "en_cours",
  tentative: "en_cours",
  rappel_prevu: "en_cours",
};

function resolveBucketParam(raw: string | null): BucketKey {
  if (!raw) return "en_cours";
  if ((VALID_BUCKETS as string[]).includes(raw)) return raw as BucketKey;
  return LEGACY_BUCKET_MAP[raw] ?? "en_cours";
}

function bucketForStatus(status: string): BucketKey | null {
  if (status === "pending" || status === "assigned") return "nouveau";
  if (
    status === "attempt_1" ||
    status === "attempt_2" ||
    status === "attempt_3" ||
    status === "callback_scheduled" ||
    status === "dispatch_scheduled"
  ) {
    return "en_cours";
  }
  if (status === "confirmed") return "confirme";
  return null;
}

function attemptNumberForStatus(status: string): 1 | 2 | 3 | null {
  if (status === "attempt_1") return 1;
  if (status === "attempt_2") return 2;
  if (status === "attempt_3") return 3;
  return null;
}

function matchesEnCoursSubfilter(
  status: string,
  sub: EnCoursSubfilter,
): boolean {
  if (sub === "all") return true;
  if (sub === "rappel") return status === "callback_scheduled";
  if (sub === "livraison") return status === "dispatch_scheduled";
  if (sub === "tentative") return attemptNumberForStatus(status) !== null;
  return false;
}

function matchesTentativeSubfilter(
  status: string,
  sub: TentativeSubfilter,
): boolean {
  if (sub === "all") return true;
  return attemptNumberForStatus(status) === sub;
}

export function QueuePage() {
  const t = useTranslations("queue");
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { orders: rawOrders, allOrders: rawAllOrders, closedOrders: rawClosedOrders, buckets, error, mutate } = useAgentQueue();

  // Warm the dropdown caches before the user opens a panel — the detail panel
  // reads these SWR keys; by the time it mounts, they're already resolved.
  useSWR("/api/products/search", jsonFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
  });
  useSWR("/api/cities", jsonFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
  });

  // Preload the panel's JS chunk so the first click doesn't pay the download.
  useEffect(() => {
    import("./OrderDetailPanel");
    import("./PostCallActionSheet");
  }, []);

  // Tabs live entirely in local state for instant switching. URL is read once
  // on mount to support deep-links (e.g. /fr/queue?bucket=nouveau), then
  // ignored — tab clicks never touch the router.
  const [selectedBucket, setSelectedBucket] = useState<BucketKey>(() =>
    resolveBucketParam(searchParams.get("bucket")),
  );
  const [enCoursSubfilter, setEnCoursSubfilter] = useState<EnCoursSubfilter>(() => {
    const s = searchParams.get("sub");
    if (s === "rappel") return "rappel";
    if (s === "livraison") return "livraison";
    if (s === "tentative" || s === "t1" || s === "t2" || s === "t3") return "tentative";
    return "all";
  });
  const [tentativeSubfilter, setTentativeSubfilter] = useState<TentativeSubfilter>(() => {
    const s = searchParams.get("sub");
    if (s === "t1") return 1;
    if (s === "t2") return 2;
    if (s === "t3") return 3;
    return "all";
  });

  // When user switches bucket, reset subfilters.
  const handleBucketChange = useCallback((bucket: BucketKey) => {
    setSelectedBucket(bucket);
    setEnCoursSubfilter("all");
    setTentativeSubfilter("all");
  }, []);

  // Picking a non-Tentative top-level chip clears the popover narrowing.
  const handleEnCoursSubfilterChange = useCallback((sub: EnCoursSubfilter) => {
    setEnCoursSubfilter(sub);
    if (sub !== "tentative") setTentativeSubfilter("all");
  }, []);

  const { data: statsData } = useSWR("/api/agent/stats", jsonFetcher, {
    refreshInterval: 30000,
  });

  const { data: settingsData } = useSWR("/api/agent/settings", jsonFetcher, {
    refreshInterval: 0,
  });

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [callTerminatedOrderId, setCallTerminatedOrderId] = useState<string | null>(null);
  const [initialFlow, setInitialFlow] = useState<Flow | undefined>(undefined);
  const [autoRejectedBanner, setAutoRejectedBanner] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkQueue, setBulkQueue] = useState<string[]>([]);

  // Track latest state for keyboard handler without re-binding on every keystroke
  const stateRef = useRef({
    orders: [] as QueueOrder[],
    focusedOrderId: null as string | null,
    selectedOrderId: null as string | null,
    callTerminatedOrderId: null as string | null,
    createOpen: false,
    shortcutsOpen: false,
  });

  // Auto-dismiss banner after 5s
  useEffect(() => {
    if (autoRejectedBanner) {
      const timer = setTimeout(() => setAutoRejectedBanner(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [autoRejectedBanner]);

  // Orders come pre-sorted from server — no client sort.
  const stableOrdersRef = useRef<QueueOrder[]>([]);
  const orders: QueueOrder[] = useMemo(() => {
    let next: QueueOrder[];
    if (selectedBucket === "fermees") {
      next = rawClosedOrders.map(toQueueOrder);
    } else {
      let filtered = rawAllOrders.filter((o) => {
        const bucket = bucketForStatus(o.status as string);
        return bucket === selectedBucket;
      });
      if (selectedBucket === "en_cours") {
        if (enCoursSubfilter !== "all") {
          filtered = filtered.filter((o) =>
            matchesEnCoursSubfilter(o.status as string, enCoursSubfilter),
          );
        }
        if (enCoursSubfilter === "tentative" && tentativeSubfilter !== "all") {
          filtered = filtered.filter((o) =>
            matchesTentativeSubfilter(o.status as string, tentativeSubfilter),
          );
        }
      }
      next = filtered.map(toQueueOrder);
    }
    // Preserve reference if length and first id are identical — avoids re-render on SWR poll when data unchanged
    const prev = stableOrdersRef.current;
    if (next.length === prev.length && next[0]?.id === prev[0]?.id && next[next.length - 1]?.id === prev[prev.length - 1]?.id) return prev;
    stableOrdersRef.current = next;
    return next;
  }, [selectedBucket, enCoursSubfilter, tentativeSubfilter, rawAllOrders, rawClosedOrders]);

  // Auto-focus first order if no focus set
  useEffect(() => {
    if (orders.length > 0 && focusedOrderId === null) {
      setFocusedOrderId(orders[0].id);
    }
    if (orders.length > 0 && focusedOrderId !== null && !orders.some((o) => o.id === focusedOrderId)) {
      setFocusedOrderId(orders[0].id);
    }
  }, [orders, focusedOrderId]);

  useEffect(() => {
    stateRef.current = {
      orders,
      focusedOrderId,
      selectedOrderId,
      callTerminatedOrderId,
      createOpen,
      shortcutsOpen,
    };
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const s = stateRef.current;
    if (s.createOpen) return;

    // "?" overlay toggle
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      setShortcutsOpen((v) => !v);
      return;
    }
    if (s.shortcutsOpen) return;

    // Post-call sheet shortcuts (1/2/3/4)
    if (s.callTerminatedOrderId) {
      if (e.key === "1") { e.preventDefault(); setInitialFlow("option_select"); return; }
      // "2" used to land on a separate confirm sub-screen; that screen was
      // collapsed into the main option_select when we made "Confirmé" fire
      // /confirm directly. The shortcut now just opens the same screen.
      if (e.key === "2") { e.preventDefault(); setInitialFlow("option_select"); return; }
      if (e.key === "3") { e.preventDefault(); setInitialFlow("reject_flow"); return; }
      if (e.key === "4") { e.preventDefault(); setInitialFlow("callback_expanded"); return; }
      return;
    }

    // Esc clears bulk selection (only when no panel/sheet is open)
    if (e.key === "Escape" && !s.selectedOrderId && !s.callTerminatedOrderId) {
      setSelectedOrderIds((prev) => (prev.size > 0 ? new Set() : prev));
    }

    // If a detail panel is open, let its Escape key handling apply
    if (s.selectedOrderId) return;

    if (s.orders.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      const idx = s.orders.findIndex((o) => o.id === s.focusedOrderId);
      const next = s.orders[Math.min(idx + 1, s.orders.length - 1)] ?? s.orders[0];
      setFocusedOrderId(next.id);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      const idx = s.orders.findIndex((o) => o.id === s.focusedOrderId);
      const prev = s.orders[Math.max(idx - 1, 0)] ?? s.orders[0];
      setFocusedOrderId(prev.id);
      return;
    }
    if (e.key === "Enter") {
      if (s.focusedOrderId) {
        e.preventDefault();
        setInitialFlow(undefined);
        setCallTerminatedOrderId(s.focusedOrderId);
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Sidebar "New Order" button dispatches a window event we listen for.
  useEffect(() => {
    const open = () => setCreateOpen(true);
    window.addEventListener(AGENT_NEW_ORDER_EVENT, open);
    return () => window.removeEventListener(AGENT_NEW_ORDER_EVENT, open);
  }, []);

  const stats = {
    assigned_count: (statsData?.assigned_today as number) ?? 0,
    actioned_count: (statsData?.actioned_today as number) ?? 0,
    confirmation_rate: (statsData?.confirmation_rate as number) ?? 0,
  };

  const maxAttempts: number = (settingsData?.max_call_attempts as number) ?? 3;

  // Snapshot of the order shown by the action sheet. We keep our own copy so
  // the sheet keeps rendering even after the queue list updates and the
  // order falls out of the visible bucket (e.g. after /confirm flips status
  // pending → confirmed and the agent is on the "nouveau" tab).
  const [activeOrderSnapshot, setActiveOrderSnapshot] =
    useState<QueueOrder | null>(null);

  const handleCallTerminated = useCallback(
    (id: string) => {
      setInitialFlow(undefined);
      setCallTerminatedOrderId(id);
      // Try to populate the snapshot from the live list. This runs in the
      // same tick as setCallTerminatedOrderId, so by the time the sheet
      // mounts, both pieces of state are set.
      const fromAll =
        rawAllOrders.find((o) => o.id === id) ??
        rawClosedOrders.find((o) => o.id === id) ??
        null;
      if (fromAll) {
        setActiveOrderSnapshot(toQueueOrder(fromAll));
      }
    },
    [rawAllOrders, rawClosedOrders],
  );

  const handleRefresh = useCallback(() => mutate(), [mutate]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleDeselectAll = useCallback(() => setSelectedOrderIds(new Set()), []);

  const handleBulkCallEnded = useCallback(() => {
    const ids = [...selectedOrderIds];
    if (ids.length === 0) return;
    const [first, ...rest] = ids;
    setBulkQueue(rest);
    setSelectedOrderIds(new Set());
    handleCallTerminated(first);
  }, [selectedOrderIds, handleCallTerminated]);

  // ── loading skeleton ─────────────────────────────────────
  if (!rawOrders.length && !error && !statsData) {
    return (
      <div className="bg-surface-page min-h-screen">
        <div className="bg-surface-card border-b border-line-subtle px-6 py-4">
          <div className="text-[14px] text-ink-secondary">{t("loading")}</div>
        </div>
      </div>
    );
  }

  // ── error state ───────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-surface-page min-h-screen flex items-center justify-center text-[14px] text-ink-secondary">
        {t("loadingRetry")}
      </div>
    );
  }

  // Look up the live order in the unfiltered list first (so we always have
  // the freshest data while the sheet is open), but fall back to the
  // snapshot taken when the sheet opened — that way the sheet doesn't
  // unmount mid-flow when the order's status flips out of the visible bucket.
  const activeOrder: QueueOrder | null = callTerminatedOrderId
    ? (() => {
        const live =
          rawAllOrders.find((o) => o.id === callTerminatedOrderId) ??
          rawClosedOrders.find((o) => o.id === callTerminatedOrderId);
        return live ? toQueueOrder(live) : activeOrderSnapshot;
      })()
    : null;

  return (
    <div className="bg-surface-page min-h-screen">
      <QueueHeader
        agentName={user?.full_name ?? ""}
        stats={stats}
        buckets={buckets}
        selectedBucket={selectedBucket}
        onBucketChange={handleBucketChange}
        enCoursSubfilter={enCoursSubfilter}
        onEnCoursSubfilterChange={handleEnCoursSubfilterChange}
        tentativeSubfilter={tentativeSubfilter}
        onTentativeSubfilterChange={setTentativeSubfilter}
        onNewOrder={() => setCreateOpen(true)}
      />

      <CreateOrderModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        role="agent"
        userMarketId={user?.market_id ?? ""}
        onCreated={() => mutate()}
      />

      {/* Auto-rejected banner */}
      {autoRejectedBanner && (
        <div className="bg-status-criticalBg border-y border-status-critical/20 text-status-critical text-[14px] px-6 py-2.5 flex items-center justify-between">
          <span>{t("autoRejectedBanner")}</span>
          <button
            type="button"
            onClick={() => setAutoRejectedBanner(false)}
            className="ms-3 text-[16px] leading-none text-status-critical hover:opacity-70 transition-opacity duration-fast"
            aria-label={t("dismiss")}
          >
            ×
          </button>
        </div>
      )}

      <QueueList
        orders={orders}
        onOpenDetail={setSelectedOrderId}
        onCallTerminated={handleCallTerminated}
        onRefresh={handleRefresh}
        stats={stats}
        focusedOrderId={focusedOrderId}
        selectedOrderIds={selectedOrderIds}
        onToggleSelect={handleToggleSelect}
      />

      <OrderDetailPanel
        key={selectedOrderId ?? "none"}
        orderId={selectedOrderId}
        fallbackOrder={
          selectedOrderId
            ? rawAllOrders.find((o) => o.id === selectedOrderId) ??
              rawClosedOrders.find((o) => o.id === selectedOrderId) ??
              null
            : null
        }
        onClose={() => setSelectedOrderId(null)}
        onCallTerminated={(id) => {
          setSelectedOrderId(null);
          setInitialFlow(undefined);
          setCallTerminatedOrderId(id);
        }}
        userId={user?.id ?? undefined}
        onReopened={() => {
          mutate();
          setSelectedOrderId(null);
        }}
      />

      {callTerminatedOrderId && activeOrder && (
        <PostCallActionSheet
          orderId={callTerminatedOrderId}
          orderStatus={activeOrder.status}
          marketId={user?.market_id ?? ""}
          maxAttempts={maxAttempts}
          attemptsCount={activeOrder.attempt_count}
          initialFlow={initialFlow}
          onClose={() => {
            setCallTerminatedOrderId(null);
            setActiveOrderSnapshot(null);
            setInitialFlow(undefined);
          }}
          onSuccess={(result) => {
            mutate();
            setCallTerminatedOrderId(null);
            setActiveOrderSnapshot(null);
            setInitialFlow(undefined);
            if (result.autoRejected) setAutoRejectedBanner(true);
            // Continue bulk queue
            if (bulkQueue.length > 0) {
              const [next, ...rest] = bulkQueue;
              setBulkQueue(rest);
              handleCallTerminated(next);
            }
          }}
        />
      )}

      {/* Bulk selection floating action bar — Shopify-style light surface */}
      {selectedOrderIds.size > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="fixed bottom-6 inset-x-0 z-30 flex justify-center px-4 pointer-events-none animate-[fadeInUp_120ms_ease-out]"
        >
          <div
            className="pointer-events-auto inline-flex items-stretch overflow-hidden bg-surface-card border border-line-subtle rounded-card shadow-floating"
          >
            {/* Selection count chip with accent rail */}
            <div className="flex items-center gap-2.5 ps-4 pe-3 py-2.5 border-e border-line-subtle relative">
              <span aria-hidden="true" className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-accent" />
              <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-pill bg-accent/10 text-accent text-[12px] font-bold tabular-nums">
                {selectedOrderIds.size}
              </span>
              <span className="text-[13px] font-medium text-ink-primary whitespace-nowrap">
                {t(selectedOrderIds.size > 1 ? "bulkSelectedCountPlural" : "bulkSelectedCount", { count: String(selectedOrderIds.size) })}
              </span>
            </div>

            {/* Primary action */}
            <button
              type="button"
              onClick={handleBulkCallEnded}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-ink-primary hover:bg-surface-hover transition-colors duration-fast border-e border-line-subtle"
            >
              <Phone size={14} strokeWidth={2.25} aria-hidden="true" />
              <span>{t("bulkStartCalls")}</span>
            </button>

            {/* Esc hint */}
            <div className="hidden md:flex items-center gap-1.5 px-3 text-[11px] text-ink-muted border-e border-line-subtle">
              <kbd className="inline-flex items-center justify-center min-w-[24px] h-[18px] px-1 rounded border border-line-subtle bg-surface-page text-[10px] font-medium text-ink-secondary">Esc</kbd>
              <span>{t("bulkEscHint")}</span>
            </div>

            {/* Clear */}
            <button
              type="button"
              onClick={handleDeselectAll}
              aria-label={t("deselectAll")}
              className="inline-flex items-center justify-center px-3 py-2.5 text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
