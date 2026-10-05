"use client";

// The market search (prototype `searchDrop`): one query, four groups — your orders, your parcels,
// the market (read-only), the CRM — and the recent searches while the field is empty. In the band
// it is `.gsw` (hidden on Commandes, whose own field is bound to the same query); on a phone it is a
// full screen `.mpanel`. The data is the old QueueSearchBar's: buildSuggestions over the warm caches
// + the server's market search.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { useQueueSearch } from "@/context/queue-search";
import { fetcher } from "@/lib/swr-config";
import { fetchAgentQueue } from "@/lib/agent-queue/fetch-queue";
import { buildSuggestions, queryIntent, MIN_QUERY, type SuggestionRow } from "@/lib/agent-search/suggestions";
import { MARKET_SEARCH_MIN } from "@/lib/agent-search/market";
import { useAgentMarketSearch } from "@/hooks/useAgentMarketSearch";
import { readRecentSearches, pushRecentSearch, RECENT_SEARCHES_KEY } from "@/lib/agent-search/recent";
import { presentStatus } from "@/lib/orders/status-presentation";
import { Ic, APill, type AgentHue } from "@/components/agent/shared";
import { useOutside } from "./useOutside";

const swrOpts = { revalidateOnMount: false, revalidateOnFocus: false } as const;

function useSearchModel(enabled: boolean) {
  const locale = useLocale();
  const { query, setQuery } = useQueueSearch();
  const { data: queue } = useSWR(enabled ? "/api/agent/queue" : null, fetchAgentQueue, swrOpts);
  const { data: worklist } = useSWR<{ rows?: Record<string, unknown>[] }>(enabled ? "/api/delivery/worklist" : null, fetcher, swrOpts);
  const { data: leads } = useSWR<{ allLeads?: Record<string, unknown>[]; leads?: Record<string, unknown>[] }>(
    enabled ? "/api/agent/leads/queue" : null,
    fetcher,
    swrOpts,
  );
  const market = useAgentMarketSearch(query, enabled);
  const groups = useMemo(() => {
    if (!enabled) return [];
    const cache = queue as { allOrders?: unknown[] } | undefined;
    return buildSuggestions(query, {
      orders: (cache?.allOrders ?? []) as never,
      parcels: (worklist?.rows ?? []) as never,
      leads: (leads?.allLeads ?? leads?.leads ?? []) as never,
      market: market.rows,
      marketTotal: market.total,
      locale,
    });
  }, [enabled, query, queue, worklist, leads, market.rows, market.total, locale]);
  return { query, setQuery, groups, market, locale };
}

