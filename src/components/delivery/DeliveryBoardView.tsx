"use client";

/**
 * « Suivi livraison » — the manager and super_admin screen.
 *
 * Same parcels, same rows, same chips and same detail panel as the agent's
 * screen; what a manager adds is scope. The agents strip narrows the list to
 * one person, the right panel is the market cockpit until a parcel is opened,
 * and rows can be selected and moved to another agent.
 *
 * Design: prototypes/suivi-livraison-manager-v1.html. Arithmetic:
 * src/lib/delivery/board.ts. Pure — data, clock and mutations come in as
 * props, so every state of the page is testable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpDown, Check, ChevronDown, Moon, Package, Search, Truck, X } from "lucide-react";
import type { Role } from "@/types";
import type { Bucket, DeliveryBoardAgent, WorklistRow } from "@/lib/delivery/types";
import { BUCKET_ORDER, applyRecordedAction, countBuckets, partitionStalled, sumBuckets } from "@/lib/delivery/worklist";
import { BUCKET_TONE, moveFor, type QuickOutcome } from "@/lib/delivery/presentation";
import { agentBoard, agentsFromRows, carrierBoard, courierBoard, marketSummary, type AgentBoard, type AgentActivity, type AgentRef } from "@/lib/delivery/board";
import { inTwoHours, tomorrowAt } from "@/lib/delivery/schedule";
import { normalizePhone } from "@/lib/leads/phone";
import type { PendingAction, QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { DeliveryRow } from "./DeliveryRow";
import { DeliveryDetailPanel } from "./DeliveryDetail";
import { DeliveryCockpit, DeliveryAgentsStrip, type CockpitTab } from "./DeliveryCockpit";
import { ReassignSheet } from "./ReassignSheet";
import { ActionSheet, WhatsAppSheet } from "./Sheets";
import { Money, OUTLINE_BTN, TONE } from "./ui";

type Sheet =
  | { kind: "action"; orderId: string; type: "call_customer" | "call_courier" | "call_branch" | "note" }
  | { kind: "wa"; orderId: string }
  | { kind: "reassign"; orderIds: string[]; fromAgentId: string | null };

type Sort = "priority" | "amount" | "oldest";

export interface DeliveryBoardViewProps {
  /** null while the first load is in flight. */
  rows: WorklistRow[] | null;
  error: boolean;
  onRetry: () => void;
  /** Per-agent activity from the ledger; empty until the board call lands. */
  activity: DeliveryBoardAgent[];
  targetHours: number;
  role: Role;
  marketCode: "ly" | "tn";
  marketLabel: string;
  tz: string;
  locale: string;
  now: number;
  pending: PendingAction | null;
  notice: "undone" | "failed" | null;
  onQueue: (row: WorklistRow, body: QueuedBody) => void;
  onUndo: () => void;
  onDismissNotice: () => void;
  onNeedDone?: () => void;
  /** Moves parcels to another agent; resolves once the server has answered. */
  onReassign: (orderIds: string[], targetAgentId: string) => Promise<void>;
}

function matches(row: WorklistRow, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const digits = text.replace(/\D/g, "");
  const hay = [row.customer_name, row.customer_city, row.customer_address, row.external_id, row.tracking_number, row.agent_name]
    .filter(Boolean).join(" ").toLowerCase();
  if (hay.includes(text)) return true;
  return digits.length >= 3 && [row.customer_phone, row.customer_phone_2].some((p) => p && normalizePhone(p).includes(digits.replace(/^0/, "")));
}

