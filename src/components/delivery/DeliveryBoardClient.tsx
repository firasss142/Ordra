"use client";

/**
 * Data side of the manager board: the market's worklist, the per-agent
 * activity behind the verdicts, the action queue with its undo window, and
 * live refresh from the `orders:market:<id>` topic. Everything visual is
 * DeliveryBoardView.
 *
 * The two requests are independent, so SWR issues them together: the worklist
 * moves with every carrier event, the board's activity is a day's counting and
 * refreshes far more slowly.
 */
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
import { DEFAULT_TARGET_HOURS } from "@/lib/delivery/board";
import type { DeliveryBoardResponse, WorklistResponse } from "@/lib/delivery/types";
import type { Role } from "@/types";
import { DeliveryBoardView } from "./DeliveryBoardView";

const COALESCE_MS = 400;

export function DeliveryBoardClient({
  role, viewerId, marketId, locale,
}: { role: Role; viewerId: string; marketId: string | null; locale: string }) {
  const t = useTranslations("delivery");
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : marketId;

  const [withDone, setWithDone] = useState(false);
  const params = new URLSearchParams({
    ...(role === "super_admin" && market ? { market_id: market } : {}),
    ...(withDone ? { include_done: "1" } : {}),
  }).toString();
  const worklistKey = market ? `/api/delivery/worklist${params ? `?${params}` : ""}` : null;
  const boardKey = market ? `/api/delivery/board${role === "super_admin" ? `?market_id=${market}` : ""}` : null;

  const { data, error, mutate } = useSWR<WorklistResponse>(worklistKey, fetcher, {
    refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true,
  });
  // Actions today and the week strip are counts over a day: a minute-by-minute
  // refresh would buy nothing and cost a query per manager per minute.
  const { data: board, mutate: mutateBoard } = useSWR<DeliveryBoardResponse>(boardKey, fetcher, {
    refreshInterval: 300_000, revalidateOnFocus: true, keepPreviousData: true,
  });

  const [notice, setNotice] = useState<"undone" | "failed" | null>(null);
  const queue = useDeliveryActionQueue({ worklistKey, onFailed: () => setNotice("failed") });
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(id);
  }, [notice]);

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

  /**
   * Moving parcels to another agent. The existing bulk endpoint writes the
   * history rows, so a reassignment is auditable; both views are refetched
   * because ownership changes who a parcel counts for on the board as well as
   * where it sits in the list.
   */
  const onReassign = useCallback(async (orderIds: string[], targetAgentId: string) => {
    const res = await fetch("/api/orders/bulk-reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: orderIds, target_agent_id: targetAgentId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error === "locked" ? t("reassign.locked") : t("reassign.failed"));
    }
    await Promise.all([mutate(), mutateBoard()]);
  }, [mutate, mutateBoard, t]);

  if (!market) {
    return <div className="mx-auto max-w-[1480px] px-5 py-16 text-center text-[15px] text-[#6B7280]">{t("selectMarket")}</div>;
  }

  const code = marketIdToCode(market) ?? "tn";
  return (
    <DeliveryBoardView
      rows={data?.rows ?? null}
      error={Boolean(error)}
      onRetry={() => void mutate()}
      activity={board?.agents ?? []}
      targetHours={board?.target_hours ?? DEFAULT_TARGET_HOURS}
      role={role}
      marketCode={code}
      marketLabel={t(`board.markets.${code}`)}
      tz={marketTimezone(market)}
      locale={locale}
      now={now}
      pending={queue.pending}
      notice={notice}
      onQueue={(row, body) => { setNotice(null); queue.queue(row, body); }}
      onUndo={() => { queue.undo(); setNotice("undone"); }}
      onDismissNotice={() => setNotice(null)}
      onNeedDone={() => setWithDone(true)}
      onReassign={onReassign}
    />
  );
}
