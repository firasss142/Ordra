"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useRealtimeBroadcast } from "@/components/providers/RealtimeProvider";
import { ORDERS_BROADCAST_EVENT, ordersTopic, type OrderChangedPayload } from "@/hooks/useOrdersRealtime";
import { useDeliveryActionQueue } from "@/hooks/useDeliveryActionQueue";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { shouldRefreshWorklist } from "@/lib/delivery/worklist";
import type { DeliveryScorecard, WorklistResponse } from "@/lib/delivery/types";
import type { Role } from "@/types";
import { DeliveryWorklistView } from "./DeliveryWorklistView";

/** How long a burst of order events waits before one refetch. */
const COALESCE_MS = 400;

/**
 * Data side of "Suivi livraison": the worklist, the agent's scorecard, the
 * action queue with its undo window, and live refresh from the
 * `orders:market:<id>` topic. Everything visual is DeliveryWorklistView.
 */
export function DeliveryWorklistClient({
  role, viewerId, marketId, locale,
}: { role: Role; viewerId: string; marketId: string | null; locale: string }) {
  const t = useTranslations("delivery");
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : marketId;

  // Parcels that closed in the last 24 h are 42% of the Libyan list and need
  // nothing done to them, so the first paint leaves them in the database. The
  // view asks for them the moment the agent opens the "terminées" tab, and
  // once asked we keep asking — the key changes, SWR refetches, and the
  // previous rows stay on screen while it does.
  const [withDone, setWithDone] = useState(false);
  // The bare key is deliberate: AgentNavTabs prefetches and badges from
  // exactly "/api/delivery/worklist", and SWR shares one request only when the
  // strings match. A query string is added only once there is something to add.
  const params = new URLSearchParams({
    ...(role === "super_admin" && market ? { market_id: market } : {}),
    ...(withDone ? { include_done: "1" } : {}),
  }).toString();
  const key = market ? `/api/delivery/worklist${params ? `?${params}` : ""}` : null;

  const { data, error, mutate } = useSWR<WorklistResponse>(key, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  const { data: score } = useSWR<{ data: DeliveryScorecard }>(role === "agent" ? "/api/delivery/scorecard" : null, fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  });

  const [notice, setNotice] = useState<"undone" | "failed" | null>(null);
  const queue = useDeliveryActionQueue({ worklistKey: key, onFailed: () => setNotice("failed") });
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(id);
  }, [notice]);

  // Durations and "Aujourd'hui" are relative; a minute's resolution is enough.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const rowsRef = useRef(data?.rows ?? []);
  rowsRef.current = data?.rows ?? [];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSignal = useCallback((payload: OrderChangedPayload) => {
    if (!payload?.id || !shouldRefreshWorklist(payload, rowsRef.current, viewerId, role)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void mutate();
    }, COALESCE_MS);
  }, [mutate, role, viewerId]);
  useRealtimeBroadcast<OrderChangedPayload>(market ? { topic: ordersTopic(market), event: ORDERS_BROADCAST_EVENT } : null, onSignal);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!market) {
    return <div className="mx-auto max-w-[1480px] px-5 py-16 text-center text-[15px] text-[#6B7280]">{t("selectMarket")}</div>;
  }

  return (
    <DeliveryWorklistView
      rows={data?.rows ?? null}
      error={Boolean(error)}
      onRetry={() => void mutate()}
      scorecard={score?.data ?? null}
      role={role}
      marketCode={marketIdToCode(market) ?? "tn"}
      tz={marketTimezone(market)}
      locale={locale}
      now={now}
      pending={queue.pending}
      notice={notice}
      onQueue={(row, body) => { setNotice(null); queue.queue(row, body); }}
      onUndo={() => { queue.undo(); setNotice("undone"); }}
      onDismissNotice={() => setNotice(null)}
      onNeedDone={() => setWithDone(true)}
    />
  );
}
