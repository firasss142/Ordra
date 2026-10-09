"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { PickupSwitch } from "@/components/warehouse/pickup/PickupSwitch";
import { TodayHome } from "./TodayHome";
import { TodayDesk } from "@/components/warehouse/desk/TodayDesk";

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
  marketCode = null,
  marketId = null,
  today = "",
}: {
  initial: TodayResponse;
  variant: "agent" | "desk";
  locale: string;
  dateLabel: string;
  /** The building the desk is narrowed to (?warehouse_id), part of the key. */
  warehouseId: string | null;
  /** The driver switch exists only where Darb collects (Libya). */
  showPickup: boolean;
  marketCode?: "ly" | "tn" | null;
  marketId?: string | null;
  /** The market's local date, YYYY-MM-DD. */
  today?: string;
}) {
  // The desk names buildings in the reader's language (as the server painted them); the agent's
  // key stays bare, shared with the shell's badge, and its market language is the reader's anyway.
  const key =
    variant === "desk"
      ? `/api/warehouse/today?locale=${locale === "ar" ? "ar" : "fr"}${warehouseId ? `&warehouse_id=${warehouseId}` : ""}`
      : "/api/warehouse/today";
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
  // The desk says whether the driver came on each building's card; the switch
  // itself lives on Sortir only (prototypes/entrepot-desk-v1.html).
  return (
    <TodayDesk
      data={payload}
      locale={locale}
      dateLabel={dateLabel}
      marketCode={marketCode}
      marketId={marketId}
      today={today}
    />
  );
}
