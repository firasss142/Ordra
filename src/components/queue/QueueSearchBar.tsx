"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import useSWR from "swr";
import {
  Search,
  X,
  Clock,
  ShoppingBag,
  Truck,
  Users,
  ArrowLeft,
  Globe,
  Lock,
  Eye,
  ChevronRight,
  Phone,
  Hash,
  Type,
} from "lucide-react";
import { useQueueSearch } from "@/context/queue-search";
import { fetcher } from "@/lib/swr-config";
import { fetchAgentQueue } from "@/lib/agent-queue/fetch-queue";
import {
  buildSuggestions,
  queryIntent,
  MIN_QUERY,
  type SuggestionGroupKey,
  type SuggestionRow,
} from "@/lib/agent-search/suggestions";
import { highlight } from "@/lib/agent-search/highlight";
import { MARKET_SEARCH_MIN } from "@/lib/agent-search/market";
import { useAgentMarketSearch } from "@/hooks/useAgentMarketSearch";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { OwnerTag } from "@/components/queue/OwnerTag";
import { OrderPreviewSheet } from "@/components/queue/OrderPreviewSheet";

export const RECENT_SEARCHES_KEY = "oms.agent.recentSearches";
const MAX_RECENT = 5;

interface Props {
  /**
   * "navbar" sits inside the agent Topbar (compact, no surrounding band, reads
   * its state from QueueSearchContext). "page" is the standalone band used in
   * isolation/tests with explicitly passed props.
   */
  variant?: "navbar" | "page";
  /** Explicit overrides — used by the "page" variant and tests. */
  value?: string;
  onChange?: (raw: string) => void;
  resultCount?: number;
  isSearching?: boolean;
  /** Forwarded so the parent can focus the input on the "/" shortcut. */
  inputRef?: React.Ref<HTMLInputElement | null>;
  /**
   * Offer results from every agent tab, not just the queue. On by default for
   * the navbar, which now renders on all four tabs.
   */
  predictive?: boolean;
}

export function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): void {
  if (typeof window === "undefined") return;
  const term = query.trim();
  if (term.length < 2) return;
  const existing = readRecentSearches().filter((q) => q.toLowerCase() !== term.toLowerCase());
  const next = [term, ...existing].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — recent searches are best-effort */
  }
}

