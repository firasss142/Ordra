"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { TemplateRow } from "@/components/whatsapp/TemplatesTable";

/** The market's registry, for the composer's chips (it filters APPROVED itself). */
export function useWhatsAppTemplates(marketId: string | null) {
  const { data, isLoading, mutate } = useSWR<{ data: TemplateRow[] }>(
    marketId ? `/api/whatsapp/templates?market_id=${marketId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  return { templates: data?.data ?? [], isLoading, mutate };
}
