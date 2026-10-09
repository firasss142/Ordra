"use client";

/**
 * « Suivi livraison » — the manager and super_admin screen, « Aurore calme »
 * on the /leads skeleton. prototypes/suivi-livraison-manager-v5.html:
 *   header (« À faire », Colis | Livreurs, the target) → bucket tiles →
 *   agent cards → the list → the parcel panel.
 * The right-hand cockpit is gone: the team is the cards, « what blocks » is the
 * list filtered on one agent, couriers and carriers are the second view.
 *
 * Pure: data, clock and mutations come in as props (DeliveryBoardClient), so
 * every state of the page is testable. Arithmetic: lib/delivery/board.ts and
 * lib/delivery/manager.ts. Plan: plans/delivery-board-aurore.md.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Check, ChevronRight, Package, Target, User, X } from "lucide-react";
import type { Role } from "@/types";
import type { DeliveryBoardAgent, WorklistRow } from "@/lib/delivery/types";
import { applyRecordedAction } from "@/lib/delivery/worklist";
import { moveFor, situationOf, type QuickOutcome, type SituationKey } from "@/lib/delivery/presentation";
import { agentBoard, agentsFromRows, carrierBoard, courierBoard, type AgentRef } from "@/lib/delivery/board";
import { bucketTiles, lateIds, liveRows, ringOf, sortRows, stateRows, todoLines, LIST_STATES, type ListState } from "@/lib/delivery/manager";
import { inTwoHours, tomorrowAt } from "@/lib/delivery/schedule";
import { normalizePhone } from "@/lib/leads/phone";
import type { PendingAction, QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { useRegisterFeedbackContext } from "@/components/feedback/FeedbackCaptureProvider";
import { ActionSheet, WhatsAppSheet } from "../Sheets";
import { BucketStrip, TeamStrip, TodoButton, type AgentCard } from "./Strips";
import { NO_AGENT, NO_FILTERS, PER_PAGE, ParcelList, type FilterOption, type ListFilters } from "./ParcelList";
import { ParcelDrawer } from "./ParcelDrawer";
import { CouriersView, ReassignDialog } from "./Overlays";
import { Avatar, sitDot, useTip } from "./parts";
import "./board.css";

type Sheet =
  | { kind: "action"; orderId: string; type: "call_customer" | "call_courier" | "call_branch" | "note" }
  | { kind: "wa"; orderId: string }
  | { kind: "reassign"; orderIds: string[]; fromAgentId: string | null };

export interface DeliveryBoardViewProps {
  /** null while the first load is in flight. */
  rows: WorklistRow[] | null;
  error: boolean;
  onRetry: () => void;
  /** Per-agent activity from the ledger (with each agent's colour); empty until the board call lands. */
  activity: DeliveryBoardAgent[];
  targetHours: number;
  role: Role;
  marketCode: "ly" | "tn";
  marketId?: string | null;
  whatsappActive?: boolean;
  whatsappKnown?: boolean;
  marketLabel: string;
  tz: string;
  locale: string;
  now: number;
  pending: PendingAction | null;
  notice: "undone" | "failed" | null;
  onQueue: (row: WorklistRow, body: QueuedBody) => void;
  onUndo: () => void;
  onDismissNotice: () => void;
  /** The « Terminées » state needs the done parcels, which the worklist leaves out by default. */
  onNeedDone?: () => void;
  /** Moves parcels to another agent; resolves once the server has answered. */
  onReassign: (orderIds: string[], targetAgentId: string) => Promise<void>;
}

function matches(row: WorklistRow, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const hay = [row.customer_name, row.customer_city, row.customer_address, row.external_id, row.tracking_number, row.agent_name]
    .filter(Boolean).join(" ").toLowerCase();
  if (hay.includes(text)) return true;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 3 && [row.customer_phone, row.customer_phone_2].some((p) => p && normalizePhone(p).includes(digits.replace(/^0/, "")));
}

