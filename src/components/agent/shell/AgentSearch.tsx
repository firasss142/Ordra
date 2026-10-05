"use client";

// The agent's one search (prototype `searchDrop`; owner 2026-10-05 « one unified search bar »):
// one query, four groups — your orders, your parcels, the rest of the market (« Prendre la
// commande » from its preview), the CRM — and the recent searches while the field is empty. In the
// band it is `.gsw`, the same on every tab; on Commandes the list behind it filters by the same
// query (the shell's QueueSearch context). On a phone it is a full screen `.mpanel`. The data is the old QueueSearchBar's: buildSuggestions over the warm caches
// + the server's market search.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { useRouter, usePathname } from "next/navigation";
import { fetcher } from "@/lib/swr-config";
import { fetchAgentQueue } from "@/lib/agent-queue/fetch-queue";
import { buildSuggestions, queryIntent, MIN_QUERY, type SuggestionRow } from "@/lib/agent-search/suggestions";
import { MARKET_SEARCH_MIN } from "@/lib/agent-search/market";
import { useAgentMarketSearch } from "@/hooks/useAgentMarketSearch";
import { readRecentSearches, pushRecentSearch, RECENT_SEARCHES_KEY } from "@/lib/agent-search/recent";
import { presentStatus } from "@/lib/orders/status-presentation";
import { Ic, APill, type AgentHue } from "@/components/agent/shared";
import { useQueueSearch } from "@/context/queue-search";
import { useOutside } from "./useOutside";

// Served from the warm caches when a tab has loaded them; fetched once when none has.
const swrOpts = { revalidateIfStale: false, revalidateOnFocus: false } as const;

function useSearchModel(enabled: boolean) {
  const locale = useLocale();
  // The shell's one query — Commandes filters its list by it.
  const { query, setQuery, inputRef } = useQueueSearch();
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
  return { query, setQuery, groups, market, locale, inputRef };
}

/** The drop's content — shared by the band and the phone screen. */
function SearchResults({
  model,
  onPick,
  onRecent,
  flat,
  activeKey,
}: {
  model: ReturnType<typeof useSearchModel>;
  onPick: (row: SuggestionRow) => void;
  onRecent: (q: string) => void;
  flat?: boolean;
  /** The row the arrow keys are on. */
  activeKey?: string | null;
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
                <Ic n="eye" />
                {t("readOnly")}
              </span>
            ) : null}
          </h6>
          {g.rows.map((row) => {
            const hue = g.key === "orders" || g.key === "market" ? pill(row.status) : null;
            return (
              <button key={`${g.key}:${row.id}`} type="button" className={`sres${activeKey === `${g.key}:${row.id}` ? " on" : ""}`} data-sk={`${g.key}:${row.id}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(row)}>
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
  const router = useRouter();
  return useCallback(
    (row: SuggestionRow) => {
      pushRecentSearch(model.query);
      done();
      // A colleague's order opens read-only in the queue's order column; the rest go where they live.
      const href = row.view ? `/${model.locale}/queue?viewOrderId=${row.id}` : row.href;
      model.setQuery("");
      if (href) router.push(href);
    },
    [model, done, router],
  );
}

/** The result rows in screen order — what ↑ ↓ walk through. */
function flatRows(model: ReturnType<typeof useSearchModel>) {
  if (model.query.trim().length < MIN_QUERY) return [];
  return model.groups.flatMap((g) => g.rows.map((row) => ({ key: `${g.key}:${row.id}`, row })));
}

/** `.gsw` — the band's field and its drop, on every tab. « / » focuses it (on Commandes « / » stays the list's own field). */
export function AgentSearchDesk() {
  const t = useTranslations("agent.search");
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open, close);
  const model = useSearchModel(open);
  const pick = usePick(model, close);
  const flat = flatRows(model);
  const cur = flat[Math.min(active, flat.length - 1)] ?? null;

  // « / » focuses it, on every tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Another tab: the query does not follow (a forgotten filter would hide rows there).
  const { setQuery } = model;
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setQuery("");
    setOpen(false);
  }, [pathname, setQuery]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape: the drop closes first (on Commandes the list stays filtered), then the query clears.
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (open) close();
      else if (model.query) model.setQuery("");
      else input.current?.blur();
      return;
    }
    if (!open) setOpen(true);
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && flat.length) {
      e.preventDefault();
      const i = Math.max(0, Math.min(flat.length - 1, (cur ? flat.indexOf(cur) : -1) + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(i);
      ref.current?.querySelector(`[data-sk="${flat[i].key}"]`)?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (e.key === "Enter" && cur) {
      e.preventDefault();
      pick(cur.row);
    }
  };

  return (
    <div className="gsw" ref={ref}>
      <label className={`gs${open ? " on" : ""}`}>
        <Ic n="search" />
        <input
          ref={(el) => {
            input.current = el;
            (model.inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }}
          id="gq"
          type="search"
          value={model.query}
          onChange={(e) => {
            model.setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("placeholder")}
          aria-label={t("aria")}
          aria-expanded={open}
          autoComplete="off"
          spellCheck={false}
        />
        {model.query ? (
          <button
            type="button"
            className="mini"
            aria-label={t("clear")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              model.setQuery("");
              input.current?.focus();
            }}
          >
            <Ic n="x" />
          </button>
        ) : (
          <span className="kbd2">/</span>
        )}
      </label>
      {open ? <SearchResults model={model} onPick={pick} onRecent={(x) => model.setQuery(x)} activeKey={cur?.key ?? null} /> : null}
    </div>
  );
}

/** The phone: a magnifier in `.mtop`, then the whole screen. */
export function AgentSearchPhone() {
  const t = useTranslations("agent.search");
  const [open, setOpen] = useState(false);
  const model = useSearchModel(open);
  const { setQuery } = model;
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, [setQuery]);
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
                onKeyDown={(e) => {
                  const first = flatRows(model)[0];
                  if (e.key === "Enter" && first) pick(first.row);
                }}
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