export function QueueSearchBar({
  variant = "page",
  value: valueProp,
  onChange: onChangeProp,
  resultCount: resultCountProp,
  isSearching: isSearchingProp,
  inputRef: inputRefProp,
  predictive,
}: Props) {
  const t = useTranslations("queue.search");
  const tNav = useTranslations("nav");
  const tCrm = useTranslations("crm");
  const tStatus = useTranslations("orders.statuses");
  const tFields = useTranslations("orders.search.fields");
  const locale = useLocale();
  const ctx = useQueueSearch();
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeIx, setActiveIx] = useState(0);
  // Phones open the results as a full screen; a dropdown under a pill is unusable.
  const [sheetOpen, setSheetOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Explicit props win (page variant / tests); otherwise read from context.
  const value = valueProp ?? ctx.query;
  const onChange = onChangeProp ?? ctx.setQuery;
  const resultCount = resultCountProp ?? ctx.resultCount;
  const isSearching = isSearchingProp ?? value.trim().length > 0;
  const inputRef = inputRefProp ?? ctx.inputRef;
  const isNavbar = variant === "navbar";
  const wantsSuggestions = predictive ?? isNavbar;

  // The caches the shell has already warmed on every tab (AgentNavTabs
  // preloads all three), so the dropdown costs no extra request. Revalidation
  // is left to the pages that own each key.
  const swrOpts = { revalidateOnMount: false, revalidateOnFocus: false } as const;
  const { data: queueCache } = useSWR(
    wantsSuggestions ? "/api/agent/queue" : null,
    fetchAgentQueue,
    swrOpts,
  );
  const { data: worklist } = useSWR<{ rows?: Record<string, unknown>[] }>(
    wantsSuggestions ? "/api/delivery/worklist" : null,
    fetcher,
    swrOpts,
  );
  const { data: leadQueue } = useSWR<{ allLeads?: Record<string, unknown>[]; leads?: Record<string, unknown>[] }>(
    wantsSuggestions ? "/api/agent/leads/queue" : null,
    fetcher,
    swrOpts,
  );

  // The whole market, from the server — only while the results are on screen.
  const market = useAgentMarketSearch(value, wantsSuggestions && (focused || sheetOpen));
  // A view-only order opens here, in a snapshot, never in the order panel.
  const [previewId, setPreviewId] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!wantsSuggestions) return [];
    const cache = queueCache as { allOrders?: unknown[] } | undefined;
    return buildSuggestions(value, {
      orders: (cache?.allOrders ?? []) as never,
      parcels: ((worklist?.rows ?? []) as never) ?? [],
      leads: ((leadQueue?.allLeads ?? leadQueue?.leads ?? []) as never) ?? [],
      market: market.rows,
      marketTotal: market.total,
      locale,
    });
  }, [wantsSuggestions, value, queueCache, worklist, leadQueue, market.rows, market.total, locale]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const showSuggestions = focused && wantsSuggestions && value.trim().length >= MIN_QUERY;
  // Long enough for the market to have been asked: from here an empty list
  // means "nothing in the whole market", not "nothing in your queue".
  const marketAsked = value.trim().length >= MARKET_SEARCH_MIN;

  useEffect(() => {
    setActiveIx(0);
  }, [value]);

  const GROUP_META: Record<SuggestionGroupKey, { label: string; Icon: typeof ShoppingBag }> = {
    orders: { label: tNav("orders"), Icon: ShoppingBag },
    delivery: { label: tNav("delivery"), Icon: Truck },
    market: { label: t("marketGroup"), Icon: Globe },
    leads: { label: tCrm("nav"), Icon: Users },
  };

  const openOwn = useCallback(
    (id: string) => {
      setPreviewId(null);
      if (typeof window !== "undefined") window.location.assign(`/${locale}/queue?openOrderId=${id}`);
    },
    [locale],
  );
  const closePreview = useCallback(() => setPreviewId(null), []);

  function go(row: SuggestionRow) {
    if (row.view) {
      // Keep the query: closing the preview should land back on these results.
      pushRecentSearch(value);
      setFocused(false);
      setSheetOpen(false);
      setPreviewId(row.id);
      return;
    }
    pushRecentSearch(value);
    setFocused(false);
    setSheetOpen(false);
    onChange("");
    // A plain assignment rather than the router: this component is rendered in
    // the shell above the router boundary in tests, and a full navigation is
    // what the dropdown means anyway — the target tab mounts fresh.
    if (typeof window !== "undefined") window.location.assign(row.href);
  }

  // Refresh recent list whenever the dropdown is about to show.
  const showRecent = focused && value.trim().length === 0;
  useEffect(() => {
    if (showRecent || sheetOpen) setRecent(readRecentSearches());
  }, [showRecent, sheetOpen]);

  // Close the recent dropdown on outside click.
  useEffect(() => {
    if (!focused) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [focused]);

  /** Text with the matched letters marked, as the query found them. */
  function marked(text: string) {
    return highlight(text, value).map((s, i) =>
      s.hit ? (
        <mark key={i} className="rounded-sm bg-[#FEF08A] text-inherit">
          {s.text}
        </mark>
      ) : (
        <span key={i}>{s.text}</span>
      ),
    );
  }

  /** What the box understood — so a phone typed any way visibly searches as one. */
  function intentChip() {
    const intent = queryIntent(value);
    if (!intent) return null;
    const { Icon, label } =
      intent.kind === "number"
        ? { Icon: Phone, label: t("intentNumber") }
        : intent.kind === "field"
          ? { Icon: Hash, label: tFields(intent.field) }
          : { Icon: Type, label: t("intentText") };
    return (
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill border border-agent-outline-variant bg-agent-surface px-2.5 text-[12px] font-semibold text-agent-on-surface-variant">
        <Icon size={13} strokeWidth={2} aria-hidden="true" className="text-agent-primary" />
        {label}
      </span>
    );
  }

  /** The grouped rows, shared by the desktop dropdown and the phone sheet. */
  function resultList() {
    const shown = flat.length;
    const total = groups.reduce((n, g) => n + g.total, 0);
    const count =
      total > shown
        ? t("countOf", { shown, total })
        : total === 1
          ? t("resultCount", { count: 1 })
          : t("resultCountPlural", { count: total });

    return (
      <div id="agent-search-listbox" role="listbox" aria-label={t("aria")}>
        {marketAsked && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-agent-outline-variant bg-agent-surface-low px-4 py-2">
            {intentChip()}
            <span className="inline-flex items-center gap-1 text-[12px] text-agent-ink-3">
              <Globe size={12} strokeWidth={2} aria-hidden="true" />
              {t("scope")}
            </span>
            {!market.pending && (
              <span className="ms-auto text-[12px] font-semibold tabular-nums text-agent-on-surface-variant">{count}</span>
            )}
          </div>
        )}
        {groups.map((group) => {
          const meta = GROUP_META[group.key];
          const Icon = meta.Icon;
          const orderStatuses = group.key === "orders" || group.key === "market";
          return (
            <div key={group.key}>
              <div className="flex items-center gap-2 px-4 pb-1 pt-2">
                <Icon size={13} strokeWidth={2} aria-hidden="true" className="text-agent-ink-3" />
                <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-agent-on-surface-variant">
                  {meta.label}
                </span>
                {group.key === "market" && (
                  <span className="inline-flex h-5 items-center gap-1 rounded-pill bg-agent-surface-low px-2 text-[11px] font-semibold text-agent-on-surface-variant">
                    <Lock size={11} strokeWidth={2} aria-hidden="true" />
                    {t("readOnly")}
                  </span>
                )}
                <span className="ms-auto text-[11px] font-semibold tabular-nums text-agent-ink-3">
                  {group.total}
                </span>
              </div>
              {group.rows.map((row) => {
                const ix = flat.indexOf(row);
                return (
                  <button
                    key={`${group.key}:${row.id}`}
                    type="button"
                    role="option"
                    aria-selected={ix === activeIx}
                    onMouseEnter={() => setActiveIx(ix)}
                    // onMouseDown so it fires before the input's blur.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(row);
                    }}
                    className={[
                      "w-full flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-2.5 min-h-[48px] text-start",
                      "transition-colors duration-fast",
                      ix === activeIx ? "bg-agent-surface-high" : "hover:bg-agent-surface-low",
                    ].join(" ")}
                  >
                    <span className="min-w-0 basis-full lg:basis-auto lg:flex-1">
                      <span className="flex items-baseline gap-2 truncate text-[13.5px] font-semibold text-agent-on-surface">
                        <span className="truncate">{marked(row.title)}</span>
                        {row.ref && (
                          <span dir="ltr" className="shrink-0 text-[11.5px] font-medium tabular-nums text-agent-ink-3">
                            {marked(`#${row.ref}`)}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[12px] text-agent-ink-3">
                        {/* Each piece isolated: a "+218…" between Arabic words
                            otherwise renders with its plus sign at the end. */}
                        {row.parts.map((part, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            <bdi>{marked(part)}</bdi>
                          </span>
                        ))}
                      </span>
                    </span>
                    {(orderStatuses && row.status) || row.view ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        {orderStatuses && row.status && (
                          <OrderStatusBadge status={row.status} label={tStatus(row.status)} locale={locale} />
                        )}
                        <OwnerTag owner={row.owner} ownerName={row.ownerName} status={row.status} />
                      </span>
                    ) : null}
                    {row.amount !== null && (
                      <span className="ms-auto shrink-0 text-[12.5px] font-semibold tabular-nums text-agent-on-surface">
                        {row.amount}
                        {row.currency ? ` ${row.currency}` : ""}
                      </span>
                    )}
                    <span
                      aria-hidden="true"
                      className={["hidden lg:grid h-7 w-7 shrink-0 place-items-center rounded-lg", row.view ? "text-agent-on-surface-variant" : "text-agent-ink-3"].join(" ")}
                    >
                      {row.view ? (
                        <Eye size={15} strokeWidth={2} />
                      ) : (
                        <ChevronRight size={15} strokeWidth={2} className="rtl:-scale-x-100" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {marketAsked && market.pending && (
          <div role="status" className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-agent-ink-3">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-agent-outline-variant border-t-agent-primary"
            />
            {t("searchingMarket")}
          </div>
        )}
        {marketAsked && market.error && (
          <p role="status" className="px-4 py-3 text-[12.5px] text-agent-error">
            {t("marketError")}
          </p>
        )}
        {groups.length === 0 && !market.pending && !market.error && (
          <div className="px-5 py-8 text-center">
            <p className="text-[13.5px] font-semibold text-agent-on-surface">
              {t("emptyMarket", { query: value.trim() })}
            </p>
            <p className="mt-1 text-[12.5px] text-agent-ink-3">{t("emptyHint")}</p>
          </div>
        )}
      </div>
    );
  }

  const countLabel =
    resultCount === 1 ? t("resultCount", { count: 1 }) : t("resultCountPlural", { count: resultCount });

  return (
    <div className={isNavbar ? "w-full max-w-[560px]" : "bg-agent-bg px-8 pt-6 pb-1"}>
      <div ref={wrapRef} className={isNavbar ? "relative w-full" : "relative max-w-[640px]"}>
        <div
          data-testid="search-field"
          className={[
            "items-center gap-2 ps-3 pe-2 rounded-pill bg-agent-surface",
            // Phones get the compact trigger below; this field is the desktop one.
            isNavbar ? "hidden lg:flex h-11" : "flex h-11",
            "border transition-colors duration-fast",
            focused
              ? "border-agent-primary ring-2 ring-agent-primary/15"
              : "border-agent-outline-variant hover:border-agent-outline",
          ].join(" ")}
        >
          <Search
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className="shrink-0 text-agent-on-surface-variant"
          />
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            type="search"
            // A number typed into the Arabic field reads as typed ("091 345 67"),
            // not with its digit groups reversed.
            dir="auto"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (showSuggestions && flat.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIx((i) => (i + 1) % flat.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIx((i) => (i - 1 + flat.length) % flat.length);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  go(flat[activeIx] ?? flat[0]);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                if (value.length > 0) {
                  onChange("");
                } else {
                  e.currentTarget.blur();
                  setFocused(false);
                }
              }
            }}
            placeholder={t("placeholder")}
            aria-label={t("aria")}
            role={wantsSuggestions ? "combobox" : "searchbox"}
            aria-expanded={wantsSuggestions ? showSuggestions : undefined}
            aria-controls={wantsSuggestions ? "agent-search-listbox" : undefined}
            aria-autocomplete={wantsSuggestions ? "list" : undefined}
            // Hide the browser's native search clear so ours is the only one.
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-agent-on-surface placeholder:text-agent-on-surface-variant/70 [&::-webkit-search-cancel-button]:appearance-none"
          />

          {isSearching && (
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-agent-on-surface-variant whitespace-nowrap">
              {countLabel}
            </span>
          )}

          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label={t("clear")}
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-agent-on-surface-variant hover:bg-agent-surface-high hover:text-agent-on-surface transition-colors duration-fast"
            >
              <X size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex shrink-0 items-center justify-center min-w-[20px] h-[20px] px-1.5 me-1 rounded border border-agent-outline-variant bg-agent-surface-high text-[11px] font-semibold text-agent-on-surface-variant">
              /
            </kbd>
          )}
        </div>

        {/* Field-prefix hint, shown only while focused & typing */}
        {focused && value.trim().length > 0 && (
          <p className="mt-1.5 ps-3 text-[11.5px] text-agent-on-surface-variant/80">
            {t("fieldHints")}
          </p>
        )}

        {showSuggestions && (groups.length > 0 || marketAsked) && (
          <div className="absolute z-30 mt-1.5 start-0 w-full min-w-[min(640px,90vw)] max-w-[680px] max-h-[min(560px,70vh)] overflow-y-auto bg-agent-surface border border-agent-outline-variant rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] pb-2">
            {resultList()}
          </div>
        )}

        {/* Phones: a compact trigger that opens the results full screen. */}
        {isNavbar && (
          <button
            type="button"
            data-testid="search-trigger"
            onClick={() => setSheetOpen(true)}
            aria-label={t("aria")}
            className="lg:hidden inline-flex h-11 w-full items-center gap-2 rounded-pill border border-agent-outline-variant bg-agent-surface px-4 text-agent-on-surface-variant"
          >
            <Search size={16} strokeWidth={2} aria-hidden="true" />
            <span className="truncate text-[13.5px]">{value || t("placeholder")}</span>
          </button>
        )}

        {isNavbar && sheetOpen && (
          <div
            role="dialog"
            aria-label={t("aria")}
            className="lg:hidden fixed inset-0 z-50 flex flex-col bg-agent-bg"
          >
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-agent-outline-variant bg-agent-surface px-2.5">
              <button
                type="button"
                data-testid="search-sheet-back"
                onClick={() => setSheetOpen(false)}
                aria-label={t("clear")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-agent-on-surface"
              >
                <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" className="rtl:-scale-x-100" />
              </button>
              <label className="flex h-11 flex-1 items-center gap-2 rounded-pill border border-agent-primary bg-agent-surface px-3.5 ring-2 ring-agent-primary/15">
                <Search size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-agent-on-surface-variant" />
                <input
                  autoFocus
                  type="search"
                  dir="auto"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={t("placeholder")}
                  aria-label={t("aria")}
                  className="min-w-0 flex-1 bg-transparent text-[14.5px] text-agent-on-surface outline-none [&::-webkit-search-cancel-button]:appearance-none"
                />
                {value.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange("")}
                    aria-label={t("clear")}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-agent-on-surface-variant"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-agent-surface">
              {value.trim().length >= MIN_QUERY ? (
                groups.length > 0 || marketAsked ? (
                  resultList()
                ) : (
                  <p className="px-5 py-10 text-center text-[13.5px] text-agent-ink-3">
                    {t("noResultsSubtitle", { query: value.trim() })}
                  </p>
                )
              ) : (
                recent.length > 0 && (
                  <div className="py-2">
                    <div className="px-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-agent-on-surface-variant">
                      {t("recentTitle")}
                    </div>
                    {recent.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onChange(q)}
                        className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2 text-start text-[13.5px] text-agent-on-surface"
                      >
                        <Clock size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-agent-on-surface-variant/70" />
                        <span className="truncate">{q}</span>
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* Recent searches dropdown */}
        {showRecent && recent.length > 0 && (
          <div
            role="listbox"
            aria-label={t("recentTitle")}
            className="absolute z-30 mt-1.5 start-0 w-full max-w-[640px] bg-agent-surface border border-agent-outline-variant rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] py-2"
          >
            <div className="flex items-center justify-between px-4 pb-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-agent-on-surface-variant">
                {t("recentTitle")}
              </span>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
                  } catch {
                    /* ignore */
                  }
                  setRecent([]);
                }}
                className="text-[11px] font-medium text-agent-on-surface-variant hover:text-agent-on-surface transition-colors duration-fast"
              >
                {t("recentClear")}
              </button>
            </div>
            {recent.map((q) => (
              <button
                key={q}
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown (not onClick) so it fires before the input's blur
                // closes the dropdown.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(q);
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-start text-[13.5px] text-agent-on-surface hover:bg-agent-surface-high transition-colors duration-fast"
              >
                <Clock
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 text-agent-on-surface-variant/70"
                />
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {wantsSuggestions && (
        <OrderPreviewSheet orderId={previewId} onClose={closePreview} onOpenOwn={openOwn} />
      )}
    </div>
  );
}
