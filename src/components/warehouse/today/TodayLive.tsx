"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { PickupSwitch } from "@/components/warehouse/pickup/PickupSwitch";
import { TodayHome } from "./TodayHome";
import { TodayDesk } from "./TodayDesk";

/**
 * « Aujourd'hui », live. The server paints the first frame with the same
 * assembly the route returns; SWR keeps it current. A minute is enough: these
 * are backlogs, not a scan feed, and the agent changes them from other screens.
 */
export function TodayLive({
  initial,
  variant,
  locale,
  dateLabel,
  warehouseId,
  showPickup,
}: {
  initial: TodayResponse;
  variant: "agent" | "desk";
  locale: string;
  dateLabel: string;
  /** The building the desk is narrowed to (?warehouse_id), part of the key. */
  warehouseId: string | null;
  /** The driver switch exists only where Darb collects (Libya). */
  showPickup: boolean;
}) {
  const key = `/api/warehouse/today${warehouseId && variant === "desk" ? `?warehouse_id=${warehouseId}` : ""}`;
  const { data } = useSWR<TodayResponse>(key, jsonFetcher, {
    fallbackData: initial,
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });
  const payload = data ?? initial;

  if (variant === "agent") {
    return (
      <TodayHome
        data={payload}
        locale={locale}
        dateLabel={dateLabel}
        pickup={showPickup ? <PickupSwitch variant="bench" /> : undefined}
      />
    );
  }
  if (payload.siteUnassigned) return null;
  return (
    <TodayDesk
      data={payload}
      locale={locale}
      dateLabel={dateLabel}
      pickup={showPickup ? <PickupSwitch variant="console" /> : undefined}
    />
  );
}
