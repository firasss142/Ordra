"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/context/auth";
import {
  QueueHeader,
  type BucketKey,
  type AttemptSubfilter,
  type PlanifieSubfilter,
} from "./QueueHeader";
import { QueueList } from "./QueueList";
import { useAgentQueue } from "@/hooks/useAgentQueue";
import { isEditableTarget } from "@/lib/dom";
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
  | "confirm_flow"
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
  };
}

const VALID_BUCKETS: BucketKey[] = [
  "nouveau",
  "a_rappeler",
  "planifie",
  "confirme",
  "fermees",
];

const LEGACY_BUCKET_MAP: Record<string, BucketKey> = {
  all: "a_rappeler",
  tentative: "a_rappeler",
  rappel_prevu: "planifie",
};

function resolveBucketParam(raw: string | null): BucketKey {
  if (!raw) return "a_rappeler";
  if ((VALID_BUCKETS as string[]).includes(raw)) return raw as BucketKey;
  return LEGACY_BUCKET_MAP[raw] ?? "a_rappeler";
}

function bucketForStatus(status: string): BucketKey | null {
  if (status === "assigned") return "nouveau";
  if (
    status === "attempt_1" ||
    status === "attempt_2" ||
    status === "attempt_3"
  ) {
    return "a_rappeler";
  }
  if (status === "callback_scheduled" || status === "dispatch_scheduled") {
    return "planifie";
  }
  if (status === "confirmed") return "confirme";
  return null;
}

function attemptNumberForStatus(status: string, attemptsCount: number): 1 | 2 | 3 | null {
  if (status === "attempt_1") return 1;
  if (status === "attempt_2") return 2;
  if (status === "attempt_3") return 3;
  if (status === "callback_scheduled" && attemptsCount > 0) {
    return (Math.min(attemptsCount, 3) as 1 | 2 | 3);
  }
  return null;
}

function matchesSubfilter(
  status: string,
  attemptsCount: number,
  sub: AttemptSubfilter,
): boolean {
  if (sub === "all") return true;
  return attemptNumberForStatus(status, attemptsCount) === sub;
}

function matchesPlanifieSubfilter(
  status: string,
  sub: PlanifieSubfilter,
): boolean {
  if (sub === "all") return true;
  if (sub === "rappel") return status === "callback_scheduled";
  if (sub === "livraison") return status === "dispatch_scheduled";
  return false;
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
  const [attemptSubfilter, setAttemptSubfilterUrl] = useState<AttemptSubfilter>(() => {
    const s = searchParams.get("sub");
    if (s === "t1") return 1;
    if (s === "t2") return 2;
    if (s === "t3") return 3;
    return "all";
  });
  const [planifieSubfilter, setPlanifieSubfilter] = useState<PlanifieSubfilter>(
    () => {
      const s = searchParams.get("sub");
      if (s === "rappel") return "rappel";
      if (s === "livraison") return "livraison";
      return "all";
    },
  );

  // When user switches bucket, reset subfilters.
  const handleBucketChange = useCallback((bucket: BucketKey) => {
    setSelectedBucket(bucket);
    setAttemptSubfilterUrl("all");
    setPlanifieSubfilter("all");
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
      if (selectedBucket === "a_rappeler" && attemptSubfilter !== "all") {
        filtered = filtered.filter((o) =>
          matchesSubfilter(
            o.status as string,
            (o.attempts_count as number) ?? 0,
            attemptSubfilter,
          ),
        );
      }
      if (selectedBucket === "planifie" && planifieSubfilter !== "all") {
        filtered = filtered.filter((o) =>
          matchesPlanifieSubfilter(o.status as string, planifieSubfilter),
        );
      }
      next = filtered.map(toQueueOrder);
    }
    // Preserve reference if length and first id are identical — avoids re-render on SWR poll when data unchanged
    const prev = stableOrdersRef.current;
    if (next.length === prev.length && next[0]?.id === prev[0]?.id && next[next.length - 1]?.id === prev[prev.length - 1]?.id) return prev;
    stableOrdersRef.current = next;
    return next;
  }, [selectedBucket, attemptSubfilter, planifieSubfilter, rawAllOrders, rawClosedOrders]);

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
      if (e.key === "2") { e.preventDefault(); setInitialFlow("confirm_flow"); return; }
      if (e.key === "3") { e.preventDefault(); setInitialFlow("reject_flow"); return; }
      if (e.key === "4") { e.preventDefault(); setInitialFlow("callback_expanded"); return; }
      return;
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

  const stats = {
    assigned_count: (statsData?.assigned_today as number) ?? 0,
    actioned_count: (statsData?.actioned_today as number) ?? 0,
    confirmation_rate: (statsData?.confirmation_rate as number) ?? 0,
  };

  const maxAttempts: number = (settingsData?.max_call_attempts as number) ?? 3;

  const handleCallTerminated = useCallback((id: string) => {
    setInitialFlow(undefined);
    setCallTerminatedOrderId(id);
  }, []);

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
      <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid #E1E3E5",
            backgroundColor: "#FFFFFF",
          }}
        >
          <div style={{ fontSize: 14, color: "#6B7280" }}>{t("loading")}</div>
        </div>
      </div>
    );
  }

  // ── error state ───────────────────────────────────────────
  if (error) {
    return (
      <div
        style={{
          backgroundColor: "#F6F6F7",
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: 14,
          color: "#6B7280",
        }}
      >
        {t("loadingRetry")}
      </div>
    );
  }

  const activeOrder = callTerminatedOrderId
    ? orders.find((o) => o.id === callTerminatedOrderId) ?? null
    : null;

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <QueueHeader
        agentName={user?.full_name ?? ""}
        stats={stats}
        buckets={buckets}
        selectedBucket={selectedBucket}
        onBucketChange={handleBucketChange}
        attemptSubfilter={attemptSubfilter}
        onAttemptSubfilterChange={setAttemptSubfilterUrl}
        planifieSubfilter={planifieSubfilter}
        onPlanifieSubfilterChange={setPlanifieSubfilter}
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
        <div
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#DC2626",
            fontSize: 14,
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            Une commande a été rejetée automatiquement (injoignable).
          </span>
          <button
            style={{
              background: "none",
              border: "none",
              fontSize: 16,
              color: "#DC2626",
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 0 0 12px",
            }}
            onClick={() => setAutoRejectedBanner(false)}
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
            setInitialFlow(undefined);
          }}
          onSuccess={(result) => {
            mutate();
            setCallTerminatedOrderId(null);
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

      {/* Bulk selection floating action bar */}
      {selectedOrderIds.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#1A1A1A",
            color: "#FFFFFF",
            borderRadius: 8,
            padding: "12px 20px",
            display: "flex",
            gap: 12,
            alignItems: "center",
            zIndex: 30,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          <button
            onClick={handleBulkCallEnded}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#FFFFFF",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {t("bulkCallEnded", { count: String(selectedOrderIds.size) })}
          </button>
          <button
            onClick={handleDeselectAll}
            style={{
              fontSize: 13,
              color: "#FFFFFF",
              background: "none",
              border: "1px solid #555",
              borderRadius: 4,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            {t("deselectAll")}
          </button>
        </div>
      )}

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
