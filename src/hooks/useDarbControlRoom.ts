"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DarbStatusEntry } from "@/lib/carriers/darb-assabil-statuses";

export interface DarbAccountFunnel {
  carrier_id: string;
  carrier_name: string;
  total: number;
  by_status: Record<string, number>;
  in_flight: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  minutes_since_sync: number | null;
}

export interface DarbStuckShipment {
  order_id: string | null;
  darb_id: string;
  reference: string | null;
  status_slug: string | null;
  carrier_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  to_city: string | null;
  handler_name: string | null;
  handler_phone: string | null;
  handler_account_name: string | null;
  latest_remark: string | null;
  latest_comment: string | null;
  delayed_until: string | null;
  days_on_status: number;
  latest_event_at: string | null;
}

export interface DarbLostOrder {
  order_id: string;
  tracking_number: string | null;
  status: string;
  carrier_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  product_name: string | null;
  total_price: number | null;
  created_at: string;
  days_stranded: number;
}

export interface DarbCostRow {
  carrier_id: string;
  carrier_name: string;
  shipments_priced: number;
  avg_billed: number | null;
  min_billed: number | null;
  max_billed: number | null;
}

export interface DarbControlRoomData {
  accounts: DarbAccountFunnel[];
  statuses: DarbStatusEntry[];
  stuck: DarbStuckShipment[];
  lost: DarbLostOrder[];
  lost_total: number;
  cost: DarbCostRow[];
  cron: { schedule: string; active: boolean } | null;
  stuck_days_threshold: number;
}

/**
 * Darb Assabil operations data. Reads the local mirror, so it stays fast and
 * keeps working while the carrier API is down — the sweep is what talks to Darb.
 *
 * Refreshed on an interval rather than on focus: the underlying cron writes
 * every 10 minutes, so polling faster would only add load without adding news.
 */
export function useDarbControlRoom(enabled: boolean = true) {
  const { data, error, isLoading, mutate } = useSWR<DarbControlRoomData>(
    enabled ? "/api/darb/control-room" : null,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  return { data, error, isLoading, refresh: mutate };
}
