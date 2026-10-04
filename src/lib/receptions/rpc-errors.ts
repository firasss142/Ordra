import { NextResponse } from "next/server";

/**
 * Traduire une erreur de RPC en statut HTTP.
 *
 * Les RPC de réception portent leur code dans `DETAIL`, en JSON, parce que
 * PostgREST ne laisse pas passer autre chose. Toutes les routes de ce domaine
 * lisaient ce JSON à la main et retombaient sur des échelles légèrement
 * différentes — une seule table, maintenant.
 */
export interface RpcError {
  message: string;
  details?: unknown;
}

const BY_CODE: Record<string, number> = {
  ACTOR_MISMATCH: 403,
  ACTOR_NOT_FOUND: 403,
  FORBIDDEN: 403,
  MARKET_MISMATCH: 403,
  NO_SITE_ASSIGNED: 403,
  WRONG_SITE: 403,
  NO_RECEPTION: 404,
  // Les bons de commande partagent cette table : même convention de DETAIL,
  // même échelle. Deux tables auraient divergé en une semaine.
  NOT_FOUND: 404,
  NO_PRODUCT: 404,
  NO_LINE: 404,
  NO_WAREHOUSE: 404,
  NO_SUPPLIER: 404,
  ALREADY_SETTLED: 409,
  ALREADY_CLOSED: 409,
  ALREADY_RESOLVED: 409,
  RECEPTION_IMMUTABLE: 409,
  // Une course sur le document du jour : l'appelant peut réessayer tel quel.
  RETRY: 409,
  // Le rapprochement bloque. 422 et non 400 : la requête est bien formée, c'est
  // le MONDE qui ne tombe pas juste, et l'écran doit pouvoir le raconter.
  DISCREPANCY: 422,
};

export function rpcErrorCode(error: RpcError): string | null {
  const detail = typeof error.details === "string" ? error.details : "";
  return detail.match(/"code"\s*:\s*"([A-Z_]+)"/)?.[1] ?? null;
}

export function rpcErrorResponse(error: RpcError): NextResponse {
  const code = rpcErrorCode(error);
  const status = (code ? BY_CODE[code] : undefined) ?? 422;
  return NextResponse.json({ error: error.message, error_code: code }, { status });
}
