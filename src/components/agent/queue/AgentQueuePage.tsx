"use client";

// « File de commandes » — the agent's queue in Aurore (prototypes/agent-shell-v2.html `ordersPage`,
// `ordersPhone`). The header keeps the three meters, now saying what they count; the four buckets are
// tiles (« En cours » turns red when a callback is due); one search line; the bucket's sub-tabs; the list
// and the order's own column beside it. The four call endings live in the order (OrderDetailPanel) on a
// desktop and in « Résultat de l'appel » (CallResultSheet) on a phone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/context/auth";
import { useAgentQueue } from "@/hooks/useAgentQueue";
import { useDebounce } from "@/hooks/useDebounce";
import { useQueueSearch } from "@/context/queue-search";
import { useFeedbackCapture } from "@/components/feedback/FeedbackCaptureProvider";
import { useOrderLocks } from "@/hooks/useOrderLocks";
import { useSlaMinutes } from "@/hooks/useSlaMinutes";
import { useAgentMarketSearch } from "@/hooks/useAgentMarketSearch";
import { isEditableTarget } from "@/lib/dom";
import { AGENT_NEW_ORDER_EVENT } from "@/lib/agent-events";
import { searchOrders } from "@/lib/queue/search";
import { enCoursBucket } from "@/lib/queue/schedule-bucket";
import { isBulkCallEligible } from "@/lib/order-permissions";
import { bucketFor } from "@/lib/carriers/buckets";
import { pushRecentSearch } from "@/lib/agent-search/recent";
import { agentTabOf } from "@/components/agent/shell/AgentNav";
import { toQueueOrder } from "@/lib/agent-queue/to-queue-order";
import { Ic, useAgentPhone, useAgentToast, useTip, useWhen } from "@/components/agent/shared";
import { useAutoPage } from "@/components/agent/useAutoPage";
import type { QueueOrder } from "@/types/queue";
import { DeskRow, MarketRows, PhoneRow, ageLong, type RowCtx } from "./QueueRows";
import { Q_BUCKETS, CLOSED_KEYS, bucketOfStatus, closedKeyOf, isCallbackDue, queueRank, tileHint, type ClosedKey, type QBucket } from "./model";
import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";

const OrderDetailPanel = dynamic(() => import("@/components/queue/OrderDetailPanel").then((m) => m.OrderDetailPanel), { ssr: false });
const CallResultSheet = dynamic(() => import("./outcome/CallResultSheet").then((m) => m.CallResultSheet), { ssr: false });
const CreateOrderModal = dynamic(() => import("@/components/orders/CreateOrderModal").then((m) => m.CreateOrderModal), { ssr: false });
const OrderPreviewSheet = dynamic(() => import("@/components/queue/OrderPreviewSheet").then((m) => m.OrderPreviewSheet), { ssr: false });

type CoursSub = "all" | "tent" | "livr" | "rappel";
type Sub = CoursSub | "all" | ClosedKey;
type Tray = "reject" | "callback" | "send" | "schedule";

const BUCKET_META: Record<QBucket, { icon: string; hue: string }> = {
  new: { icon: "inbox", hue: "blue" },
  cours: { icon: "phone", hue: "amber" },
  conf: { icon: "check", hue: "violet" },
  closed: { icon: "archive", hue: "neutral" },
};
const CLOSED_HUE: Record<ClosedKey, string> = { uploaded: "teal", carrier: "teal", delivered: "green", returned: "red", cancelled: "red", rejected: "red" };
const COURS_OF: Record<string, CoursSub> = { tentative: "tent", livraison: "livr", rappel: "rappel" };

/** Old deep links (?bucket=nouveau, en_cours, confirme, fermees, a_rappeler…) still land. */
function bucketParam(raw: string | null): QBucket {
  const m: Record<string, QBucket> = {
    new: "new", nouveau: "new", cours: "cours", en_cours: "cours", a_rappeler: "cours", planifie: "cours", tentative: "cours", rappel_prevu: "cours", all: "cours",
    conf: "conf", confirme: "conf", closed: "closed", fermees: "closed",
  };
  return (raw && m[raw]) || "new";
}