const VERDICT_ORDER = { late: 0, idle: 1, ok: 2 } as const;

export function DeliveryBoardView(props: DeliveryBoardViewProps) {
  const { rows: rawRows, error, onRetry, activity, targetHours, marketCode, marketLabel, tz, locale, now, pending, notice, onQueue } = props;
  const t = useTranslations("delivery.manager");
  const tDel = useTranslations("delivery");
  const tipRef = useTip();
  const [view, setView] = useState<"parcels" | "couriers">("parcels");
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [todoOpen, setTodoOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Voix du client: the open parcel is the F key's context.
  const feedbackCapture = useRegisterFeedbackContext(openId);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const all = useMemo(
    () => rawRows?.map((r) => (pending && r.order_id === pending.orderId ? applyRecordedAction(r, pending.body, now) : r)) ?? [],
    [rawRows, pending, now],
  );
  const byId = useCallback((id: string) => all.find((r) => r.order_id === id) ?? null, [all]);

  // The roster comes from the board call; until it lands, the agents the parcels name.
  const agents: AgentRef[] = useMemo(
    () => (activity.length > 0 ? activity.map((a) => ({ id: a.agent_id, name: a.name })) : agentsFromRows(all)),
    [activity, all],
  );
  const colors = useMemo(() => new Map(activity.map((a) => [a.agent_id, a.color ?? null])), [activity]);
  const cards: AgentCard[] = useMemo(() => agents
    .map((ref) => {
      const act = activity.find((a) => a.agent_id === ref.id);
      const b = agentBoard(all, ref, act ? { ...act } : null, targetHours, now);
      return { ...b, color: colors.get(ref.id) ?? null, ring: ringOf(all, ref.id, tz, now) };
    })
    // Grouped, never ranked (decision 40): late, then idle, then up to date; alphabetical inside.
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.name.localeCompare(b.name)),
  [agents, activity, all, colors, targetHours, now, tz]);

  // A card only for an agent with something in flight or something done today:
  // a roster of idle accounts would push the list off the first screen.
  const teamCards = useMemo(() => cards.filter((c) => c.inFlight > 0 || c.actionsToday > 0 || c.ring.treated > 0), [cards]);
  const live = useMemo(() => liveRows(all, now), [all, now]);
  const late = useMemo(() => lateIds(all, targetHours, now), [all, targetHours, now]);
  const lines = useMemo(() => todoLines(all, cards, targetHours, now), [all, cards, targetHours, now]);
  const tiles = useMemo(() => bucketTiles(all, targetHours, now), [all, targetHours, now]);
  const saved = cards.reduce((n, c) => n + c.savedWeek, 0);
  const lost = cards.reduce((n, c) => n + c.lostWeek, 0);
  const toTreat = cards.reduce((n, c) => n + c.toTreat, 0);

  const stateCounts = useMemo(
    () => Object.fromEntries(LIST_STATES.map((s) => [s, stateRows(all, s, targetHours, now).length])) as Record<ListState, number>,
    [all, targetHours, now],
  );
  const filtered = useMemo(() => {
    const f = filters;
    let rs = stateRows(all, f.state, targetHours, now);
    if (f.buckets.length && f.state === "live") rs = rs.filter((r) => (f.buckets as string[]).includes(r.bucket));
    if (f.agents.length) rs = rs.filter((r) => f.agents.includes(r.assigned_to ?? NO_AGENT));
    if (f.sits.length) rs = rs.filter((r) => f.sits.includes(situationOf(r, now).key));
    if (f.carriers.length) rs = rs.filter((r) => r.carrier_id !== null && f.carriers.includes(r.carrier_id));
    if (f.q.trim()) rs = rs.filter((r) => matches(r, f.q));
    return sortRows(rs, f.sort, targetHours, now);
  }, [all, filters, targetHours, now]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.min(filters.page, pages);
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const options = useMemo(() => {
    const count = (fn: (r: WorklistRow) => boolean) => live.filter(fn).length;
    const agentsOpts: FilterOption[] = cards.map((c) => ({ v: c.id, l: c.name, n: count((r) => r.assigned_to === c.id), icon: <Avatar id={c.id} name={c.name} color={c.color} small /> }));
    if (live.some((r) => !r.assigned_to)) agentsOpts.push({ v: NO_AGENT, l: t("f.noAgent"), n: count((r) => !r.assigned_to), icon: <Avatar id={null} name={null} small /> });
    const sitCounts = new Map<SituationKey, number>();
    for (const r of live) { const k = situationOf(r, now).key; sitCounts.set(k, (sitCounts.get(k) ?? 0) + 1); }
    const carriers = new Map<string, { l: string; n: number }>();
    for (const r of live) if (r.carrier_id) carriers.set(r.carrier_id, { l: r.carrier_name ?? "—", n: (carriers.get(r.carrier_id)?.n ?? 0) + 1 });
    return {
      buckets: tiles.map((x) => ({ v: x.bucket, l: t(`buckets.${x.bucket}`), n: x.count })),
      agents: agentsOpts,
      sits: [...sitCounts.entries()].map(([k, n]) => ({ v: k, l: tDel(`sit.${k}`), n, icon: <i className="d" style={{ background: sitDot(k), width: 8, height: 8 }} /> })),
      carriers: [...carriers.entries()].map(([v, c]) => ({ v, l: c.l, n: c.n })),
    };
  }, [live, cards, tiles, now, t, tDel]);

  const oneAgent = filters.agents.length === 1 && filters.agents[0] !== NO_AGENT ? cards.find((c) => c.id === filters.agents[0]) ?? null : null;
  const couriers = useMemo(() => {
    const dominant = new Map<string, Map<string, number>>();
    for (const r of live) {
      if (!r.handler_name || !r.carrier_name) continue;
      const m = dominant.get(r.handler_name) ?? new Map<string, number>();
      m.set(r.carrier_name, (m.get(r.carrier_name) ?? 0) + 1);
      dominant.set(r.handler_name, m);
    }
    return courierBoard(live)
      .sort((a, b) => b.noAnswer - a.noAnswer || b.held - a.held)
      .map((c) => ({ ...c, carrier: [...(dominant.get(c.name)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }));
  }, [live]);
  const carriers = useMemo(() => carrierBoard(live), [live]);

  const scrollToList = () => requestAnimationFrame(() => document.getElementById("dlb-list")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  const onFilters = useCallback((f: Partial<ListFilters>) => {
    if (f.state === "done") props.onNeedDone?.();
    setFilters((prev) => ({ ...prev, ...f }));
  }, [props]);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const reassignAgent = (id: string) => {
    const ids = all.filter((r) => r.assigned_to === id && r.bucket !== "done").map((r) => r.order_id);
    if (ids.length) { setTodoOpen(false); setSheet({ kind: "reassign", orderIds: ids, fromAgentId: id }); }
  };

  const openAction = useCallback((row: WorklistRow, type?: "call_customer" | "call_courier" | "call_branch" | "note") => {
    // A WhatsApp move has its own sheet; the action sheet opens on a call or a note.
    const suggested = moveFor(row, now).actionType;
    const fallback = suggested && suggested !== "whatsapp_customer" ? suggested : "call_customer";
    setSheet({ kind: "action", orderId: row.order_id, type: type ?? fallback });
  }, [now]);
  const onQuick = useCallback((row: WorklistRow, q: QuickOutcome) => {
    const next = q.reminder === "in2h" ? inTwoHours(now) : q.reminder === "tomorrow10" ? tomorrowAt(now, tz, 10) : null;
    onQueue(row, { action_type: q.actionType, outcome: q.outcome, note: null, next_action_at: next, template_key: null });
  }, [now, tz, onQueue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || sheet || openId) return;
      setSelection(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet, openId]);

  const open = openId ? byId(openId) : null;
  const sheetRow = sheet && sheet.kind !== "reassign" ? byId(sheet.orderId) : null;
  const pendingRow = pending ? byId(pending.orderId) : null;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));

  return (
    <div className="dlb">
      <div className="page">
        <header className="ph">
          <div>
            <div className="crumb">{t("crumb")} <ChevronRight className="ic flip" /> {tDel("title")}</div>
            <h1>{tDel("title")}</h1>
            <div className="sub">
              <span>{t("sub", { market: marketLabel, n: live.length, agents: teamCards.length })}</span>
              <span className="chip"><span className="dot" />{t("live", { time })}</span>
              {live.length > 0 ? <span className="chip" data-tip={t("weekTip")}>{t("week", { saved, lost })}</span> : null}
            </div>
          </div>
          <div className="acts">
            <TodoButton lines={lines} liveCount={live.length} toTreat={toTreat} open={todoOpen} onOpen={setTodoOpen}
              onSeeLate={() => { setTodoOpen(false); setView("parcels"); onFilters({ state: "late", buckets: [], agents: [], page: 1 }); scrollToList(); }}
              onSeeStalled={() => { setTodoOpen(false); setView("parcels"); onFilters({ state: "stalled", buckets: [], page: 1 }); scrollToList(); }}
              onReassignAgent={reassignAgent}
              onAssignNone={(ids) => { setTodoOpen(false); setSheet({ kind: "reassign", orderIds: ids, fromAgentId: null }); }} />
            <div className="segc" role="tablist" aria-label={t("views.label")}>
              <button type="button" role="tab" aria-selected={view === "parcels"} className={view === "parcels" ? "on" : ""} onClick={() => setView("parcels")}>
                <Package className="ic" />{t("views.parcels")}<span className="cnt">{live.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={view === "couriers"} className={view === "couriers" ? "on" : ""} onClick={() => setView("couriers")}>
                <User className="ic" />{t("views.couriers")}<span className="cnt">{couriers.length}</span>
              </button>
            </div>
            <span className="glass" data-tip={t("targetTip")}><Target className="ic" />{t.rich("target", { h: targetHours, b: (c) => <b>{c}</b> })}</span>
          </div>
        </header>

        {error && rawRows === null ? (
          <section className="card empty">{tDel("loadError")} <button type="button" className="lnk" onClick={onRetry}>{tDel("retry")}</button></section>
        ) : rawRows === null ? (
          <>
            <div className="bks2">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 84 }} />)}</div>
            <div className="ags2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 64 }} />)}</div>
            <div className="skel" style={{ height: 420, borderRadius: 20 }} />
          </>
        ) : view === "couriers" ? (
          <CouriersView carriers={carriers} couriers={couriers} />
        ) : (
          <>
            <BucketStrip tiles={tiles} selected={filters.buckets} targetHours={targetHours} market={marketCode} locale={locale}
              onToggle={(b) => { onFilters({ buckets: toggle(filters.buckets, b), state: "live", page: 1 }); scrollToList(); }} />
            <TeamStrip cards={teamCards} selected={filters.agents}
              onToggle={(id) => { onFilters({ agents: toggle(filters.agents, id), page: 1 }); scrollToList(); }} />
            <ParcelList page={pageRows} total={filtered.length} stateCounts={stateCounts} filters={{ ...filters, page }} onFilters={onFilters}
              options={options} oneAgent={oneAgent} onReassignAgent={reassignAgent} late={late} colors={colors}
              selection={selection} onToggleSel={(id) => setSelection((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
              openId={openId} onOpen={setOpenId} nothingInFlight={all.filter((r) => r.bucket !== "done").length === 0}
              market={marketCode} locale={locale} tz={tz} now={now} />
          </>
        )}
      </div>

      {open ? (
        <ParcelDrawer key={open.order_id} row={open} late={late.has(open.order_id)} agentColor={open.assigned_to ? colors.get(open.assigned_to) ?? null : null}
          market={marketCode} locale={locale} tz={tz} now={now} marketId={props.marketId ?? null}
          whatsappActive={props.whatsappActive ?? false} whatsappKnown={props.whatsappKnown ?? false}
          onClose={() => setOpenId(null)} onLogAction={openAction} onWhatsApp={(r) => setSheet({ kind: "wa", orderId: r.order_id })}
          onDialed={(r) => openAction(r)} onQuick={onQuick}
          onReassign={(r) => setSheet({ kind: "reassign", orderIds: [r.order_id], fromAgentId: r.assigned_to })} />
      ) : null}

      {sheet?.kind === "reassign" ? (
        <ReassignDialog count={sheet.orderIds.length} agents={cards} fromId={sheet.fromAgentId} onClose={() => setSheet(null)}
          onGo={async (agentId) => {
            await props.onReassign(sheet.orderIds, agentId);
            setToast(t("reassign.moved", { n: sheet.orderIds.length, name: cards.find((c) => c.id === agentId)?.name ?? "" }));
            setSheet(null);
            setSelection(new Set());
            setOpenId(null);
          }} />
      ) : null}
      {sheet?.kind === "action" && sheetRow ? (
        <ActionSheet key={sheet.orderId} initialType={sheet.type} tz={tz} now={now}
          feedback={{ enabled: feedbackCapture.enabled, remark: sheetRow.latest_remark, remarkClass: sheetRow.remark_class, status: sheetRow.status, marketId: props.marketId ?? null }}
          onClose={() => setSheet(null)} onSubmit={(body) => { onQueue(sheetRow, body); setSheet(null); }} />
      ) : null}
      {sheet?.kind === "wa" && sheetRow ? (
        <WhatsAppSheet key={sheet.orderId} row={sheetRow} market={marketCode} marketId={props.marketId ?? null}
          whatsappActive={props.whatsappActive ?? false} whatsappKnown={props.whatsappKnown ?? false}
          onClose={() => setSheet(null)} onSent={(body) => { onQueue(sheetRow, body); if (!body.alreadyRecorded) setSheet(null); }} />
      ) : null}

      {selection.size > 0 ? (
        <div className="bulk" role="status">
          {t("bulk", { n: selection.size })}
          <button type="button" className="pri" onClick={() => setSheet({ kind: "reassign", orderIds: [...selection], fromAgentId: null })}><ArrowLeftRight className="ic" />{t("drawer.reassign")}</button>
          <button type="button" aria-label={t("reassign.cancel")} onClick={() => setSelection(new Set())}><X className="ic" /></button>
        </div>
      ) : pending || notice ? (
        <div className="bulk" role="status" aria-live="polite">
          <span className={`ok${notice === "failed" ? " bad" : ""}`}>{notice === "failed" ? <X className="ic" /> : <Check className="ic" />}</span>
          {pending
            ? `${pending.body.action_type === "whatsapp_customer" ? tDel("toast.waOpened") : tDel("toast.saved")}${pendingRow && pending.body.action_type !== "whatsapp_customer" ? ` · ${tDel("toast.moved", { bucket: tDel(`buckets.${pendingRow.bucket}`) })}` : ""}`
            : notice === "failed" ? tDel("toast.failed") : tDel("toast.undone")}
          {pending ? <button type="button" onClick={props.onUndo}>{tDel("toast.undo")}</button>
            : <button type="button" aria-label={tDel("toast.close")} onClick={props.onDismissNotice}><X className="ic" /></button>}
        </div>
      ) : toast ? (
        <div className="bulk" role="status"><span className="ok"><Check className="ic" /></span>{toast}</div>
      ) : null}

      <div ref={tipRef} className="dlb-tip" style={{ opacity: 0 }} />
    </div>
  );
}
