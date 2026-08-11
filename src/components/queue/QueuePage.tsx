"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Phone, X } from "lucide-react";
import { useAuth } from "@/context/auth";
import {
  QueueHeader,
  type BucketKey,
  type ClosedSubfilter,
  type EnCoursSubfilter,
  type TentativeSubfilter,
} from "./QueueHeader";
import { QueueList } from "./QueueList";
import { pushRecentSearch } from "./QueueSearchBar";
import { useAgentQueue } from "@/hooks/useAgentQueue";
import { useToast } from "@/components/ui/Toast";
import { sortAgentQueue } from "@/lib/orders/queue-sort";
import { useDebounce } from "@/hooks/useDebounce";
import { useQueueSearch } from "@/context/queue-search";
import { isEditableTarget } from "@/lib/dom";
import { AGENT_NEW_ORDER_EVENT } from "@/lib/agent-events";
import { parseQuery, searchOrders } from "@/lib/queue/search";
import { enCoursBucket } from "@/lib/queue/schedule-bucket";
import { isBulkCallEligible } from "@/lib/order-permissions";
import type { QueueOrder } from "@/types/queue";
import { NO_SIBLINGS, sameQueueOrders } from "@/lib/agent-queue/stable-orders";
import { bucketFor, type Bucket } from "@/lib/carriers/buckets";

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

/**
 * The single gate between the wire and QueueOrder. Anything not mapped here is
 * invisible to QueueList / OrderCard / QueueStatusPill, however faithfully the
 * server sent it — so a missing key is a silent, permanent data loss rather
 * than a crash. Exported for the key-coverage test that guards exactly that.
 */
