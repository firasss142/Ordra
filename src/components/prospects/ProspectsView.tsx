"use client";

/**
 * « Prospects » — the pre-order worklist. Pure: data, clock and the pending
 * action come in as props, so every state of the page is testable.
 *
 * Design: prototypes/prospects-v3.html. Buckets and their rules:
 * src/lib/prospects/worklist.ts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Plus, Search, Users } from "lucide-react";
import { BUCKET_ORDER, countBuckets, sumBuckets, type Bucket } from "@/lib/prospects/worklist";
import type { Outcome } from "@/lib/prospects/worklist";
import { BUCKET_TONE } from "@/lib/prospects/presentation";
import type { ProspectRow } from "@/lib/prospects/types";
import { ProspectRowCard } from "./ProspectRow";
import { ProspectDetailPanel, ProspectDetailScreen, type DetailHandlers } from "./ProspectDetail";
import { OutcomeSheet, type OutcomeDraft } from "./OutcomeSheet";
import { Money, OUTLINE_BTN, PRIMARY_BTN, TONE } from "./ui";
import type { Role } from "@/types";

export interface ProspectsViewProps {
  rows: ProspectRow[] | null;
  error: boolean;
  isLoading: boolean;
  /** True when the query hit its limit and rows are missing from the page. */
  truncated?: boolean;
  onRetry: () => void;
  role: Role;
  /** null for a super_admin who has not chosen a market yet. */
  marketCode: "ly" | "tn" | null;
  tz: string;
  locale: string;
  now: number;
  hotWindowMinutes: number;
  stats: { calls: number; converted: number };
  pending: { id: string } | null;
  notice: { bucket: Bucket } | null;
  onQueue: (row: ProspectRow, draft: OutcomeDraft) => void;
  onUndo: () => void;
  onDismissNotice: () => void;
  onConvert: (row: ProspectRow) => void;
  onNewLead: () => void;
}

/** Layout is CSS; this decides behaviour — auto-select, or push a screen. */
const isDesktop = () =>
  typeof window === "undefined" ||
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(min-width: 1024px)").matches;

/** The buckets whose visible text is derived from the current time. */
const TIME_SENSITIVE = new Set<Bucket>(["hot", "callback"]);

/** Digits only, so "092 112 2334" and "0921122334" both match. */
const digits = (s: string) => s.replace(/\D/g, "");

