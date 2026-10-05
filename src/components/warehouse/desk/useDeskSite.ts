"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import type { DeskSite } from "./ui";

/**
 * Which building the desk is looking at — « Les deux », Tripoli or Benghazi.
 *
 * It lives in the ADDRESS (`?warehouse_id=`), the same parameter the server
 * pages already read, so a link from Aujourd'hui to Sortir keeps the building
 * and a reload does not forget it. Null means every building.
 */
export function useDeskSite() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data } = useSWR<WarehouseSitesResponse>("/api/warehouse/sites", jsonFetcher, {
    revalidateOnFocus: false,
  });

  const sites: DeskSite[] = useMemo(() => (data?.sites ?? []).map((s) => ({ id: s.id, name: s.name })), [data]);
  const requested = search.get("warehouse_id");
  const siteId = requested && (!data || sites.some((s) => s.id === requested)) ? requested : null;

  const setSite = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(search.toString());
      if (id) params.set("warehouse_id", id);
      else params.delete("warehouse_id");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, search],
  );

  const nameOf = useCallback((id: string | null | undefined) => sites.find((s) => s.id === id)?.name ?? null, [sites]);

  return { sites, siteId, setSite, nameOf, loaded: !!data, unassigned: data?.unassigned ?? false };
}
