"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  resolveOrderPreferences,
  CODED_FULFILMENT_MODES,
  type ResolvedOrderPreferences,
  type ResolvedFulfilmentModes,
} from "@/lib/carriers/order-preferences";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Les défauts codés, calculés UNE fois pour tout le module.
 *
 * Identité stable obligatoire : le modal applique ces valeurs dans un effet
 * dépendant de l'objet. Le recalculer à chaque rendu donnait un nouvel objet à
 * chaque fois, donc un effet qui se redéclenchait sans fin — boucle de rendu
 * infinie qui faisait geler la suite de tests du modal avant même sa collecte.
 */
const CODED_FALLBACK: ResolvedOrderPreferences = resolveOrderPreferences([]);

/**
 * La politique d'options du transporteur, pour le modal de dispatch.
 *
 * Retombe sur les défauts codés tant que la réponse n'est pas là : le modal
 * doit pouvoir s'ouvrir et fonctionner même si l'appel échoue, exactement comme
 * avant l'existence de cette table.
 */
export function useCarrierOrderPreferences(carrierId: string | null): {
  preferences: ResolvedOrderPreferences;
  fulfilmentModes: ResolvedFulfilmentModes;
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<{
    data: ResolvedOrderPreferences;
    fulfilmentModes?: ResolvedFulfilmentModes;
  }>(
    carrierId ? `/api/carriers/${carrierId}/order-preferences` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  // Mémoïsé sur la donnée elle-même : tant que SWR rend la même réponse (ou
  // aucune), l'objet garde son identité et l'effet du modal ne rejoue pas.
  const preferences = useMemo(() => data?.data ?? CODED_FALLBACK, [data]);
  const fulfilmentModes = useMemo(
    () => data?.fulfilmentModes ?? CODED_FULFILMENT_MODES,
    [data],
  );

  return { preferences, fulfilmentModes, isLoading };
}
