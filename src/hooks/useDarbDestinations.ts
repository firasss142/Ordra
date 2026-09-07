"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import {
  staticDestinations,
  type DarbDestinationOption,
} from "@/lib/carriers/darb-destination-search";

interface DestinationsResponse {
  destinations: Array<{ id: number; city: string; area: string }>;
}

/**
 * The Darb Assabil destination catalogue with row ids (what an order stores as
 * `darb_destination_id`). Until the API answers — or if it fails — the bundled
 * catalogue is served with `id: null`, so a picker can render immediately and
 * the dispatch step (which ships by name) never waits on the network.
 */
export function useDarbDestinations(enabled = true): {
  destinations: DarbDestinationOption[];
  /** True once the rows carry database ids. */
  hasIds: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<DestinationsResponse>(
    enabled ? "/api/darb/destinations" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );
  const rows = data?.destinations;
  if (rows && rows.length > 0) {
    return { destinations: rows, hasIds: true, isLoading: false };
  }
  return { destinations: staticDestinations(), hasIds: false, isLoading: Boolean(isLoading) };
}