export function DeliveryBoardView(props: DeliveryBoardViewProps) {
  const {
    rows: rawRows, error, onRetry, activity, targetHours, role, marketCode, marketLabel, tz, locale, now,
    pending, notice, onQueue, onUndo, onDismissNotice, onNeedDone, onReassign,
  } = props;
  const t = useTranslations("delivery");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [tab, setTab] = useState<CockpitTab>("team");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [showStalled, setShowStalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => rawRows?.map((r) => (pending && r.order_id === pending.orderId ? applyRecordedAction(r, pending.body, now) : r)) ?? null,
    [rawRows, pending, now],
  );
  const all = useMemo(() => rows ?? [], [rows]);

  // The roster comes from the board call; a market whose board has not landed
  // yet still shows the agents its parcels name, so the strip is never empty.
  const agents: AgentRef[] = useMemo(
    () => (activity.length > 0 ? activity.map((a) => ({ id: a.agent_id, name: a.name })) : agentsFromRows(all)),
    [activity, all],
  );
  const activities: AgentActivity[] = useMemo(
    () => activity.map(({ name: _name, ...a }) => a),
    [activity],
  );
  const summary = useMemo(() => marketSummary(all, agents, activities, targetHours, now), [all, agents, activities, targetHours, now]);
  const boards = useMemo(() => [...summary.late, ...summary.idle, ...summary.ok].sort((a, b) => a.name.localeCompare(b.name)), [summary]);
  const openAgent = useMemo(() => {
    if (!agentId) return null;
    const ref = agents.find((a) => a.id === agentId);
    return ref ? agentBoard(all, ref, activities.find((x) => x.agent_id === agentId) ?? null, targetHours, now) : null;
  }, [agentId, agents, all, activities, targetHours, now]);

  // Counts follow the agent filter, so the buckets describe what is on screen.
  const scoped = useMemo(() => (agentId ? all.filter((r) => r.assigned_to === agentId) : all), [all, agentId]);
  const counts = useMemo(() => countBuckets(scoped), [scoped]);
  const sums = useMemo(() => sumBuckets(scoped), [scoped]);

  const visible = useMemo(
    () => scoped
      .filter((r) => bucket === "all" || r.bucket === bucket)
      .filter((r) => matches(r, query))
      .sort((a, b) =>
        sort === "amount" ? (b.total_price ?? 0) - (a.total_price ?? 0)
        : sort === "oldest" ? Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "")
        : BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)),
    [scoped, bucket, query, sort],
  );
  const { live, stalled } = useMemo(() => partitionStalled(visible, now), [visible, now]);
  const shown = useMemo(() => (showStalled ? [...live, ...stalled] : live), [live, stalled, showStalled]);
  const oldestStall = stalled.length > 0 ? Math.round((stalled[0].hours_on_status ?? 0) / 24) : 0;

  const couriers = useMemo(() => courierBoard(scoped), [scoped]);
  const carriers = useMemo(() => carrierBoard(scoped), [scoped]);

  const selected = rows?.find((r) => r.order_id === selectedId) ?? null;
  const byId = useCallback((id: string) => rows?.find((r) => r.order_id === id) ?? null, [rows]);

  // A manager opens on the cockpit, not on a parcel: the question they came
  // with is "how is the team doing", not "what about this one customer".
  const select = useCallback((row: WorklistRow) => setSelectedId(row.order_id), []);
  const openAction = useCallback((row: WorklistRow, type?: "call_customer" | "call_courier" | "call_branch" | "note") => {
    setSelectedId(row.order_id);
    // A WhatsApp move has its own sheet; the action sheet only ever opens on
    // one of the three calls or a bare note.
    const suggested = moveFor(row, now).actionType;
    const fallback = suggested && suggested !== "whatsapp_customer" ? suggested : "call_customer";
    setSheet({ kind: "action", orderId: row.order_id, type: type ?? fallback });
  }, [now]);
  const openWhatsApp = useCallback((row: WorklistRow) => {
    setSelectedId(row.order_id);
    setSheet({ kind: "wa", orderId: row.order_id });
  }, []);
  const onMove = useCallback((row: WorklistRow) => {
    const m = moveFor(row, now);
    if (m.whatsapp) openWhatsApp(row);
    else if (m.actionType) openAction(row, m.actionType === "whatsapp_customer" ? undefined : m.actionType);
    else select(row);
  }, [now, openAction, openWhatsApp, select]);
  const onQuick = useCallback((row: WorklistRow, q: QuickOutcome) => {
    const next = q.reminder === "in2h" ? inTwoHours(now) : q.reminder === "tomorrow10" ? tomorrowAt(now, tz, 10) : null;
    onQueue(row, { action_type: q.actionType, outcome: q.outcome, note: null, next_action_at: next, template_key: null });
  }, [now, tz, onQueue]);

  const toggleSelect = useCallback((orderId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || sheet) return;
      if (selection.size > 0) setSelection(new Set());
      else if (selectedId) setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet, selection.size, selectedId]);

  const pickAgent = useCallback((id: string | null) => {
    setAgentId(id);
    setSelectedId(null);
    setTab("team");
  }, []);

  const openParcelFromCockpit = useCallback((row: WorklistRow) => {
    setSelectedId(row.order_id);
    listRef.current?.querySelector(`[data-order-id="${row.order_id}"]`)?.scrollIntoView({ block: "nearest" });
  }, []);

  const sheetRow = sheet && sheet.kind !== "reassign" ? byId(sheet.orderId) : null;
  const reassignRows = sheet?.kind === "reassign" ? sheet.orderIds.map(byId).filter(Boolean) as WorklistRow[] : [];

  const confirmReassign = useCallback(async (targetAgentId: string) => {
    if (sheet?.kind !== "reassign") return;
    setBusy(true);
    setSheetError(null);
    try {
      await onReassign(sheet.orderIds, targetAgentId);
      setSheet(null);
      setSelection(new Set());
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : t("reassign.failed"));
    } finally {
      setBusy(false);
    }
  }, [sheet, onReassign, t]);

  const inFlight = counts.all - counts.done;
  const pendingRow = pending ? byId(pending.orderId) : null;
  const handlers = { onLogAction: openAction, onWhatsApp: openWhatsApp, onDialed: (row: WorklistRow) => openAction(row), onQuick };

  return (
    <div className={`mx-auto w-full max-w-[1560px] px-4 pb-10 pt-4 text-start lg:px-5 ${locale === "ar" ? "font-cairo" : ""}`}>
      {/* Title, scope, tools */}
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="flex items-start gap-2.5">
          <Truck size={30} strokeWidth={1.9} className="mt-1 hidden shrink-0 text-[#15803D] lg:block" aria-hidden />
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-[#111827] lg:text-[26px] lg:leading-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-[#6B7280]">{t("board.sub", { n: inFlight, agents: agents.length })}</p>
          </div>
        </div>
        <div className="ms-auto hidden items-center gap-2 lg:flex">
          <label className="flex h-11 w-[300px] items-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-[#6B7280] focus-within:border-[#15803D]">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("board.search")}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#111827] outline-none placeholder:text-[#9CA3AF]" />
            <Search size={17} aria-hidden />
          </label>
          <label className={`relative h-11 ps-3.5 pe-2.5 text-[13.5px] ${OUTLINE_BTN} border-[#E5E7EB] cursor-pointer`}>
            <ArrowUpDown size={16} aria-hidden /><span>{t("sort.label")}</span>
            <select aria-label={t("sort.label")} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="absolute inset-0 cursor-pointer opacity-0">
              {(["priority", "amount", "oldest"] as Sort[]).map((k) => <option key={k} value={k}>{t(`sort.${k}`)}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Buckets */}
      <div role="group" aria-label={t("filters")} className="mb-2.5 grid grid-cols-2 gap-0 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white sm:grid-cols-3 lg:grid-cols-6">
        {(["all", ...BUCKET_ORDER] as const).map((k, i) => {
          const on = bucket === k;
          const tone = k === "all" ? null : BUCKET_TONE[k];
          return (
            <button key={k} type="button" aria-pressed={on}
              onClick={() => { setBucket(k); if (k === "done" || k === "all") onNeedDone?.(); }}
              className={`flex flex-col gap-0.5 px-3.5 py-2.5 text-start text-[13px] ${i > 0 ? "border-s border-[#E5E7EB]" : ""} ${k === "act_now" && !on ? "bg-[#FFFBEB]" : ""} ${on ? "bg-[#F0FDF4] shadow-[inset_0_-3px_0_#15803D]" : ""}`}>
              <span className={`flex items-center gap-2 whitespace-nowrap ${on ? "font-bold text-[#111827]" : "font-medium text-[#374151]"}`}>
                {tone && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TONE[tone].dot}`} />}
                <span className="truncate">{t(`buckets.${k}`)}</span>
              </span>
              <span className="text-[20px] font-bold leading-tight tabular-nums text-[#111827]">{counts[k]}</span>
              <Money amount={sums[k]} market={marketCode} locale={locale} className="text-[12.5px] text-[#6B7280]" />
            </button>
          );
        })}
      </div>

      <DeliveryAgentsStrip boards={boards} selected={agentId} totalToTreat={summary.toTreat} onPick={pickAgent} />

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_450px]">
        <section className="min-w-0">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(200px,auto)_minmax(88px,auto)] gap-4 px-4 pb-1.5 pt-1 text-[12px] font-medium text-[#6B7280] lg:grid lg:ps-9" aria-hidden>
            <span>{t("cols.client")}</span><span>{t("cols.situation")}</span><span>{t("cols.action")}</span><span className="text-end">{t("cols.amount")}</span>
          </div>

          <div ref={listRef} role="list" aria-label={t("title")} aria-busy={rows === null && !error}>
            {error && rows === null ? (
              <div className="rounded-xl border border-[#E5E7EB] bg-white px-5 py-10 text-center">
                <p className="mb-3 text-[15px] text-[#111827]">{t("loadError")}</p>
                <button type="button" onClick={onRetry} className={`h-10 px-4 text-sm ${OUTLINE_BTN} border-[#D1D5DB]`}>{t("retry")}</button>
              </div>
            ) : rows === null ? (
              [0, 1, 2, 3, 4].map((i) => <div key={i} className="mb-2 h-[92px] animate-pulse rounded-xl border border-[#E5E7EB] bg-white" />)
            ) : shown.length === 0 && stalled.length === 0 ? (
              <div className="px-5 py-16 text-center text-[#6B7280]">
                <Package size={44} strokeWidth={1.5} className="mx-auto text-[#D1D5DB]" aria-hidden />
                <h3 className="mb-1 mt-3 text-base font-semibold text-[#111827]">{t("empty.title")}</h3>
                <p className="mb-3.5">{t("empty.sub")}</p>
                {(bucket !== "all" || query || agentId) && (
                  <button type="button" onClick={() => { setBucket("all"); setQuery(""); pickAgent(null); }} className={`h-10 px-4 text-sm ${OUTLINE_BTN} border-[#D1D5DB]`}>
                    {t("empty.all")}
                  </button>
                )}
              </div>
            ) : (
              shown.map((row) => (
                <div key={row.order_id} data-order-id={row.order_id} className="relative">
                  {row.bucket !== "done" && (
                    <button type="button" role="checkbox" aria-checked={selection.has(row.order_id)}
                      aria-label={t("board.select", { name: row.customer_name ?? "" })}
                      onClick={() => toggleSelect(row.order_id)}
                      className={`absolute start-2 top-1/2 z-10 grid h-[18px] w-[18px] -translate-y-1/2 place-items-center rounded-[5px] border-[1.5px] bg-white text-white ${
                        selection.has(row.order_id) ? "border-[#15803D] !bg-[#15803D]" : "border-[#9CA3AF] hover:border-[#15803D]"
                      }`}>
                      {selection.has(row.order_id) && <Check size={12} strokeWidth={3} aria-hidden />}
                    </button>
                  )}
                  <div className="lg:ps-4">
                    <DeliveryRow row={row} selected={row.order_id === selectedId} showAgent={!agentId}
                      market={marketCode} locale={locale} tz={tz} now={now}
                      onSelect={select} onMove={onMove} onWhatsApp={openWhatsApp} />
                  </div>
                </div>
              ))
            )}
          </div>

          {stalled.length > 0 && rows !== null && (
            <button type="button" aria-expanded={showStalled} onClick={() => setShowStalled((v) => !v)}
              className={`flex w-full items-center gap-3 rounded-[10px] border border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-4 py-3 text-start hover:bg-[#F3F4F6] ${showStalled ? "mb-2 mt-1" : "mt-1"}`}>
              <Moon size={18} className="shrink-0 text-[#9CA3AF]" aria-hidden />
              <span className="min-w-0">
                <b className="block text-[14px] font-semibold text-[#374151]">{t("stalledGroup", { n: stalled.length })}</b>
                <small className="block text-[12.5px] text-[#6B7280]">{t("stalledSince", { days: oldestStall })}</small>
              </span>
              <span className="ms-auto flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[#374151]">
                {showStalled ? t("stalledHide") : t("stalledShow")}
                <ChevronDown size={16} aria-hidden className={showStalled ? "rotate-180" : ""} />
              </span>
            </button>
          )}
        </section>

        <aside className="hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-120px)]">
          {selected ? (
            <DeliveryDetailPanel row={selected} market={marketCode} locale={locale} tz={tz} now={now} onClose={() => setSelectedId(null)} {...handlers} />
          ) : (
            <DeliveryCockpit
              tab={tab} onTab={setTab} summary={summary} agent={openAgent}
              couriers={couriers} carriers={carriers} marketLabel={marketLabel} locale={locale} now={now}
              onPickAgent={pickAgent} onOpenParcel={openParcelFromCockpit}
              onAbsent={(a) => {
                const ids = all.filter((r) => r.assigned_to === a.id && r.bucket !== "done").map((r) => r.order_id);
                if (ids.length > 0) { setSheetError(null); setSheet({ kind: "reassign", orderIds: ids, fromAgentId: a.id }); }
              }}
              onCall={(phone) => { window.location.href = `tel:${phone}`; }}
            />
          )}
        </aside>
      </div>

      {/* Selection bar */}
      {selection.size > 0 && (
        <div role="status" className="fixed inset-x-0 bottom-5 z-[70] mx-auto flex w-max max-w-[calc(100%-40px)] items-center gap-3 rounded-xl bg-[#111111] px-4 py-2.5 text-[14px] text-white shadow-[0_8px_24px_rgba(16,24,40,0.18)]">
          <b className="font-semibold">{t("board.nSelected", { n: selection.size })}</b>
          <button type="button" onClick={() => { setSheetError(null); setSheet({ kind: "reassign", orderIds: [...selection], fromAgentId: null }); }}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#15803D] px-3.5 font-semibold hover:bg-[#166534]">
            {t("reassign.action")}
          </button>
          <button type="button" onClick={() => setSelection(new Set())} aria-label={t("reassign.cancel")}
            className="grid h-8 w-8 place-items-center rounded-lg text-[#B6BCC6] hover:bg-white/10 hover:text-white">
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      {sheet?.kind === "action" && sheetRow && (
        <ActionSheet key={sheet.orderId} initialType={sheet.type} tz={tz} now={now}
          onClose={() => setSheet(null)} onSubmit={(body) => { onQueue(sheetRow, body); setSheet(null); }} />
      )}
      {sheet?.kind === "wa" && sheetRow && (
        <WhatsAppSheet key={sheet.orderId} row={sheetRow} market={marketCode}
          onClose={() => setSheet(null)} onSent={(body) => { onQueue(sheetRow, body); setSheet(null); }} />
      )}
      {sheet?.kind === "reassign" && (
        <ReassignSheet rows={reassignRows} agents={boards} market={marketCode} locale={locale}
          busy={busy} error={sheetError} onClose={() => setSheet(null)} onConfirm={confirmReassign} />
      )}

      {(pending || notice) && (
        <div role="status" aria-live="polite"
          className="fixed end-5 bottom-5 z-[80] flex min-w-[380px] items-center gap-3 overflow-hidden rounded-[10px] bg-[#111111] px-4 py-3 text-white shadow-[0_10px_30px_rgba(17,24,39,0.14)]">
          <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full ${notice === "failed" ? "bg-[#B91C1C]" : "bg-[#22C55E]"}`}>
            {notice === "failed" ? <X size={15} strokeWidth={2.6} aria-hidden /> : <Check size={15} strokeWidth={2.6} aria-hidden />}
          </span>
          <span className="min-w-0">
            <b className="block text-[15px] font-semibold">
              {pending ? (pending.body.action_type === "whatsapp_customer" ? t("toast.waOpened") : t("toast.saved")) : notice === "failed" ? t("toast.failed") : t("toast.undone")}
            </b>
            {pending && (
              <small className="block text-[13px] text-[#B6BCC6]">
                {pending.body.action_type === "whatsapp_customer" ? t("toast.waSub") : pendingRow ? t("toast.moved", { bucket: t(`buckets.${pendingRow.bucket}`) }) : null}
              </small>
            )}
          </span>
          {pending ? (
            <button type="button" onClick={onUndo} className="ms-auto text-sm font-semibold text-white underline underline-offset-4">{t("toast.undo")}</button>
          ) : (
            <button type="button" onClick={onDismissNotice} aria-label={t("toast.close")} className="ms-auto text-[#B6BCC6]"><X size={16} aria-hidden /></button>
          )}
        </div>
      )}
    </div>
  );
}
