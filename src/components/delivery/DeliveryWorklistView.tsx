"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpDown, BarChart3, Check, ChevronDown, Moon, Package, Search, SlidersHorizontal, Truck, X } from "lucide-react";
import type { Role } from "@/types";
import type { Bucket, DeliveryScorecard, WorklistRow } from "@/lib/delivery/types";
import { BUCKET_ORDER, applyRecordedAction, countBuckets, partitionStalled, sumBuckets } from "@/lib/delivery/worklist";
import { BUCKET_TONE, moveFor, type QuickOutcome } from "@/lib/delivery/presentation";
import { inTwoHours, tomorrowAt } from "@/lib/delivery/schedule";
import { normalizePhone } from "@/lib/leads/phone";
import type { PendingAction, QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { DeliveryRow } from "./DeliveryRow";
import { DeliveryDetailPanel, DeliveryDetailScreen } from "./DeliveryDetail";
import { ActionSheet, WhatsAppSheet } from "./Sheets";
import { OUTLINE_BTN, TONE, moneyText } from "./ui";

export interface DeliveryWorklistViewProps {
  /** null while the first load is in flight. */
  rows: WorklistRow[] | null;
  error: boolean;
  onRetry: () => void;
  scorecard: DeliveryScorecard | null;
  role: Role;
  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
  pending: PendingAction | null;
  notice: "undone" | "failed" | null;
  onQueue: (row: WorklistRow, body: QueuedBody) => void;
  onUndo: () => void;
  onDismissNotice: () => void;
}

type Sheet =
  | { kind: "action"; orderId: string; type: "call_customer" | "call_courier" | "call_branch" | "note" }
  | { kind: "wa"; orderId: string };

type Sort = "priority" | "amount" | "oldest";

const isDesktop = () =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1024px)").matches;

function matches(row: WorklistRow, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const digits = text.replace(/\D/g, "");
  const hay = [row.customer_name, row.customer_city, row.customer_address, row.external_id, row.tracking_number]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(text)) return true;
  return digits.length >= 3 && [row.customer_phone, row.customer_phone_2].some((p) => p && normalizePhone(p).includes(digits.replace(/^0/, "")));
}

/**
 * "Suivi livraison" — the post-upload worklist. Pure: data, clock and the
 * action queue come in as props, so every state of the page is testable.
 */
