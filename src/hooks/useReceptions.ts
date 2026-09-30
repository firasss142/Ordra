"use client";

import useSWR from "swr";
import type { ProjectedReception } from "@/lib/receptions/project";

/**
 * Les réceptions du bâtiment courant.
 *
 * UN VRAI HOOK, PAS UN `useSWR` EN LIGNE. Les écrans Stock appellent `useSWR`
 * directement avec un `fetcher` local (WarehouseStockClient, StockCard,
 * JournalConsole) et c'est précisément pour cela que le scope de marché n'est
 * jamais attaché à `/api/warehouse/stock`. Une clé construite en un seul
 * endroit ne peut pas oublier un paramètre.
 *
 * PAS D'OBJET `fallbackData` CONSTRUIT À CHAQUE RENDU. Un littéral frais à
 * chaque passage change d'identité, SWR le considère comme de nouvelles données
 * et le composant se re-rend en boucle — c'est ce qui avait figé une modale.
 * Les constantes ci-dessous sont gelées au niveau du module.
 */

const NO_RECEPTIONS: ProjectedReception[] = [];

export interface ReceptionCounts {
  all: number;
  draft: number;
  submitted: number;
  posted: number;
  late: number;
}

const NO_COUNTS: ReceptionCounts = { all: 0, draft: 0, submitted: 0, posted: 0, late: 0 };

export interface ReceptionsPayload {
  receptions: ProjectedReception[];
  currency: string;
  counts?: ReceptionCounts;
  site?: { warehouse_id: string | null; pinned: boolean };
  unassigned?: boolean;
  error_code?: string;
}

async function fetcher(url: string): Promise<ReceptionsPayload> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? String(res.status));
  }
  return res.json();
}

export function buildReceptionsKey(input: {
  status?: string | null;
  warehouseId?: string | null;
  marketId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.warehouseId) params.set("warehouse_id", input.warehouseId);
  if (input.marketId) params.set("market_id", input.marketId);
  const qs = params.toString();
  return `/api/warehouse/receptions${qs ? `?${qs}` : ""}`;
}

export function useReceptions(input: {
  status?: string | null;
  warehouseId?: string | null;
  marketId?: string | null;
}) {
  const key = buildReceptionsKey(input);
  const { data, error, isLoading, mutate } = useSWR<ReceptionsPayload>(key, fetcher, {
    // Une réception validée ailleurs doit apparaître sans rechargement de page,
    // mais l'écran n'est pas un tableau de bord : une minute suffit.
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  return {
    receptions: data?.receptions ?? NO_RECEPTIONS,
    counts: data?.counts ?? NO_COUNTS,
    currency: data?.currency ?? "TND",
    site: data?.site,
    // Un agent sans bâtiment ne voit rien, et l'écran doit le DIRE plutôt que
    // d'afficher une liste vide indistinguable d'un entrepôt calme.
    unassigned: data?.unassigned === true,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Une seule réception, sa feuille ouverte. */
export function useReception(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ reception: ProjectedReception }>(
    id ? `/api/warehouse/receptions/${id}` : null,
    fetcher as unknown as (url: string) => Promise<{ reception: ProjectedReception }>,
    { revalidateOnFocus: true, keepPreviousData: false },
  );

  return {
    reception: data?.reception,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