export function ProspectsView(props: ProspectsViewProps) {
  const {
    rows, error, isLoading, truncated, onRetry, role, marketCode, tz, locale, now,
    stats, notice, onQueue, onUndo, onDismissNotice, onConvert, onNewLead,
  } = props;
  const t = useTranslations("prospects");

  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<ProspectRow | null>(null);

  const all = rows ?? [];
  const counts = useMemo(() => countBuckets(all), [all]);
  const sums = useMemo(() => sumBuckets(all), [all]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digits(query);
    return all.filter((r) => {
      if (bucket !== "all" && r.bucket !== bucket) return false;
      if (q === "") return true;
      if (qDigits.length >= 3 && digits(r.customer_phone).includes(qDigits)) return true;
      return [r.customer_name, r.customer_city, r.product_name, r.campaign_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [all, bucket, query]);

  // Desktop opens on the first prospect; the phone waits for a tap.
  useEffect(() => {
    if (!selectedId && shown.length > 0 && isDesktop()) setSelectedId(shown[0].id);
  }, [selectedId, shown]);

  const selected = shown.find((r) => r.id === selectedId) ?? all.find((r) => r.id === selectedId) ?? null;

  const select = useCallback((row: ProspectRow) => {
    setSelectedId(row.id);
    if (!isDesktop()) setMobileOpen(true);
  }, []);

  const handlers: DetailHandlers = {
    onCall: (row) => { window.location.href = `tel:${row.customer_phone}`; },
    onWhatsApp: (row) => {
      window.open(`https://wa.me/${digits(row.customer_phone)}`, "_blank", "noopener");
    },
    onOutcome: (row) => setOutcomeFor(row),
    onConvert,
    onOpenOrder: (row) => {
      if (row.converted_order_id) window.location.href = `/${locale}/orders/${row.converted_order_id}`;
    },
  };

  const act = useCallback((row: ProspectRow) => {
    select(row);
    if (row.bucket === "converted") handlers.onOpenOrder(row);
    else setOutcomeFor(row);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  if (role === "super_admin" && marketCode === null) {
    return (
      <div className="mx-auto w-full max-w-[1560px] px-4 py-16 text-center text-[#6B7280]">
        {t("selectMarket")}
      </div>
    );
  }

  const market = marketCode ?? "ly";
  const hotCount = counts.hot;

  return (
    <div className={`mx-auto w-full max-w-[1560px] px-4 pb-10 pt-4 text-start lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-4 lg:px-5 2xl:grid-cols-[minmax(0,1fr)_440px] ${locale === "ar" ? "font-cairo" : ""}`}>
      <div className="min-w-0">
        {/* Title, the day's tally, and the one way in. */}
        <header className="mb-3.5 flex flex-wrap items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-[#E9F6EE] text-[#15803D]">
            <Users size={22} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#111827] lg:text-[26px]">
              {t("title")}
            </h1>
            <p className="mt-0.5 mb-0 text-[14.5px] text-[#6B7280]">
              {hotCount > 0 ? t("subHot", { n: hotCount }) : t("subCalm")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden h-10 items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3.5 text-[13.5px] text-[#374151] lg:inline-flex">
              {t.rich("stat", {
                calls: stats.calls,
                converted: stats.converted,
                b: (c) => <b className="font-semibold tabular-nums text-[#111827]">{c}</b>,
              })}
            </span>
            <button type="button" onClick={onNewLead} className={`h-10 px-3.5 text-[14px] ${PRIMARY_BTN}`}>
              <Plus size={17} aria-hidden />
              <span className="hidden sm:inline">{t("newLead")}</span>
            </button>
          </div>
        </header>

        {/* Search. */}
        <div className="mb-3 flex h-11 items-center gap-2.5 rounded-[10px] border border-[#E5E7EB] bg-white px-3.5">
          <Search size={17} aria-hidden className="shrink-0 text-[#9CA3AF]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14.5px] text-[#111827] outline-none"
          />
        </div>

        {/* The bucket strip: a scroller of pills on the phone, a segmented bar on desktop. */}
        <div className="-mx-4 mb-3 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] lg:mx-0 lg:block lg:overflow-visible lg:px-0">
          <div role="group" aria-label={t("filters")} className="flex gap-2 lg:grid lg:grid-cols-7 lg:gap-0 lg:rounded-lg lg:border lg:border-[#E5E7EB] lg:bg-white">
            {(["all", ...BUCKET_ORDER] as const).map((k, i) => {
              const on = bucket === k;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setBucket(k)}
                  className={[
                    "flex shrink-0 flex-col items-start gap-0.5 whitespace-nowrap rounded-[10px] border px-3 py-2 text-start transition-colors",
                    "lg:rounded-none lg:border-0 lg:border-b-2 lg:px-3.5 lg:py-2.5",
                    i > 0 ? "lg:border-s lg:border-s-[#E5E7EB]" : "",
                    i === 0 ? "lg:rounded-s-lg" : i === 6 ? "lg:rounded-e-lg" : "",
                    on
                      ? "border-[1.5px] border-[#15803D] bg-[#F0FDF4] lg:border-b-[#15803D] lg:bg-[#F9FAFB]"
                      : "border-[#E5E7EB] bg-white lg:border-b-transparent",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#374151]">
                    {k !== "all" ? (
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[BUCKET_TONE[k]].dot}`} />
                    ) : null}
                    {t(`buckets.${k}`)}
                    <b className="font-bold tabular-nums text-[#111827]">{counts[k]}</b>
                  </span>
                  <span className="text-[12px] text-[#6B7280]">
                    <Money amount={sums[k]} market={market} locale={locale} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Column headings, desktop only — the phone card labels itself. */}
        <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_96px] gap-x-4 px-5 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6B7280] lg:grid">
          <span>{t("cols.who")}</span>
          <span>{t("cols.situation")}</span>
          <span>{t("cols.action")}</span>
          <span className="text-end">{t("cols.value")}</span>
        </div>

        {error ? (
          <div className="rounded-xl border border-[#E5E7EB] bg-white px-5 py-10 text-center">
            <AlertCircle size={36} aria-hidden className="mx-auto text-[#D1D5DB]" />
            <p className="mt-3 mb-3 text-[15px] text-[#374151]">{t("loadError")}</p>
            <button type="button" onClick={onRetry} className={`h-10 px-4 text-[14px] ${OUTLINE_BTN} border-[#E5E7EB]`}>
              {t("retry")}
            </button>
          </div>
        ) : null}

        <div role="list" aria-label={t("title")} aria-busy={isLoading ? "true" : "false"}>
          {shown.map((row) => (
            <ProspectRowCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              // Only a hot prospect's age and an overdue callback's lateness
              // move with the clock. Every other bucket gets a frozen value so
              // memo() actually holds across the minute tick.
              now={TIME_SENSITIVE.has(row.bucket) ? now : 0}
              market={market}
              locale={locale}
              tz={tz}
              onSelect={select}
              onAct={act}
            />
          ))}
        </div>

        {truncated && shown.length > 0 ? (
          <p className="mt-1 mb-0 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-[13.5px] text-[#92400E]">
            {t("truncated", { n: shown.length })}
          </p>
        ) : null}

        {!error && !isLoading && shown.length === 0 ? (
          <div className="rounded-xl border border-[#E5E7EB] bg-white px-5 py-12 text-center text-[#6B7280]">
            <Users size={36} aria-hidden className="mx-auto text-[#D1D5DB]" />
            <p className="mt-3 mb-0 text-[15px]">
              {query.trim() !== "" ? t("empty.search") : bucket !== "all" ? t("empty.bucket") : t("empty.all")}
            </p>
          </div>
        ) : null}
      </div>

      {/* Desktop detail. */}
      <aside className="hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-96px)]">
        <div role="region" aria-label={t("detail")} className="h-full">
          {selected ? (
            <ProspectDetailPanel
              row={selected}
              market={market}
              locale={locale}
              tz={tz}
              now={now}
              onClose={() => setSelectedId(null)}
              {...handlers}
            />
          ) : (
            <div className="grid h-full place-items-center rounded-xl border border-[#E5E7EB] bg-white p-10 text-center text-[#6B7280]">
              {t("pick")}
            </div>
          )}
        </div>
      </aside>

      {/* Phone detail. */}
      {mobileOpen && selected ? (
        <ProspectDetailScreen
          row={selected}
          market={market}
          locale={locale}
          tz={tz}
          now={now}
          onBack={() => setMobileOpen(false)}
          {...handlers}
        />
      ) : null}

      {outcomeFor ? (
        <OutcomeSheet
          row={outcomeFor}
          now={now}
          tz={tz}
          locale={locale}
          onClose={() => setOutcomeFor(null)}
          onSave={(draft) => {
            onQueue(outcomeFor, draft);
            setOutcomeFor(null);
          }}
          onConvert={(row) => {
            setOutcomeFor(null);
            onConvert(row);
          }}
        />
      ) : null}

      {notice ? (
        <div
          role="status"
          className="fixed inset-x-3 bottom-[84px] z-[80] flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5 shadow-[0_10px_30px_rgba(17,24,39,0.14)] lg:inset-x-auto lg:bottom-5 lg:end-5 lg:min-w-[380px] lg:rounded-[10px] lg:border-0 lg:bg-[#111111] lg:py-3 lg:text-white"
        >
          <span className="min-w-0 flex-1 text-[14px]">
            {t("toast.saved", { bucket: t(`buckets.${notice.bucket}`) })}
          </span>
          <button type="button" onClick={onUndo} className="shrink-0 text-[14px] font-semibold text-[#15803D] lg:text-[#7BE0A6]">
            {t("toast.undo")}
          </button>
          <button type="button" onClick={onDismissNotice} aria-label={t("close")} className="shrink-0 text-[#9CA3AF]">
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