/** The drop's content — shared by the band and the phone screen. */
function SearchResults({
  model,
  onPick,
  onRecent,
  flat,
}: {
  model: ReturnType<typeof useSearchModel>;
  onPick: (row: SuggestionRow) => void;
  onRecent: (q: string) => void;
  flat?: boolean;
}) {
  const t = useTranslations("agent.search");
  const tS = useTranslations("orders.statuses");
  const { query, groups, market } = model;
  const [recent, setRecent] = useState<string[]>([]);
  const q = query.trim();
  useEffect(() => {
    if (!q) setRecent(readRecentSearches());
  }, [q]);

  if (q.length < MIN_QUERY) {
    return (
      <div className={`sdrop${flat ? " flat" : ""}`}>
        <h6>{t("recent")}</h6>
        {recent.map((x) => (
          <button key={x} type="button" className="sres" onMouseDown={(e) => e.preventDefault()} onClick={() => onRecent(x)}>
            <Ic n="clock" />
            <span className="st">
              <b>{x}</b>
            </span>
          </button>
        ))}
        <div className="shint">
          {t("hint")}
          <button
            type="button"
            className="lnkb"
            style={{ marginInlineStart: "auto" }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              try {
                window.localStorage.removeItem(RECENT_SEARCHES_KEY);
              } catch {
                /* best-effort */
              }
              setRecent([]);
            }}
          >
            {t("clearRecent")}
          </button>
        </div>
      </div>
    );
  }

  const intent = queryIntent(query);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const total = groups.reduce((n, g) => n + g.total, 0);
  const pill = (status: string | null): AgentHue | null => (status ? presentStatus(status).hue : null);

  return (
    <div className={`sdrop${flat ? " flat" : ""}`}>
      <div className="shead">
        <span className="pl h-neutral">
          <Ic n={intent?.kind === "number" ? "phone" : "search"} />
          {intent?.kind === "number" ? t("intentNumber") : t("intentText")}
        </span>
        {q.length >= MARKET_SEARCH_MIN && !market.pending ? (
          <span className="q">
            {t("scope")} · {t("count", { shown, total })}
          </span>
        ) : null}
      </div>
      {groups.map((g) => (
        <div key={g.key}>
          <h6>
            {t(`groups.${g.key}`)}
            {g.key === "market" ? (
              <span className="pl h-neutral" style={{ height: 20 }}>
                <Ic n="lock" />
                {t("readOnly")}
              </span>
            ) : null}
          </h6>
          {g.rows.map((row) => {
            const hue = g.key === "orders" || g.key === "market" ? pill(row.status) : null;
            return (
              <button key={`${g.key}:${row.id}`} type="button" className="sres" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(row)}>
                <span className="st">
                  <b>
                    <span dir="auto">{row.title}</span>
                    {row.ref ? <span className="num q">#{row.ref}</span> : null}
                  </b>
                  <small>
                    {row.parts.map((p, i) => (
                      <span key={i}>
                        {i ? " · " : ""}
                        <bdi>{p}</bdi>
                      </span>
                    ))}
                  </small>
                </span>
                {hue && row.status ? <APill hue={hue} icon="clock" text={tS.has(row.status) ? tS(row.status) : row.status} /> : null}
                {row.view && row.ownerName ? <span className="who2">{row.ownerName}</span> : null}
                {row.amount !== null ? (
                  <span className="amt">
                    {row.amount}
                    {row.currency ? <small>{row.currency}</small> : null}
                  </span>
                ) : null}
                <Ic n={row.view ? "eye" : "right"} className={row.view ? "" : "flip"} />
              </button>
            );
          })}
        </div>
      ))}
      {q.length >= MARKET_SEARCH_MIN && market.pending ? <div className="shint">{t("searching")}</div> : null}
      {q.length >= MARKET_SEARCH_MIN && market.error ? <div className="shint" style={{ color: "var(--bad)" }}>{t("error")}</div> : null}
      {!groups.length && !market.pending && !market.error ? (
        <div className="empty" style={{ padding: 26 }}>
          <Ic n="search" />
          <b>{t("empty", { q })}</b>
          <span>{t("emptyHint")}</span>
        </div>
      ) : null}
    </div>
  );
}

function usePick(model: ReturnType<typeof useSearchModel>, done: () => void) {
  return useCallback(
    (row: SuggestionRow) => {
      pushRecentSearch(model.query);
      done();
      // A colleague's order opens read-only in the queue's order column; the rest go where they live.
      const href = row.view ? `/${model.locale}/queue?viewOrderId=${row.id}` : row.href;
      if (!row.view) model.setQuery("");
      window.location.assign(href);
    },
    [model, done],
  );
}

/** `.gsw` — the band's field and its drop. */
export function AgentSearchDesk() {
  const t = useTranslations("agent.search");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open, close);
  const model = useSearchModel(open);
  const pick = usePick(model, close);
  return (
    <div className="gsw" ref={ref}>
      <label className={`gs${open ? " on" : ""}`}>
        <Ic n="search" />
        <input
          id="gq"
          type="search"
          value={model.query}
          onChange={(e) => {
            model.setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("placeholder")}
          aria-label={t("aria")}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="kbd2">/</span>
      </label>
      {open ? <SearchResults model={model} onPick={pick} onRecent={(x) => model.setQuery(x)} /> : null}
    </div>
  );
}

/** The phone: a magnifier in `.mtop`, then the whole screen. */
export function AgentSearchPhone() {
  const t = useTranslations("agent.search");
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const model = useSearchModel(open);
  const pick = usePick(model, close);
  return (
    <>
      <button type="button" className="mic" aria-label={t("aria")} onClick={() => setOpen(true)}>
        <Ic n="search" />
      </button>
      {open ? (
        <div className="mpanel">
          <div className="mback">
            <button type="button" className="xbtn" aria-label={t("back")} onClick={close}>
              <Ic n="left" className="flip" />
            </button>
            <label className="srch" style={{ flex: 1, height: 40, boxShadow: "none", minWidth: 0 }}>
              <Ic n="search" />
              <input
                id="gq"
                autoFocus
                type="search"
                value={model.query}
                onChange={(e) => model.setQuery(e.target.value)}
                placeholder={t("phonePlaceholder")}
                aria-label={t("aria")}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="mscroll" style={{ paddingTop: 10 }}>
            <SearchResults model={model} onPick={pick} onRecent={(x) => model.setQuery(x)} flat />
          </div>
        </div>
      ) : null}
    </>
  );
}