export function DeliveryWorklistView(props: DeliveryWorklistViewProps) {
  const { rows: rawRows, error, onRetry, scorecard, role, marketCode, tz, locale, now, pending, notice, onQueue, onUndo, onDismissNotice } = props;
  const t = useTranslations("delivery");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [riskyOnly, setRiskyOnly] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [showStalled, setShowStalled] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // A pending action is shown as already applied, even if a refresh lands
  // inside the undo window with the server's (older) view of the row.
  const rows = useMemo(
    () => rawRows?.map((r) => (pending && r.order_id === pending.orderId ? applyRecordedAction(r, pending.body, now) : r)) ?? null,
    [rawRows, pending, now],
  );
  const counts = useMemo(() => countBuckets(rows ?? []), [rows]);
  const sums = useMemo(() => sumBuckets(rows ?? []), [rows]);
  const visible = useMemo(
    () => (rows ?? [])
      .filter((r) => bucket === "all" || r.bucket === bucket)
      .filter((r) => !riskyOnly || r.is_risky)
      .filter((r) => !hideDone || r.bucket !== "done")
      .filter((r) => matches(r, query))
      .sort((a, b) =>
        sort === "amount" ? (b.total_price ?? 0) - (a.total_price ?? 0)
        : sort === "oldest" ? Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "")
        : BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)),
    [rows, bucket, riskyOnly, hideDone, query, sort],
  );
  // Parcels the carrier abandoned months ago are set aside: left in place they
  // are most of what an agent sees, and the parcel that needs a call today is
  // lost among them.
  const { live, stalled } = useMemo(() => partitionStalled(visible, now), [visible, now]);
  const shown = useMemo(() => (showStalled ? [...live, ...stalled] : live), [live, stalled, showStalled]);
  const oldestStall = stalled.length > 0 ? Math.round((stalled[0].hours_on_status ?? 0) / 24) : 0;

  const selected = rows?.find((r) => r.order_id === selectedId) ?? null;
  const byId = useCallback((id: string) => rows?.find((r) => r.order_id === id) ?? null, [rows]);

  // Desktop opens on the first parcel.
  useEffect(() => {
    if (!selectedId && shown.length > 0 && isDesktop()) setSelectedId(shown[0].order_id);
  }, [selectedId, shown]);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [filterOpen]);

  const select = useCallback((row: WorklistRow) => {
    setSelectedId(row.order_id);
    if (!isDesktop()) setMobileOpen(true);
  }, []);
  const openAction = useCallback((row: WorklistRow, type?: "call_customer" | "call_courier" | "call_branch" | "note") => {
    setSelectedId(row.order_id);
    setSheet({ kind: "action", orderId: row.order_id, type: type ?? moveFor(row, now).actionType ?? "call_customer" } as Sheet);
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
  // One tap on an outcome tile records the call with the reminder that
  // outcome implies; no sheet, the note can follow later if needed.
  const onQuick = useCallback((row: WorklistRow, q: QuickOutcome) => {
    const next = q.reminder === "in2h" ? inTwoHours(now) : q.reminder === "tomorrow10" ? tomorrowAt(now, tz, 10) : null;
    onQueue(row, { action_type: q.actionType, outcome: q.outcome, note: null, next_action_at: next, template_key: null });
  }, [now, tz, onQueue]);

  const sheetRow = sheet ? byId(sheet.orderId) : null;
  const inFlight = counts.all - counts.done;
  const showAgent = role !== "agent";
  const handlers = { onLogAction: openAction, onWhatsApp: openWhatsApp, onDialed: (row: WorklistRow) => openAction(row), onQuick };
  const pendingRow = pending ? byId(pending.orderId) : null;
  const filtersOn = riskyOnly || hideDone;

  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 pb-10 pt-4 text-start lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-4 lg:px-5 lg:pt-4 2xl:grid-cols-[minmax(0,1fr)_440px]">
      <section className="min-w-0">
        {/* Title row: name, count, the 30-day pill, then search / filter / sort. */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-start gap-2.5">
            <Truck size={30} strokeWidth={1.9} className="mt-1 hidden shrink-0 text-[#15803D] lg:block" aria-hidden />
            <div>
              <h1 className="text-[22px] font-bold tracking-tight text-[#111827] lg:text-[26px] lg:leading-tight">{t("title")}</h1>
              <p className="mt-0.5 text-sm text-[#6B7280]">{t("sub", { n: inFlight })}</p>
            </div>
          </div>
          {scorecard && scorecard.delivery_rate !== null && (
            <span data-testid="delivery-stat"
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-[#E5E7EB] bg-white px-3.5 text-[13px] text-[#374151]">
              <BarChart3 size={16} className="text-[#15803D]" aria-hidden />
              <span>{t.rich("stat", { rate: scorecard.delivery_rate, saved: scorecard.saved, b: (c) => <b className="font-semibold text-[#111827] tabular-nums">{c}</b> })}</span>
            </span>
          )}
          <div className="ms-auto hidden items-center gap-2 lg:flex">
            <label className="flex h-11 w-[300px] items-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-[#6B7280] focus-within:border-[#15803D]">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")}
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#111827] outline-none placeholder:text-[#9CA3AF]" />
              <Search size={17} aria-hidden />
            </label>
            <div ref={filterRef} className="relative">
              <button type="button" aria-expanded={filterOpen} aria-haspopup="true" onClick={() => setFilterOpen((v) => !v)}
                className={`h-11 px-3.5 text-[13.5px] ${OUTLINE_BTN} ${filtersOn ? "border-[#15803D] text-[#15803D]" : "border-[#E5E7EB]"}`}>
                <SlidersHorizontal size={16} aria-hidden />{t("filter.label")}
              </button>
              {filterOpen && (
                <div className="absolute end-0 top-full z-20 mt-1.5 w-[240px] rounded-lg border border-[#E5E7EB] bg-white p-2 shadow-[0_8px_24px_rgba(17,24,39,0.10)]">
                  {([["risky", riskyOnly, setRiskyOnly, t("filter.riskyOnly")], ["done", hideDone, setHideDone, t("filter.hideDone")]] as const).map(([k, on, set, l]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-[13.5px] text-[#111827] hover:bg-[#F3F4F6]">
                      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[#15803D]" />
                      {l}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <label className={`relative h-11 ps-3.5 pe-2.5 text-[13.5px] ${OUTLINE_BTN} border-[#E5E7EB] cursor-pointer`}>
              <ArrowUpDown size={16} aria-hidden />
              <span>{t("sort.label")}</span>
              <select aria-label={t("sort.label")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}
                className="absolute inset-0 cursor-pointer opacity-0">
                {(["priority", "amount", "oldest"] as Sort[]).map((k) => <option key={k} value={k}>{t(`sort.${k}`)}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Bucket bar: one segmented strip, act-now carries its tint. */}
        <div role="group" aria-label={t("filters")}
          className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-6 lg:gap-0 lg:overflow-visible lg:rounded-lg lg:border lg:border-[#E5E7EB] lg:bg-white lg:px-0">
          {(["all", ...BUCKET_ORDER] as const).map((k, i) => {
            const on = bucket === k;
            const tone = k === "all" ? null : BUCKET_TONE[k];
            const tint = k === "act_now" ? "lg:bg-[#FFFBEB]" : on ? "lg:bg-[#F9FAFB]" : "";
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setBucket(k)}
                className={[
                  "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[14.5px]",
                  "lg:h-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:rounded-none lg:border-0 lg:px-3.5 lg:py-2.5 lg:text-[13.5px]",
                  i > 0 ? "lg:border-s lg:border-s-[#E5E7EB]" : "",
                  i === 0 ? "lg:rounded-s-lg" : i === 5 ? "lg:rounded-e-lg" : "",
                  on ? "border-[#111111] bg-[#111111] font-semibold text-white lg:text-[#111827]" : "border-[#E5E7EB] bg-white text-[#374151]",
                  tint,
                ].join(" ")}>
                <span className="flex items-center gap-2">
                  {tone && <span aria-hidden className={`hidden h-2 w-2 shrink-0 rounded-full lg:inline-block ${TONE[tone].dot}`} />}
                  <span className={`truncate ${on ? "lg:font-bold" : "lg:font-medium"}`}>{t(`buckets.${k}`)}</span>
                  <b className={`ms-auto font-bold tabular-nums ${on ? "text-white lg:text-[#111827]" : "text-[#111827]"}`}>{counts[k]}</b>
                </span>
                <span className={`hidden text-[12.5px] tabular-nums lg:block ${on ? "text-[#374151]" : "text-[#6B7280]"}`}>{moneyText(sums[k], marketCode, locale)}</span>
              </button>
            );
          })}
        </div>

        <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_96px] gap-4 px-4 pb-1.5 pt-1 text-[12px] font-medium text-[#6B7280] lg:grid lg:ps-5" aria-hidden>
          <span>{t("cols.client")}</span><span>{t("cols.situation")}</span><span>{t("cols.action")}</span><span className="text-end">{t("cols.amount")}</span>
        </div>

        <div role="list" aria-label={t("title")} aria-busy={rows === null && !error}>
          {error && rows === null ? (
            <div className="rounded-xl border border-[#E5E7EB] bg-white px-5 py-10 text-center">
              <p className="mb-3 text-[15px] text-[#111827]">{t("loadError")}</p>
              <button type="button" onClick={onRetry} className={`h-10 px-4 text-sm ${OUTLINE_BTN} border-[#D1D5DB]`}>{t("retry")}</button>
            </div>
          ) : rows === null ? (
            [0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="mb-2 h-[92px] animate-pulse rounded-xl border border-[#E5E7EB] bg-white" />
            ))
          ) : shown.length === 0 && stalled.length === 0 ? (
            <div className="px-5 py-16 text-center text-[#6B7280]">
              <Package size={44} strokeWidth={1.5} className="mx-auto text-[#D1D5DB]" aria-hidden />
              <h3 className="mb-1 mt-3 text-base font-semibold text-[#111827]">{t("empty.title")}</h3>
              <p className="mb-3.5">{t("empty.sub")}</p>
              {(bucket !== "all" || query || filtersOn) && (
                <button type="button" onClick={() => { setBucket("all"); setQuery(""); setRiskyOnly(false); setHideDone(false); }} className={`h-10 px-4 text-sm ${OUTLINE_BTN} border-[#D1D5DB]`}>
                  {t("empty.all")}
                </button>
              )}
            </div>
          ) : (
            shown.map((row) => (
              <DeliveryRow key={row.order_id} row={row} selected={row.order_id === selectedId} showAgent={showAgent}
                market={marketCode} locale={locale} tz={tz} now={now}
                onSelect={select} onMove={onMove} onWhatsApp={openWhatsApp} />
            ))
          )}
        </div>

        {stalled.length > 0 && rows !== null && (
          <button
            type="button"
            aria-expanded={showStalled}
            onClick={() => setShowStalled((v) => !v)}
            className={`flex w-full items-center gap-3 rounded-[10px] border border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-4 py-3 text-start hover:bg-[#F3F4F6] ${showStalled ? "mb-2 mt-1" : "mt-1"}`}
          >
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

      <aside className="hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-96px)]">
        <div role="region" aria-label={t("detail.title")} className="h-full">
          {selected ? (
            <DeliveryDetailPanel row={selected} market={marketCode} locale={locale} tz={tz} now={now} onClose={() => setSelectedId(null)} {...handlers} />
          ) : (
            <div className="grid h-full place-items-center rounded-xl border border-[#E5E7EB] bg-white p-10 text-center text-[#6B7280]">{t("pick")}</div>
          )}
        </div>
      </aside>

      {mobileOpen && selected && (
        <DeliveryDetailScreen row={selected} market={marketCode} locale={locale} tz={tz} now={now} onBack={() => setMobileOpen(false)} {...handlers} />
      )}

      {sheet?.kind === "action" && sheetRow && (
        <ActionSheet key={sheet.orderId} initialType={sheet.type} tz={tz} now={now}
          onClose={() => setSheet(null)}
          onSubmit={(body) => { onQueue(sheetRow, body); setSheet(null); }} />
      )}
      {sheet?.kind === "wa" && sheetRow && (
        <WhatsAppSheet key={sheet.orderId} row={sheetRow} market={marketCode}
          onClose={() => setSheet(null)}
          onSent={(body) => { onQueue(sheetRow, body); setSheet(null); }} />
      )}

      {(pending || notice) && (
        <div role="status" aria-live="polite"
          className="fixed inset-x-3 bottom-4 z-[80] flex items-center gap-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5 shadow-[0_10px_30px_rgba(17,24,39,0.14)] lg:inset-x-auto lg:end-5 lg:bottom-5 lg:min-w-[380px] lg:rounded-[10px] lg:border-0 lg:bg-[#111111] lg:py-3 lg:text-white">
          <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-white ${notice === "failed" ? "bg-[#B91C1C]" : "bg-[#15803D] lg:bg-[#22C55E]"}`}>
            {notice === "failed" ? <X size={15} strokeWidth={2.6} aria-hidden /> : <Check size={15} strokeWidth={2.6} aria-hidden />}
          </span>
          <span className="min-w-0">
            <b className="block text-[15px] font-semibold">
              {pending ? (pending.body.action_type === "whatsapp_customer" ? t("toast.waOpened") : t("toast.saved")) : notice === "failed" ? t("toast.failed") : t("toast.undone")}
            </b>
            {pending && (
              <small className="block text-[13px] text-[#6B7280] lg:text-[#B6BCC6]">
                {pending.body.action_type === "whatsapp_customer" ? t("toast.waSub") : pendingRow ? t("toast.moved", { bucket: t(`buckets.${pendingRow.bucket}`) }) : null}
              </small>
            )}
          </span>
          {pending ? (
            <button type="button" onClick={onUndo} className="ms-auto text-sm font-semibold text-[#15803D] underline-offset-4 lg:text-white lg:underline">{t("toast.undo")}</button>
          ) : (
            <button type="button" onClick={onDismissNotice} aria-label={t("toast.close")} className="ms-auto text-[#6B7280] lg:text-[#B6BCC6]"><X size={16} aria-hidden /></button>
          )}
          {pending && <span key={pending.orderId + pending.body.action_type} aria-hidden className="absolute bottom-0 start-0 h-0.5 animate-[delivery-undo_5s_linear_forwards] bg-[#15803D] lg:bg-[#22C55E]" />}
        </div>
      )}
    </div>
  );
}
