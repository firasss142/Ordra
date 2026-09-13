"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BarChart3, Check, ChevronDown, Moon, Package, Search, X } from "lucide-react";
import type { Role } from "@/types";
import type { Bucket, DeliveryScorecard, WorklistRow } from "@/lib/delivery/types";
import { BUCKET_ORDER, applyRecordedAction, countBuckets, partitionStalled } from "@/lib/delivery/worklist";
import { BUCKET_TONE, moveFor } from "@/lib/delivery/presentation";
import { normalizePhone } from "@/lib/leads/phone";
import type { PendingAction, QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { DeliveryRow } from "./DeliveryRow";
import { DeliveryDetailPanel, DeliveryDetailScreen } from "./DeliveryDetail";
import { ActionSheet, WhatsAppSheet } from "./Sheets";
import { TONE } from "./ui";

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
 * "Suivi livraison" — the post-upload worklist, as approved in
 * prototypes/suivi-livraison-v1.html (v3). Pure: data, clock and the action
 * queue come in as props, so every state of the page is testable.
 */
export function DeliveryWorklistView(props: DeliveryWorklistViewProps) {
  const { rows: rawRows, error, onRetry, scorecard, role, marketCode, tz, locale, now, pending, notice, onQueue, onUndo, onDismissNotice } = props;
  const t = useTranslations("delivery");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [showStalled, setShowStalled] = useState(false);

  // A pending action is shown as already applied, even if a refresh lands
  // inside the undo window with the server's (older) view of the row.
  const rows = useMemo(
    () => rawRows?.map((r) => (pending && r.order_id === pending.orderId ? applyRecordedAction(r, pending.body, now) : r)) ?? null,
    [rawRows, pending, now],
  );
  const counts = useMemo(() => countBuckets(rows ?? []), [rows]);
  const visible = useMemo(
    () => (rows ?? [])
      .filter((r) => bucket === "all" || r.bucket === bucket)
      .filter((r) => matches(r, query))
      .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)),
    [rows, bucket, query],
  );
  // Parcels the carrier abandoned months ago are set aside: left in place they
  // are most of what an agent sees, and the parcel that needs a call today is
  // lost among them.
  const { live, stalled } = useMemo(() => partitionStalled(visible, now), [visible, now]);
  const shown = useMemo(() => (showStalled ? [...live, ...stalled] : live), [live, stalled, showStalled]);
  const oldestStall = stalled.length > 0 ? Math.round((stalled[0].hours_on_status ?? 0) / 24) : 0;

  const selected = rows?.find((r) => r.order_id === selectedId) ?? null;
  const byId = useCallback((id: string) => rows?.find((r) => r.order_id === id) ?? null, [rows]);

  // Desktop opens on the first parcel, like the prototype.
  useEffect(() => {
    if (!selectedId && shown.length > 0 && isDesktop()) setSelectedId(shown[0].order_id);
  }, [selectedId, shown]);

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

  const sheetRow = sheet ? byId(sheet.orderId) : null;
  const inFlight = counts.all - counts.done;
  const showAgent = role !== "agent";
  const handlers = { onLogAction: openAction, onWhatsApp: openWhatsApp, onDialed: (row: WorklistRow) => openAction(row) };
  const pendingRow = pending ? byId(pending.orderId) : null;

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-10 pt-4 text-start lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-4 2xl:grid-cols-[minmax(0,1fr)_480px] lg:px-5 lg:pt-5">
      <section className="min-w-0">
        <div className="mb-3.5 flex items-start justify-between gap-3.5 lg:justify-start">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-[#111827] lg:text-[26px]">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-[#6B7280] lg:text-[15px]">{t("sub", { n: inFlight })}</p>
          </div>
          {scorecard && scorecard.delivery_rate !== null && (
            <span data-testid="delivery-stat"
              className="mt-1 inline-flex h-[30px] items-center gap-2 whitespace-nowrap rounded-full bg-[#DCFCE7] px-2.5 text-[12.5px] text-[#14532D] lg:h-[34px] lg:border lg:border-[#E5E7EB] lg:bg-white lg:px-3 lg:text-[13.5px] lg:text-[#374151]">
              <BarChart3 size={16} className="text-[#16A34A]" aria-hidden />
              <span>{t.rich("stat", { rate: scorecard.delivery_rate, saved: scorecard.saved, b: (c) => <b className="font-semibold text-[#111827] tabular-nums">{c}</b> })}</span>
            </span>
          )}
        </div>

        <div role="group" aria-label={t("filters")} className="-mx-4 mb-3.5 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] lg:mx-0 lg:gap-1.5 lg:px-0">
          {(["all", ...BUCKET_ORDER] as const).map((k) => {
            const on = bucket === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setBucket(k)}
                className={[
                  "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[14.5px] lg:h-9 lg:rounded-[10px] lg:px-3 lg:text-sm",
                  on ? "border-[#111111] bg-[#111111] font-semibold text-white lg:border-[1.5px] lg:bg-white lg:text-[#111827]"
                     : "border-[#E5E7EB] bg-white text-[#374151]",
                ].join(" ")}>
                {k !== "all" && <span aria-hidden className={`hidden h-2 w-2 rounded-full lg:inline-block ${TONE[BUCKET_TONE[k]].dot}`} />}
                {t(`buckets.${k}`)}
                <b className={`font-semibold tabular-nums ${on ? "text-white lg:text-[#111827]" : "text-[#111827]"}`}>{counts[k]}</b>
              </button>
            );
          })}
        </div>

        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_200px_92px] gap-4 px-[18px] pb-2 pt-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6B7280] lg:grid lg:ps-5" aria-hidden>
          <span>{t("cols.client")}</span><span>{t("cols.situation")}</span><span>{t("cols.action")}</span><span className="text-end">{t("cols.amount")}</span>
        </div>

        <div role="list" aria-label={t("title")} aria-busy={rows === null && !error}>
          {error && rows === null ? (
            <div className="rounded-xl border border-[#E5E7EB] bg-white px-5 py-10 text-center">
              <p className="mb-3 text-[15px] text-[#111827]">{t("loadError")}</p>
              <button type="button" onClick={onRetry} className="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-sm font-semibold">{t("retry")}</button>
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
              {(bucket !== "all" || query) && (
                <button type="button" onClick={() => { setBucket("all"); setQuery(""); }} className="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#111827]">
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
            className={`flex w-full items-center gap-3 rounded-xl border border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-4 py-3 text-start hover:bg-[#F3F4F6] lg:rounded-[10px] ${showStalled ? "mb-2 mt-1" : "mt-1"}`}
          >
            <Moon size={18} className="shrink-0 text-[#9CA3AF]" aria-hidden />
            <span className="min-w-0">
              <b className="block text-[14.5px] font-semibold text-[#374151]">{t("stalledGroup", { n: stalled.length })}</b>
              <small className="block text-[13px] text-[#6B7280]">{t("stalledSince", { days: oldestStall })}</small>
            </span>
            <span className="ms-auto flex shrink-0 items-center gap-1.5 text-[13.5px] font-semibold text-[#374151]">
              {showStalled ? t("stalledHide") : t("stalledShow")}
              <ChevronDown size={16} aria-hidden className={showStalled ? "rotate-180" : ""} />
            </span>
          </button>
        )}
      </section>

      <aside className="hidden lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-104px)] lg:flex-col lg:gap-3">
        <label className="flex h-[46px] shrink-0 items-center gap-2.5 rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 text-[#6B7280]">
          <Search size={18} aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")}
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-[#111827] outline-none" />
        </label>
        <div role="region" aria-label={t("detail.title")} className="min-h-0 flex-1">
          {selected ? (
            <DeliveryDetailPanel row={selected} market={marketCode} locale={locale} tz={tz} now={now} onClose={() => setSelectedId(null)} {...handlers} />
          ) : (
            <div className="grid h-full place-items-center rounded-[14px] border border-[#E5E7EB] bg-white p-10 text-center text-[#6B7280]">{t("pick")}</div>
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
          <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-white ${notice === "failed" ? "bg-[#B91C1C]" : "bg-[#1E8E5A] lg:bg-[#22C55E]"}`}>
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
            <button type="button" onClick={onUndo} className="ms-auto text-sm font-semibold text-[#2563EB] underline-offset-4 lg:text-white lg:underline">{t("toast.undo")}</button>
          ) : (
            <button type="button" onClick={onDismissNotice} aria-label={t("toast.close")} className="ms-auto text-[#6B7280] lg:text-[#B6BCC6]"><X size={16} aria-hidden /></button>
          )}
          {pending && <span key={pending.orderId + pending.body.action_type} aria-hidden className="absolute bottom-0 start-0 h-0.5 animate-[delivery-undo_5s_linear_forwards] bg-[#1E8E5A] lg:bg-[#22C55E]" />}
        </div>
      )}
    </div>
  );
}