const closedKey = (o: Record<string, unknown>): ClosedKey | null => {
  const b = bucketFor({
    status: o.status as string,
    carrierCode: (o.carrier_code as string | null) ?? null,
    dexpressStatusSlug: (o.dexpress_status_slug as string | null) ?? null,
    dexpressStatusAccepted: typeof o.dexpress_status_accepted === "boolean" ? (o.dexpress_status_accepted as boolean) : null,
    carrierStatusSlug: (o.carrier_status_slug as string | null) ?? null,
  });
  return b ? closedKeyOf(b) : null;
};

export function AgentQueuePage() {
  const t = useTranslations("agentQueue");
  const tRt = useTranslations("queue.realtime.toast");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const phone = useAgentPhone();
  const toast = useAgentToast();
  const tip = useTip();
  const marketId = user?.market_id ?? null;
  const when = useWhen(marketId, locale);
  const sla = useSlaMinutes(marketId);

  const [bucket, setBucket] = useState<QBucket>(() => bucketParam(searchParams.get("bucket")));
  const [sub, setSub] = useState<Sub>("all");
  const [att, setAtt] = useState(0);
  const { query, setQuery, setResultCount, inputRef } = useQueueSearch();
  const q = useDebounce(query, 200).trim();
  const searching = q.length > 0;

  const { allOrders: rawActiveUnsorted, closedOrders: rawClosed, closedCounts: serverClosed, error, mutate, reassignmentEvent, acknowledgeReassignmentEvent, connected, tick, isLoading } =
    useAgentQueue({ agentId: user?.id ?? null, marketId, withClosed: bucket === "closed" || searching });

  // Re-read the clock each minute (tick) so a callback that falls due jumps to the top.
  const now = useMemo(() => new Date(), [tick, rawActiveUnsorted]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = useMemo(() => rawActiveUnsorted.map(toQueueOrder), [rawActiveUnsorted]);
  const closed = useMemo(() => rawClosed.map((r) => ({ o: toQueueOrder(r), k: closedKey(r) })), [rawClosed]);

  const { data: stats } = useSWR<{ assigned_today?: number; actioned_today?: number; confirmation_rate?: number }>("/api/agent/stats", { refreshInterval: 30_000 });
  const { data: settings } = useSWR<{ max_call_attempts?: number }>("/api/agent/settings");
  const maxAttempts = settings?.max_call_attempts ?? 3;

  // Warm the panel's dropdown caches and its code before the first click.
  useSWR("/api/products/search", { revalidateOnFocus: false, dedupingInterval: 60_000 });
  useSWR("/api/cities", { revalidateOnFocus: false, dedupingInterval: 300_000 });
  useEffect(() => {
    void import("@/components/queue/OrderDetailPanel");
  }, []);

  // App-launch Darb sweep — once per mount, server-throttled to one per market per 10 min.
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current) return;
    swept.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/darb-assabil/sync-market", { method: "POST" });
        const body = res.ok ? ((await res.json().catch(() => null)) as { skipped?: boolean } | null) : null;
        if (body && body.skipped === false) await mutate();
      } catch {
        /* non-fatal */
      }
    })();
  }, [mutate]);

  const { othersOn } = useOrderLocks({ marketId: null, enabled: Boolean(user?.id), scope: user?.id ? { kind: "agent", userId: user.id } : { kind: "market" }, selfId: user?.id ?? null });
  const managerOn = useCallback((id: string) => {
    const p = othersOn(id)[0];
    return p ? (p.full_name ?? "").split(" ")[0] || "·" : null;
  }, [othersOn]);

  // ── counts ────────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const by = (b: QBucket) => active.filter((o) => bucketOfStatus(o.status) === b);
    const nw = by("new").sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const closedN = rawClosed.length ? rawClosed.length : (serverClosed as unknown as Record<string, number>).all ?? 0;
    return {
      new: nw.length,
      cours: by("cours").length,
      conf: by("conf").length,
      closed: closedN,
      late: active.filter((o) => isCallbackDue({ status: o.status, callback_time: o.callback_time }, now)).length,
      tent: active.filter((o) => o.status.startsWith("attempt_")).length,
      rappel: active.filter((o) => o.status === "callback_scheduled").length,
      oldestNewMin: nw.length ? (now.getTime() - Date.parse(nw[0].created_at)) / 60000 : 0,
    };
  }, [active, rawClosed, serverClosed, now]);

  const closedCount = useCallback(
    (k: ClosedKey | "all") => {
      if (rawClosed.length) return k === "all" ? closed.length : closed.filter((c) => c.k === k).length;
      const s = serverClosed as unknown as Record<string, number>;
      return k === "all" ? s.all ?? 0 : k === "carrier" ? s.deposit ?? 0 : s[k] ?? 0;
    },
    [rawClosed.length, closed, serverClosed],
  );

  const coursOf = useCallback(
    (o: QueueOrder): CoursSub =>
      COURS_OF[enCoursBucket({ status: o.status, callback_scheduled_at: o.callback_time, scheduled_dispatch_at: o.scheduled_dispatch_at, scheduled_dispatch_auto: o.scheduled_dispatch_auto }, now.getTime()) ?? ""] ?? "all",
    [now],
  );

  // ── the rows ──────────────────────────────────────────────────────────────
  const closedAtOf = (o: QueueOrder) => o.last_action_at ?? o.created_at;
  const sortQueue = useCallback(
    (a: QueueOrder, b: QueueOrder) =>
      queueRank({ status: a.status, callback_time: a.callback_time }, now) - queueRank({ status: b.status, callback_time: b.callback_time }, now) || Date.parse(a.created_at) - Date.parse(b.created_at),
    [now],
  );

  const rows: { o: QueueOrder; closed: boolean }[] = useMemo(() => {
    if (searching) {
      const mine = searchOrders([...active, ...closed.map((c) => c.o)], q);
      const closedIds = new Set(closed.map((c) => c.o.id));
      return mine.map((o) => ({ o, closed: closedIds.has(o.id) })).sort((a, b) => Number(a.closed) - Number(b.closed) || (a.closed ? 0 : sortQueue(a.o, b.o)));
    }
    if (bucket === "closed") {
      return closed
        .filter((c) => sub === "all" || c.k === sub)
        .map((c) => ({ o: c.o, closed: true }))
        .sort((a, b) => Date.parse(closedAtOf(b.o)) - Date.parse(closedAtOf(a.o)));
    }
    return active
      .filter((o) => bucketOfStatus(o.status) === bucket)
      .filter((o) => bucket !== "cours" || sub === "all" || coursOf(o) === sub)
      .filter((o) => !(bucket === "cours" && sub === "tent" && att) || o.attempt_count === att || o.status === `attempt_${att}`)
      .sort(sortQueue)
      .map((o) => ({ o, closed: false }));
  }, [searching, q, active, closed, bucket, sub, att, coursOf, sortQueue]);

  useEffect(() => {
    setResultCount(searching ? rows.length : 0);
  }, [searching, rows.length, setResultCount]);
  useEffect(() => {
    if (q.length >= 2) pushRecentSearch(q);
  }, [q]);

  // The market search: the agent's own orders first, then the rest of the market, read-only.
  const market = useAgentMarketSearch(query, searching && q.length >= 3);
  const marketRows = useMemo(() => (q.length >= 3 ? market.rows.filter((r) => r.owner !== "me" && !r.archived).slice(0, 6) : []), [market.rows, q]);

  // ── selection, focus, the open order ──────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null);
  const [initialTray, setInitialTray] = useState<Tray | undefined>(undefined);
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ o: QueueOrder; step?: Tray } | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [deepTab, setDeepTab] = useState<{ id: string; tab: "messages" } | null>(null);
  const { captureOpen } = useFeedbackCapture();

  const open = useCallback((id: string, tray?: Tray) => {
    setOpenId(id);
    setFocus(id);
    setInitialTray(tray);
  }, []);

  // Deep links: ?openOrderId= (the bell), ?viewOrderId= (a colleague's order from the header search).
  const openParam = searchParams.get("openOrderId");
  const viewParam = searchParams.get("viewOrderId");
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (!openParam && !viewParam) return;
    if (openParam) {
      open(openParam);
      setDeepTab((prev) => (tabParam === "messages" ? (prev?.id === openParam ? prev : { id: openParam, tab: "messages" }) : null));
    }
    if (viewParam) setViewId(viewParam);
    const params = new URLSearchParams(searchParams.toString());
    ["openOrderId", "viewOrderId", "tab"].forEach((k) => params.delete(k));
    const rest = params.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [openParam, viewParam, tabParam, pathname, router, searchParams, open]);

  // A manager took the order back, cancelled or deleted it.
  useEffect(() => {
    if (!reassignmentEvent) return;
    const { orderId, kind } = reassignmentEvent;
    if (openId === orderId) setOpenId(null);
    toast(tRt(kind === "reassigned" ? "reassignedAway" : kind === "cancelled" ? "cancelledByManager" : "deletedByManager"));
    acknowledgeReassignmentEvent();
  }, [reassignmentEvent, openId, toast, tRt, acknowledgeReassignmentEvent]);

  useEffect(() => {
    const onNew = () => setCreateOpen(true);
    window.addEventListener(AGENT_NEW_ORDER_EVENT, onNew);
    return () => window.removeEventListener(AGENT_NEW_ORDER_EVENT, onNew);
  }, []);

  // Automatic pagination: 40 rows, then 40 more as the list's end comes into view.
  const { shown, more } = useAutoPage(rows, `${bucket}|${sub}|${att}|${q}`);

  // ── keys: ? · / · ↑↓ (j k) · Enter · Esc. 1–4 and p are the order's own (the panel). ──────────
  // The queue stays mounted (hidden) behind the other tabs: there its keys stand down and its
  // order closes — a hidden order must never take « 1 » for « Pas de réponse ».
  const onQueue = agentTabOf(pathname ?? "") === "orders";
  useEffect(() => {
    if (onQueue) return;
    setOpenId(null);
    setSheet(null);
    setKeysOpen(false);
  }, [onQueue]);
  const keyState = useRef({ shown, focus, openId, layered: false, onQueue });
  keyState.current = { shown, focus, openId, layered: createOpen || captureOpen || keysOpen || sheet !== null, onQueue };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = keyState.current;
      if (!s.onQueue || isEditableTarget(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setKeysOpen((v) => !v);
        return;
      }
      if (s.layered) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && !s.openId) {
        setSel((p) => (p.size ? new Set() : p));
        return;
      }
      if (["ArrowDown", "ArrowUp", "j", "k"].includes(e.key) && s.shown.length) {
        e.preventDefault();
        const ids = s.shown.map((r) => r.o.id);
        const cur = ids.indexOf(s.focus ?? s.openId ?? "");
        const nx = ids[Math.max(0, Math.min(ids.length - 1, cur + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)))];
        setFocus(nx);
        if (s.openId) open(nx);
        document.querySelector(`[data-open="${nx}"]`)?.scrollIntoView?.({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && s.focus && s.openId !== s.focus) {
        e.preventDefault();
        open(s.focus);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inputRef, open]);

  // ── an ending was recorded: refresh, and carry a bulk run on ───────────────
  const onOutcomeDone = useCallback(
    (r: { autoRejected?: boolean }) => {
      void mutate();
      if (r.autoRejected) toast(t("autoRejected"));
      setSheet(null);
      if (bulk.length) {
        const [next, ...rest] = bulk;
        setBulk(rest);
        open(next);
      }
    },
    [mutate, toast, t, bulk, open],
  );

  const startBulk = () => {
    const ids = [...sel].filter((id) => {
      const o = active.find((x) => x.id === id);
      return o ? isBulkCallEligible({ status: o.status, tracking_number: o.tracking_number, carrier_barcode_deleted_at: o.carrier_barcode_deleted_at }) : false;
    });
    setSel(new Set());
    if (!ids.length) return;
    const [first, ...rest] = ids;
    setBulk(rest);
    open(first);
    toast(t("bulk.started", { n: ids.length }));
  };

  // ── « Actualiser le suivi » — the carriers' status for the closed parcels (Darb and Dexpress). ─
  const [refreshing, setRefreshing] = useState(false);
  const refreshTracking = async () => {
    if (refreshing) return;
    const groups = [
      { endpoint: "/api/dexpress/sync-batch", ids: rawClosed.filter((o) => o.carrier_code === "dexpress").map((o) => o.id as string) },
      { endpoint: "/api/darb-assabil/sync-batch", ids: rawClosed.filter((o) => o.carrier_code === "darb_assabil").map((o) => o.id as string) },
    ];
    if (groups.every((g) => !g.ids.length)) return;
    setRefreshing(true);
    try {
      for (const g of groups)
        for (let i = 0; i < g.ids.length; i += 25)
          await fetch(g.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderIds: g.ids.slice(i, i + 25) }) });
      await mutate();
      toast(t("subs.refreshed"));
    } finally {
      setRefreshing(false);
    }
  };

  const pickBucket = (k: QBucket) => {
    setBucket(k);
    setSub("all");
    setAtt(0);
    setSel(new Set());
    setQuery("");
  };

  const ctx: RowCtx = { now, marketId, when, maxAttempts, sla, narrow: !phone && openId !== null, managerOn };
  const fallback = openId ? rawActiveUnsorted.find((o) => o.id === openId) ?? rawClosed.find((o) => o.id === openId) ?? null : null;

  if (error) return <div className="err" role="alert">{t("error")}</div>;
  const loading = isLoading && !rawActiveUnsorted.length;

  // ── pieces ────────────────────────────────────────────────────────────────
  const tiles = (
    <section className={`wts${loading ? " busy" : ""}`} aria-label={t("tilesAria")}>
      {Q_BUCKETS.map((k) => {
        const n = counts[k];
        const on = !searching && bucket === k;
        const hint = tileHint(k, { new: counts.new, oldestNewMin: counts.oldestNewMin, late: counts.late, tent: counts.tent, rappel: counts.rappel, conf: counts.conf });
        const alarm = hint.key === "coursLate";
        return (
          <button key={k} type="button" className={`wt h-${alarm ? "red" : BUCKET_META[k].hue}${on ? " on" : ""}${alarm ? " alarm" : ""}${n ? "" : " zero"}`} aria-pressed={on} onClick={() => pickBucket(k)}>
            <span className="hold"><Ic n={alarm ? "clock" : BUCKET_META[k].icon} /></span>
            <span className="wt-t">
              <b className="num">{n.toLocaleString("fr-FR")}</b>
              <span>{t(`buckets.${k}`)}</span>
              <small>
                {hint.key === "newOldest" ? t("hints.newOldest", { age: ageLong(t, hint.min) })
                  : hint.key === "coursLate" ? <em>{t("hints.coursLate", { n: hint.n })}</em>
                  : hint.key === "coursSplit" ? t("hints.coursSplit", { tent: hint.tent, rappel: hint.rappel })
                  : t(`hints.${hint.key}`)}
              </small>
            </span>
          </button>
        );
      })}
    </section>
  );

  const subs =
    searching || (bucket !== "cours" && bucket !== "closed") ? null : (
      <div className="seg-row">
        <div className="seg" role="tablist">
          {(bucket === "cours" ? (["all", "tent", "livr", "rappel"] as Sub[]) : (["all", ...CLOSED_KEYS] as Sub[])).map((k) => {
            const c =
              bucket === "closed"
                ? closedCount(k as ClosedKey | "all")
                : active.filter((o) => bucketOfStatus(o.status) === "cours" && (k === "all" || coursOf(o) === k)).length;
            return (
              <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? "on" : ""} onClick={() => { setSub(k); setAtt(0); }}>
                {bucket === "closed" && k !== "all" ? <i className={`dotk h-${CLOSED_HUE[k as ClosedKey]}`} /> : null}
                {t(`subs.${k}`)}
                <em>{c}</em>
              </button>
            );
          })}
        </div>
        {bucket === "cours" && sub === "tent" ? (
          <span className="seg" style={{ padding: 3 }}>
            {[0, 1, 2, 3].map((n) => (
              <button key={n} type="button" className={att === n ? "on" : ""} style={{ height: 30, padding: "0 10px" }} onClick={() => setAtt(n)}>
                {n ? n : t("subs.attAll")}
                <em>{active.filter((o) => o.status.startsWith("attempt_") && (!n || o.attempt_count === n)).length}</em>
              </button>
            ))}
          </span>
        ) : null}
        {bucket === "closed" ? (
          <button type="button" className="btn2" style={{ marginInlineStart: "auto" }} onClick={refreshTracking} disabled={refreshing}>
            <Ic n="rotate" />
            {refreshing ? t("subs.refreshing") : t("subs.refresh")}
          </button>
        ) : null}
      </div>
    );

  const empty = (
    <div className="empty">
      <Ic n={searching ? "search" : "check"} />
      {searching ? (
        <>
          <b>{t("empty.searchTitle")}</b>
          <span>{t("empty.search", { q })}</span>
          <button type="button" className="btn2" onClick={() => setQuery("")}>{t("search.clear")}</button>
        </>
      ) : bucket === "new" ? (
        <>
          <b>{t("empty.newTitle")}</b>
          <span>{t("empty.new")}</span>
          <button type="button" className="btn2" onClick={async () => { await mutate(); toast(t("empty.rechecked")); }}>
            <Ic n="rotate" />
            {t("empty.recheck")}
          </button>
        </>
      ) : (
        <b>{t("empty.none")}</b>
      )}
    </div>
  );

  const reconnecting = !connected ? <div className="note h-amber" role="status"><Ic n="alert" /><span>{t("reconnecting")}</span></div> : null;

  const overlays = (
    <>
      <CreateOrderModal isOpen={createOpen} onClose={() => setCreateOpen(false)} role="agent" userMarketId={marketId ?? ""} onCreated={() => mutate()} />
      {viewId ? <OrderPreviewSheet orderId={viewId} onClose={() => setViewId(null)} onOpenOwn={(id: string) => { setViewId(null); open(id); }} /> : null}
      {sheet ? (
        <CallResultSheet order={sheet.o} maxAttempts={maxAttempts} marketId={marketId ?? ""} initialStep={sheet.step} onClose={() => setSheet(null)} onDone={onOutcomeDone} />
      ) : null}
      {keysOpen ? <KeysModal onClose={() => setKeysOpen(false)} /> : null}
    </>
  );

  // ── the phone ─────────────────────────────────────────────────────────────
  if (phone) {
    return (
      <div style={{ display: "contents" }}>
        {reconnecting}
        {tiles}
        <label className="srch">
          <Ic n="search" />
          <input ref={inputRef as React.Ref<HTMLInputElement>} id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.phonePlaceholder")} autoComplete="off" />
        </label>
        {subs ? <div className="hscroll">{subs}</div> : null}
        <section className="list">
          <div className="rows">
            {loading ? <div className="sk-row" /> : shown.length ? shown.map(({ o, closed: c }) => (
              <PhoneRow key={o.id} o={o} ctx={ctx} closed={c} onOpen={(id) => open(id)} onCall={(o2) => { toast(t("phone.calling", { phone: o2.customer_phone })); setSheet({ o: o2 }); }} onSend={(o2) => setSheet({ o: o2, step: "send" })} />
            )) : empty}
          </div>
          {more}
        </section>
        <MarketRows rows={marketRows} ctx={ctx} onView={setViewId} />
        {openId ? (
          <OrderDetailPanel
            key={openId}
            variant="side"
            orderId={openId}
            initialTab={deepTab?.id === openId ? deepTab.tab : undefined}
            initialTray={initialTray}
            fallbackOrder={fallback}
            onClose={() => setOpenId(null)}
            onOutcomeDone={onOutcomeDone}
            role="agent"
            userId={user?.id ?? undefined}
            onReopened={() => { void mutate(); setOpenId(null); }}
          />
        ) : null}
        {overlays}
      </div>
    );
  }

  // ── the desktop ───────────────────────────────────────────────────────────
  const m = { rate: stats?.confirmation_rate ?? 0, done: stats?.actioned_today ?? 0, file: stats?.assigned_today ?? 0 };
  return (
    <div style={{ display: "contents" }} onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <header className="ph">
        <div>
          <h1>{t("title")}</h1>
          <div className="sub">
            <span>{(user?.full_name ?? "").split(" ")[0]}</span>
            <span className="sep" />
            <span className="live" data-tip={t("liveTip")}><i />{t("live")}</span>
          </div>
        </div>
        <div className="acts">
          <div className="mets">
            <span className="met" data-tip={t("meters.rateTip")}><b>{m.rate}<small>%</small></b><span>{t("meters.rate")}</span></span>
            <span className="met" data-tip={t("meters.doneTip")}><b>{m.done}</b><span>{t("meters.done")}</span></span>
            <span className="met" data-tip={t("meters.fileTip")}><b>{m.file}</b><span>{t("meters.file")}</span></span>
          </div>
          <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
            <Ic n="plus" />
            {t("newOrder")}
          </button>
        </div>
      </header>
      {reconnecting}
      {tiles}
      <div className="tools">
        <label className="srch">
          <Ic n="search" />
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            id="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button type="button" className="mini" aria-label={t("search.clear")} onClick={() => setQuery("")}><Ic n="x" /></button>
          ) : (
            <span className="kbd2">/</span>
          )}
        </label>
        <span className="count">
          {searching
            ? t.rich("search.countSearch", { n: rows.length, b: (c) => <b>{c}</b> })
            : t.rich("search.count", { n: rows.length, b: (c) => <b>{c}</b> })}
          {searching && marketRows.length ? t.rich("search.countElsewhere", { m: marketRows.length, b: (c) => <b>{c}</b> }) : null}
        </span>
        <span className="sortd">
          <Ic n={bucket === "closed" && !searching ? "clock" : "spark"} />
          {bucket === "closed" && !searching ? t("search.recent") : t("search.urgent")}
        </span>
        <button type="button" className="btn2 sq" data-tip={t("search.keys")} aria-label={t("search.keys")} onClick={() => setKeysOpen(true)}>?</button>
      </div>
      {subs}
      <div className={`split${openId ? " open" : ""}`}>
        <div className="lcol">
          <section className="list">
            <div className="lh qh">
              <span />
              <span>{t("cols.client")}</span>
              <span>{bucket === "closed" && !searching ? t("cols.outcome") : t("cols.activity")}</span>
              <span>{bucket === "closed" && !searching ? t("cols.closed") : t("cols.age")}</span>
              <span className="e">{t("cols.amount")}</span>
            </div>
            <div className="rows">
              {loading ? [0, 1, 2, 3].map((i) => <div key={i} className="sk-row" />) : shown.length ? shown.map(({ o, closed: c }) => (
                <DeskRow
                  key={o.id}
                  o={o}
                  ctx={ctx}
                  open={openId === o.id}
                  focused={focus === o.id && openId !== o.id}
                  selected={sel.has(o.id)}
                  closedAt={c ? closedAtOf(o) : undefined}
                  onOpen={(id) => open(id)}
                  onToggle={(id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                  onSend={(id) => open(id, "send")}
                />
              )) : empty}
            </div>
            {more}
            <div className="lfoot"><span className="kbd2">F</span>{t("vocFoot")}</div>
          </section>
          <MarketRows rows={marketRows} ctx={ctx} onView={setViewId} />
        </div>
        {openId ? (
          <OrderDetailPanel
            key={openId}
            variant="side"
            orderId={openId}
            initialTab={deepTab?.id === openId ? deepTab.tab : undefined}
            initialTray={initialTray}
            fallbackOrder={fallback}
            onClose={() => setOpenId(null)}
            onOutcomeDone={onOutcomeDone}
            role="agent"
            userId={user?.id ?? undefined}
            onReopened={() => { void mutate(); setOpenId(null); }}
          />
        ) : null}
      </div>
      {sel.size ? (
        <div className="bulk" role="toolbar">
          <b>{t("bulk.count", { n: sel.size })}</b>
          <span className="vsep" />
          <button type="button" className="btn" onClick={startBulk}><Ic n="phone" />{t("bulk.start")}</button>
          <span className="q" style={{ fontSize: 12 }}><span className="kbd2">{t("bulk.esc")}</span> {t("bulk.escHint")}</span>
          <button type="button" className="xbtn" aria-label={t("bulk.clear")} onClick={() => setSel(new Set())}><Ic n="x" /></button>
        </div>
      ) : null}
      <div ref={tip.ref} className="tip" />
      {overlays}
    </div>
  );
}

/** « ? » — the shortcuts, all of them working this time. */
function KeysModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("agentQueue.keys");
  const k: [string, string][] = [
    ["↑ ↓", t("nav")], [t("enter"), t("open")], ["1", t("k1")], ["2", t("k2")], ["3", t("k3")], ["4", t("k4")],
    ["p", t("p")], ["F", t("f")], ["/", t("slash")], [t("esc"), t("escDo")], ["?", t("help")],
  ];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mbox" role="dialog" aria-label={t("title")}>
        <div className="tray-h">
          <span className="hold h-neutral"><Ic n="sliders" /></span>
          <span className="tt"><b>{t("title")}</b></span>
          <button type="button" className="xbtn" aria-label={t("close")} onClick={onClose}><Ic n="x" /></button>
        </div>
        <div className="klist">
          {k.map(([a, b]) => (
            <div key={b}><span>{b}</span><kbd>{a}</kbd></div>
          ))}
        </div>
      </div>
    </div>
  );
}