export function toQueueOrder(raw: Record<string, unknown>): QueueOrder {
  return {
    id: raw.id as string,
    status: raw.status as string,
    customer_name: (raw.customer_name as string) ?? "",
    customer_phone: (raw.customer_phone as string) ?? "",
    customer_address: (raw.customer_address as string | null) ?? null,
    customer_city: (raw.customer_city as string) ?? "",
    product_name: (raw.product_name as string) ?? "",
    // The catalog name the route resolved from products.name. OrderCard reads
    // `product_display_name || product_name`, so omitting this made the || fall
    // through to the raw storefront SKU on every row — while every manager
    // surface showed the resolved name for the same order.
    product_display_name: (raw.product_display_name as string | null) ?? null,
    variant_label: (raw.variant_label as string) ?? "",
    quantity: (raw.quantity as number) ?? 1,
    product_image_url: (raw.product_image_url as string | null) ?? null,
    carrier_id: (raw.carrier_id as string | null) ?? null,
    carrier_code: (raw.carrier_code as string | null) ?? null,
    carrier_name: (raw.carrier_name as string | null) ?? null,
    total_price: (raw.total_price as number) ?? 0,
    currency: (raw.currency as string) ?? "TND",
    market_id: (raw.market_id as string | null) ?? null,
    attempt_count: (raw.attempts_count as number) ?? (raw.attempt_count as number) ?? 0,
    callback_time: (raw.callback_scheduled_at as string | null) ?? null,
    scheduled_dispatch_at: (raw.scheduled_dispatch_at as string | null) ?? null,
    scheduled_dispatch_auto: Boolean(raw.scheduled_dispatch_auto),
    customer_note: (raw.customer_note as string | null) ?? null,
    customer_phone_2: (raw.customer_phone_2 as string | null) ?? null,
    created_at: raw.created_at as string,
    assigned_at: (raw.assigned_at as string) ?? (raw.created_at as string),
    last_action_at: (raw.last_action_at as string | null) ?? null,
    repeat_kind: (raw.repeat_kind as QueueOrder["repeat_kind"]) ?? "none",
    prior_order_count: (raw.prior_order_count as number) ?? 0,
    prior_lead_count: (raw.prior_lead_count as number) ?? 0,
    prior_rejected_count: (raw.prior_rejected_count as number) ?? 0,
    last_known_address: (raw.last_known_address as string | null) ?? null,
    rejection_reason: (raw.rejection_reason as string | null) ?? null,
    rejection_subreason: (raw.rejection_subreason as string | null) ?? null,
    rejection_note: (raw.rejection_note as string | null) ?? null,
    is_potential_duplicate: Boolean(raw.is_potential_duplicate),
    duplicate_count: (raw.duplicate_count as number) ?? 0,
    // NO_SIBLINGS rather than a fresh []: a new array each pass would make
    // sameQueueOrders report a change on every single row, every render.
    duplicate_siblings:
      (raw.duplicate_siblings as QueueOrder["duplicate_siblings"]) ?? NO_SIBLINGS,
    has_uploaded_sibling: Boolean(raw.has_uploaded_sibling),
    is_duplicate_anchor: Boolean(raw.is_duplicate_anchor),
    tracking_number: (raw.tracking_number as string | null) ?? null,
    carrier_barcode_deleted_at:
      (raw.carrier_barcode_deleted_at as string | null) ?? null,
    dexpress_status_slug: (raw.dexpress_status_slug as string | null) ?? null,
    dexpress_status_synced_at:
      (raw.dexpress_status_synced_at as string | null) ?? null,
    dexpress_status_accepted:
      typeof raw.dexpress_status_accepted === "boolean"
        ? (raw.dexpress_status_accepted as boolean)
        : null,
    carrier_status_slug: (raw.carrier_status_slug as string | null) ?? null,
    carrier_status_synced_at:
      (raw.carrier_status_synced_at as string | null) ?? null,
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

const REASSIGNMENT_TOAST_KEY = {
  reassigned: "reassignedAway",
  cancelled: "cancelledByManager",
  deleted: "deletedByManager",
} as const;

function resolveBucketParam(raw: string | null): BucketKey {
  if (!raw) return "nouveau";
  if ((VALID_BUCKETS as string[]).includes(raw)) return raw as BucketKey;
  return LEGACY_BUCKET_MAP[raw] ?? "nouveau";
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

/**
 * The sub-filter predicate and the bucket resolver above must agree, or an
 * order renders under "Tous" and matches no chip. They disagreed: this function
 * used to reject an explicitly-future time while `bucketForStatus` accepted it,
 * so anything scheduled for tomorrow fell through every sub-tab. Both sides now
 * defer to `lib/queue/schedule-bucket`, which is tested to partition the whole
 * en-cours set.
 */
function matchesEnCoursSubfilter(
  o: Record<string, unknown>,
  sub: EnCoursSubfilter,
  nowMs: number,
): boolean {
  if (sub === "all") return true;
  return (
    enCoursBucket(
      {
        status: o.status as string,
        callback_scheduled_at: o.callback_scheduled_at as string | null,
        scheduled_dispatch_at: o.scheduled_dispatch_at as string | null,
        scheduled_dispatch_auto: o.scheduled_dispatch_auto as boolean | null,
      },
      nowMs,
    ) === sub
  );
}

function matchesTentativeSubfilter(
  status: string,
  sub: TentativeSubfilter,
): boolean {
  if (sub === "all") return true;
  return attemptNumberForStatus(status) === sub;
}

function bucketForClosed(o: Record<string, unknown>): Bucket | null {
  return bucketFor({
    status: o.status as string,
    carrierCode: (o.carrier_code as string | null) ?? null,
    dexpressStatusSlug: (o.dexpress_status_slug as string | null) ?? null,
    dexpressStatusAccepted:
      typeof o.dexpress_status_accepted === "boolean"
        ? (o.dexpress_status_accepted as boolean)
        : null,
    carrierStatusSlug: (o.carrier_status_slug as string | null) ?? null,
  });
}

function matchesClosedSubfilter(
  o: Record<string, unknown>,
  sub: ClosedSubfilter,
): boolean {
  if (sub === "all") return true;
  return bucketForClosed(o) === sub;
}

export function QueuePage() {
  const t = useTranslations("queue");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const {
    orders: rawOrders,
    allOrders: rawAllOrdersUnsorted,
    closedOrders: rawClosedOrders,
    buckets,
    error,
    mutate,
    reassignmentEvent,
    acknowledgeReassignmentEvent,
    tick,
  } = useAgentQueue({
    agentId: user?.id ?? null,
    marketId: user?.market_id ?? null,
  });

  // Re-sort the active queue every 60s (or immediately when the tab becomes
  // visible) so a callback whose time just passed jumps to the top without
  // waiting for a server poll.
  const rawAllOrders = useMemo(() => {
    const sorted = sortAgentQueue(
      rawAllOrdersUnsorted as Array<
        Record<string, unknown> & {
          status: string;
          callback_scheduled_at: string | null;
          created_at: string;
        }
      >,
    );
    return sorted as Record<string, unknown>[];
    // tick intentionally included so this re-runs each 60s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAllOrdersUnsorted, tick]);

  // App-launch Darb sweep: fire the market-wide, server-throttled Darb status
  // sync ONCE per mount, then revalidate the queue so fresh slugs/statuses flow
  // in. The server's claim_darb_sync throttles to one carrier sweep per market
  // per 10 min, so multiple mounts/refreshes don't hammer the carrier. Fire-and-
  // forget: failures are non-fatal (the queue still renders cached data).
  const launchSyncedRef = useRef(false);
  useEffect(() => {
    if (launchSyncedRef.current) return;
    launchSyncedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/darb-assabil/sync-market", { method: "POST" });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { skipped?: boolean } | null;
        // Only revalidate if the sweep actually ran (skipped=false) — a throttled
        // skip wrote nothing, so there's nothing new to pull.
        if (body && body.skipped === false) await mutate();
      } catch {
        // non-fatal
      }
    })();
  }, [mutate]);

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
  const [closedSubfilter, setClosedSubfilter] = useState<ClosedSubfilter>("all");
  const [refreshingDexpress, setRefreshingDexpress] = useState(false);

  // Global search across all buckets. The query lives in QueueSearchContext so
  // the navbar search bar (rendered in the Topbar) and this page share it. The
  // query is debounced so filtering only runs once the agent pauses typing.
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    setResultCount,
    inputRef: searchInputRef,
  } = useQueueSearch();
  const debouncedSearch = useDebounce(searchQuery, 200);
  const isSearching = debouncedSearch.trim().length > 0;

  // Persist committed searches once typing settles (≥2 chars).
  useEffect(() => {
    if (debouncedSearch.trim().length >= 2) pushRecentSearch(debouncedSearch);
  }, [debouncedSearch]);

  // When user switches bucket, reset subfilters and clear any active search.
  const handleBucketChange = useCallback((bucket: BucketKey) => {
    setSelectedBucket(bucket);
    setEnCoursSubfilter("all");
    setTentativeSubfilter("all");
    setClosedSubfilter("all");
    setSearchQuery("");
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

  const toast = useToast();
  const tToast = useTranslations("queue.realtime.toast");
  useEffect(() => {
    if (!reassignmentEvent) return;
    const { orderId, kind } = reassignmentEvent;
    if (selectedOrderId === orderId) setSelectedOrderId(null);
    if (callTerminatedOrderId === orderId) setCallTerminatedOrderId(null);
    toast.show({ tone: "warning", message: tToast(REASSIGNMENT_TOAST_KEY[kind]) });
    acknowledgeReassignmentEvent();
  }, [
    reassignmentEvent,
    selectedOrderId,
    callTerminatedOrderId,
    toast,
    tToast,
    acknowledgeReassignmentEvent,
  ]);

  // Deep-link: ?openOrderId=<uuid> opens the detail panel for that order
  // and strips the param so refresh doesn't re-open it. Used by the
  // NotificationBell's "Voir la commande" action.
  const openOrderIdParam = searchParams.get("openOrderId");
  useEffect(() => {
    if (!openOrderIdParam) return;
    setSelectedOrderId(openOrderIdParam);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("openOrderId");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [openOrderIdParam, pathname, router, searchParams]);

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
    searchActive: false,
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
  const closedCounts = useMemo<Record<ClosedSubfilter, number>>(() => {
    const next: Record<ClosedSubfilter, number> = {
      all: rawClosedOrders.length,
      uploaded: 0,
      deposit: 0,
      delivered: 0,
      returned: 0,
      cancelled: 0,
      rejected: 0,
    };
    for (const order of rawClosedOrders) {
      const b = bucketForClosed(order);
      if (b) next[b]++;
    }
    return next;
  }, [rawClosedOrders]);

  const orders: QueueOrder[] = useMemo(() => {
    let next: QueueOrder[];
    if (selectedBucket === "fermees") {
      const filtered =
        closedSubfilter === "all"
          ? rawClosedOrders
          : rawClosedOrders.filter((o) =>
              matchesClosedSubfilter(o, closedSubfilter),
            );
      next = filtered.map(toQueueOrder);
    } else {
      let filtered = rawAllOrders.filter((o) => {
        const bucket = bucketForStatus(o.status as string);
        return bucket === selectedBucket;
      });
      if (selectedBucket === "en_cours") {
        if (enCoursSubfilter !== "all") {
          // One clock for the whole pass, so two rows scheduled a millisecond
          // apart cannot be bucketed against different "now"s.
          const nowMs = Date.now();
          filtered = filtered.filter((o) =>
            matchesEnCoursSubfilter(o, enCoursSubfilter, nowMs),
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
    // Preserve the reference when nothing the UI can see changed, so an SWR
    // poll that returns identical data does not re-render the list.
    //
    // This used to compare only length + first id + last id. That is blind to
    // the one mutation the queue actually receives — a field changing on a row
    // that keeps its id and its position — so realtime status updates were
    // dropped and the list stayed stale until the next poll replaced it
    // wholesale. sameQueueOrders compares row contents instead.
    const prev = stableOrdersRef.current;
    if (sameQueueOrders(next, prev)) return prev;
    stableOrdersRef.current = next;
    return next;
  }, [selectedBucket, enCoursSubfilter, tentativeSubfilter, closedSubfilter, rawAllOrders, rawClosedOrders]);

  // Manual carrier-status refresh — pulls the latest carrier-side status for
  // every visible fermé order whose carrier exposes a status API (Dexpress and
  // Darb Assabil), in chunks of 25 (matches each server limit), then
  // revalidates SWR so the new slugs flow back into the bucket pills.
  // Manual-only: there is NO auto-sync on launch or on tab open.
  const handleRefreshDexpress = useCallback(async () => {
    if (refreshingDexpress) return;

    const idsByEndpoint: Array<{ endpoint: string; ids: string[] }> = [
      {
        endpoint: "/api/dexpress/sync-batch",
        ids: rawClosedOrders
          .filter((o) => (o.carrier_code as string | null) === "dexpress")
          .map((o) => o.id as string),
      },
      {
        endpoint: "/api/darb-assabil/sync-batch",
        ids: rawClosedOrders
          .filter((o) => (o.carrier_code as string | null) === "darb_assabil")
          .map((o) => o.id as string),
      },
    ];

    if (idsByEndpoint.every(({ ids }) => ids.length === 0)) return;
    setRefreshingDexpress(true);
    try {
      const CHUNK = 25;
      for (const { endpoint, ids } of idsByEndpoint) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderIds: slice }),
          });
        }
      }
      await mutate();
    } finally {
      setRefreshingDexpress(false);
    }
  }, [refreshingDexpress, rawClosedOrders, mutate]);

  const parsedSearch = useMemo(() => parseQuery(debouncedSearch), [debouncedSearch]);

  // When searching, scan the agent's ENTIRE order set (active + closed),
  // deduped by id with active orders first. The result feeds the same `orders`
  // pathway the keyboard navigation already operates on.
  const searchResults = useMemo<QueueOrder[]>(() => {
    if (!isSearching) return [];
    const seen = new Set<string>();
    const combined: QueueOrder[] = [];
    for (const raw of [...rawAllOrders, ...rawClosedOrders]) {
      const id = raw.id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      combined.push(toQueueOrder(raw));
    }
    return searchOrders(combined, debouncedSearch);
  }, [isSearching, debouncedSearch, rawAllOrders, rawClosedOrders]);

  // What the list and keyboard nav actually see.
  const displayedOrders = isSearching ? searchResults : orders;

  // Publish the live result count so the navbar search bar can display it.
  useEffect(() => {
    setResultCount(isSearching ? searchResults.length : 0);
  }, [isSearching, searchResults.length, setResultCount]);

  // Auto-focus first order if no focus set
  useEffect(() => {
    if (displayedOrders.length > 0 && focusedOrderId === null) {
      setFocusedOrderId(displayedOrders[0].id);
    }
    if (displayedOrders.length > 0 && focusedOrderId !== null && !displayedOrders.some((o) => o.id === focusedOrderId)) {
      setFocusedOrderId(displayedOrders[0].id);
    }
  }, [displayedOrders, focusedOrderId]);

  useEffect(() => {
    stateRef.current = {
      orders: displayedOrders,
      focusedOrderId,
      selectedOrderId,
      callTerminatedOrderId,
      createOpen,
      shortcutsOpen,
      searchActive: searchQuery.trim().length > 0,
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

    // "/" focuses the search bar (matches the orders list shortcut).
    if (e.key === "/") {
      e.preventDefault();
      searchInputRef.current?.focus();
      return;
    }

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
    // Re-check eligibility against the live status so a stale selection (an
    // order confirmed/uploaded in another flow while still ticked) can never
    // open the call sheet on something the sheet can't act on.
    const eligible = (id: string) => {
      const raw = rawAllOrders.find((o) => o.id === id);
      return raw
        ? isBulkCallEligible({
            status: raw.status as string,
            tracking_number: (raw.tracking_number as string | null) ?? null,
            carrier_barcode_deleted_at:
              (raw.carrier_barcode_deleted_at as string | null) ?? null,
          })
        : false;
    };
    const ids = [...selectedOrderIds].filter(eligible);
    setSelectedOrderIds(new Set());
    if (ids.length === 0) return;
    const [first, ...rest] = ids;
    setBulkQueue(rest);
    handleCallTerminated(first);
  }, [selectedOrderIds, rawAllOrders, handleCallTerminated]);

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
        closedSubfilter={closedSubfilter}
        onClosedSubfilterChange={setClosedSubfilter}
        closedCounts={closedCounts}
        onRefreshDexpress={handleRefreshDexpress}
        refreshingDexpress={refreshingDexpress}
        onNewOrder={() => setCreateOpen(true)}
        maxAttempts={maxAttempts}
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
        orders={displayedOrders}
        onOpenDetail={setSelectedOrderId}
        onCallTerminated={handleCallTerminated}
        onRefresh={handleRefresh}
        stats={stats}
        focusedOrderId={focusedOrderId}
        selectedOrderIds={selectedOrderIds}
        onToggleSelect={handleToggleSelect}
        selectedBucket={selectedBucket}
        maxAttempts={maxAttempts}
        highlightQuery={isSearching ? parsedSearch : undefined}
        isSearching={isSearching}
        searchText={debouncedSearch.trim()}
        onClearSearch={() => setSearchQuery("")}
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
        role="agent"
        userId={user?.id ?? undefined}
        onReopened={() => {
          mutate();
          setSelectedOrderId(null);
        }}
        onReassignedAway={() => {
          toast.show({ tone: "warning", message: tToast("reassignedAway") });
        }}
        onTerminatedByManager={(kind) => {
          toast.show({
            tone: "warning",
            message: tToast(kind === "cancelled" ? "cancelledByManager" : "deletedByManager"),
          });
        }}
      />

      {callTerminatedOrderId && activeOrder && (
        <PostCallActionSheet
          // Keyed for the same reason OrderDetailPanel above is. Bulk advance
          // calls setCallTerminatedOrderId(null) and handleCallTerminated(next)
          // in one synchronous continuation, so React 18 batches them into a
          // single commit and the `&&` guard never evaluates false. Unkeyed,
          // React reconciles instead of remounting and the previous order's
          // flow / rejectionReason / selectedCarrierId — plus
          // RejectionReasonSelect's own group+sub, seeded at mount only — carry
          // onto the next order, which then opens pre-armed on the rejection
          // screen with someone else's reason.
          key={callTerminatedOrderId}
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
