"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { scopeToMarketId, type MarketCode, type MarketScope } from "@/lib/markets";

const COOKIE_NAME = "oms_scope_market";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

interface MarketScopeContextValue {
  scope: MarketScope;
  marketId: string | null;
  marketCode: MarketCode | null;
  setScope: (next: MarketScope) => void;
}

const MarketScopeContext = createContext<MarketScopeContextValue | null>(null);

function writeCookie(value: MarketScope) {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function MarketScopeProvider({
  initialScope,
  children,
}: {
  initialScope: MarketScope;
  children: ReactNode;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [scope, setScopeState] = useState<MarketScope>(initialScope);

  const setScope = useCallback(
    (next: MarketScope) => {
      setScopeState((prev) => {
        if (prev === next) return prev;
        writeCookie(next);
        return next;
      });
      router.refresh();
      mutate(() => true, undefined, { revalidate: true });
    },
    [router, mutate],
  );

  const value = useMemo<MarketScopeContextValue>(() => {
    const marketId = scopeToMarketId(scope);
    return {
      scope,
      marketId,
      marketCode: scope === "all" ? null : scope,
      setScope,
    };
  }, [scope, setScope]);

  return <MarketScopeContext.Provider value={value}>{children}</MarketScopeContext.Provider>;
}

export function useMarketScope(): MarketScopeContextValue {
  const ctx = useContext(MarketScopeContext);
  if (!ctx) {
    throw new Error("useMarketScope must be used inside <MarketScopeProvider>");
  }
  return ctx;
}
