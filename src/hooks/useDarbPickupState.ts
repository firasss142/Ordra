"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import type {
  PickupSiteState,
  PickupCarrierLink,
} from "@/app/api/warehouse/pickup/route";

/**
 * Is Darb's pickup switched off today for the site a given carrier ships from?
 *
 * The dispatch modal holds a carrier id; the switch is per building. The route
 * returns both, so the mapping happens here rather than in every caller. This
 * is for DISPLAY only — `performDispatch` re-reads the switch server-side and
 * overrides `extra.is_pickup` there, because the dispatch route copies the
 * client's `extra` verbatim.
 */
export function useDarbPickupState(carrierId: string | null | undefined) {
  const { data } = useSWR<{
    sites: PickupSiteState[];
    carriers: PickupCarrierLink[];
  }>("/api/warehouse/pickup", jsonFetcher, { revalidateOnFocus: true });

  if (!carrierId || !data) return { disabled: false, siteName: null as string | null };

  const link = data.carriers.find((c) => c.carrierId === carrierId);
  if (!link) return { disabled: false, siteName: null as string | null };

  const site = data.sites.find((s) => s.warehouseId === link.warehouseId);
  return {
    disabled: Boolean(site?.disabled),
    siteName: site?.name ?? null,
  };
}
