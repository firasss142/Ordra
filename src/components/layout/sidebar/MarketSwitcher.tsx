"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useMarketScope } from "@/context/market-scope";
import { fetcher } from "@/lib/swr-config";
import {
  LY_MARKET_ID,
  MARKET_TIMEZONE,
  TN_MARKET_ID,
  formatDisplayCurrencyCode,
  marketIdToCode,
  type MarketCode,
  type MarketScope,
} from "@/lib/markets";
import type { AuthUser } from "@/types";
import { MarketFlag } from "./MarketFlag";
import { NavBadge } from "./NavBadge";

/*
 * Choosing the market changes every figure on every page, so the mistake to
 * prevent is « I thought I was looking at Libya ». The card keeps the market
 * named, flagged and timed at the top of the bar; its list shows, per market,
 * the orders still waiting to be assigned — where the work is, before
 * switching (prototypes/sidebar-v2.html, variant A).
 */

const OPTIONS: readonly MarketScope[] = ["tn", "ly", "all"];
const MARKET_IDS: Record<MarketCode, string> = { tn: TN_MARKET_ID, ly: LY_MARKET_ID };

type Variant = "card" | "rail" | "chip";

function currencyOf(scope: MarketScope): string {
  if (scope === "all") return `${currencyOf("tn")} · ${currencyOf("ly")}`;
  return formatDisplayCurrencyCode(null, MARKET_IDS[scope]);
}

/** Local time per market, filled after mount so server and client agree. */
function useMarketClock(): Partial<Record<MarketCode, string>> {
  const [times, setTimes] = useState<Partial<Record<MarketCode, string>>>({});
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next: Partial<Record<MarketCode, string>> = {};
      for (const code of ["tn", "ly"] as const) {
        try {
          next[code] = new Intl.DateTimeFormat("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: MARKET_TIMEZONE[code],
          }).format(now);
        } catch {
          // An engine without the zone just shows the currency.
        }
      }
      setTimes(next);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return times;
}

function useUnassignedCount(code: MarketCode, enabled: boolean): number | undefined {
  const { data } = useSWR<{ count: number }>(
    enabled ? `/api/orders/unassigned/count?market_id=${MARKET_IDS[code]}` : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  return data?.count;
}

function subLine(scope: MarketScope, times: Partial<Record<MarketCode, string>>): string {
  const time = scope === "all" ? undefined : times[scope];
  return time ? `${currencyOf(scope)} · ${time}` : currencyOf(scope);
}

export function MarketSwitcher({ user, variant }: { user: AuthUser; variant: Variant }) {
  const t = useTranslations("nav");
  const { scope, setScope } = useMarketScope();
  const isAdmin = user.role === "super_admin";
  const current: MarketScope = isAdmin ? scope : marketIdToCode(user.market_id) ?? "tn";
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [arrived, setArrived] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const times = useMarketClock();
  const tn = useUnassignedCount("tn", isAdmin && everOpened);
  const ly = useUnassignedCount("ly", isAdmin && everOpened);
  const counts: Record<MarketScope, number | undefined> = {
    tn,
    ly,
    all: tn !== undefined && ly !== undefined ? tn + ly : undefined,
  };

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const choose = useCallback(
    (next: MarketScope) => {
      if (next !== scope) {
        setScope(next);
        setArrived(true);
      }
      setAnnounce(t("markets.switched", { market: t(`markets.${next}`) }));
      close(true);
    },
    [scope, setScope, t, close],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
        return;
      }
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= OPTIONS.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        choose(OPTIONS[n - 1]);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, close, choose]);

  const name = t(`markets.${current}`);
  const ariaLabel = t("markets.ariaLabel", { market: name });

  if (!isAdmin) {
    if (variant === "rail") {
      return (
        <span className="sb-rbtn sb-rbtn-mk" role="img" aria-label={ariaLabel} title={name}>
          <MarketFlag scope={current} size={22} radius={6} />
        </span>
      );
    }
    if (variant === "chip") {
      return (
        <span className="sb-mchip" aria-label={ariaLabel}>
          <MarketFlag scope={current} size={20} radius={10} />
          {name}
        </span>
      );
    }
    return (
      <div className="sb-mcard" role="group" aria-label={ariaLabel}>
        <MarketFlag scope={current} size={32} radius={8} />
        <span className="sb-mtxt">
          <span className="sb-mname">{name}</span>
          <span className="sb-msub">{subLine(current, times)}</span>
        </span>
      </div>
    );
  }

  const toggle = () => {
    setEverOpened(true);
    setOpen((v) => !v);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role='option']"));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const row = (m: MarketScope, n: number) => {
    const selected = m === current;
    return (
      <button
        key={m}
        type="button"
        role="option"
        aria-selected={selected}
        className="sb-mrow"
        onClick={() => choose(m)}
      >
        <MarketFlag scope={m} size={30} radius={8} />
        <span className="sb-mtxt">
          <span className="sb-mname">{t(`markets.${m}`)}</span>
          <span className="sb-msub">{subLine(m, times)}</span>
        </span>
        <NavBadge count={counts[m] ?? 0} tone="warning" label={t("markets.toAssign")} />
        {selected ? (
          <Check size={15} strokeWidth={2} aria-hidden="true" className="sb-mcheck" />
        ) : (
          <kbd className="sb-kbd sb-mkey">{n}</kbd>
        )}
      </button>
    );
  };

  const list = (
    <div role="listbox" aria-label={t("markets.label")} onKeyDown={onListKey}>
      <div className="sb-menu-title">{t("markets.label")}</div>
      {row("tn", 1)}
      {row("ly", 2)}
      <div className="sb-menu-sep" role="separator" />
      {row("all", 3)}
      {variant !== "chip" && <div className="sb-menu-foot">{t("markets.hint")}</div>}
    </div>
  );

  const trigger =
    variant === "rail" ? (
      <button ref={triggerRef} type="button" className="sb-rbtn sb-rbtn-mk" aria-label={ariaLabel} title={name}
        aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
        <MarketFlag scope={current} size={22} radius={6} />
      </button>
    ) : variant === "chip" ? (
      <button ref={triggerRef} type="button" className="sb-mchip" aria-label={ariaLabel}
        aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <MarketFlag scope={current} size={20} radius={10} />
        {t(`markets.short.${current}`)}
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    ) : (
      <button ref={triggerRef} type="button" className="sb-mcard" aria-label={ariaLabel}
        aria-haspopup="listbox" aria-expanded={open} onClick={toggle}
        data-arrived={arrived ? "true" : undefined} onAnimationEnd={() => setArrived(false)}>
        <MarketFlag scope={current} size={32} radius={8} />
        <span className="sb-mtxt">
          <span className="sb-mname">{name}</span>
          <span className="sb-msub">{subLine(current, times)}</span>
        </span>
        <ChevronsUpDown size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );

  return (
    <div ref={wrapRef} className="sb-mwrap">
      {trigger}
      {open && variant === "chip" && (
        <div className="sb-sheet-wrap" onClick={(e) => e.target === e.currentTarget && close(true)}>
          <div className="sb-sheet" role="dialog" aria-modal="true" aria-label={t("markets.label")}>
            <div className="sb-grab" aria-hidden="true" />
            {list}
          </div>
        </div>
      )}
      {open && variant !== "chip" && (
        <div className={`sb-menu sb-mpop${variant === "rail" ? " sb-mpop-side" : ""}`}>{list}</div>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </div>
  );
}
