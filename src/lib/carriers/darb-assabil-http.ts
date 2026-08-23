/**
 * The three headers every Darb Assabil request needs, in one place.
 *
 * Lifted out of `darb-assabil-tracking.ts` when the write path
 * (`darb-assabil-reference.ts`) needed the same transport. A missing header
 * fails *silently* rather than returning 401 — a documented vendor gotcha — so
 * having two copies drift apart would be an expensive kind of bug to find.
 *
 * Transport errors are returned, not thrown: every caller is on a path where a
 * carrier being unreachable is an ordinary outcome to report, not an exception
 * to propagate.
 */

import type { CarrierConfig } from "./types";

const TIMEOUT_MS = 15_000;

export type DarbResponse =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string };

/** Absolute URL for a path, honouring the carrier row's configured endpoint. */
export function darbUrl(config: CarrierConfig, path: string): string {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  return `${base}${path}`;
}

/** Authorization uses the literal "apikey " prefix — not "Bearer". */
export function darbHeaders(config: CarrierConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `apikey ${config.apiCredentials.api_key}`,
    "X-API-VERSION": "1.0.0",
    "X-ACCOUNT-ID": config.apiCredentials.account_id,
  };
}

/**
 * One request, with the headers and the timeout applied. The body is parsed as
 * JSON where possible and handed back raw where not — callers check
 * `body.status === true` themselves, because HTTP 200 does not mean success.
 */
export async function darbFetch(
  url: string,
  config: CarrierConfig,
  init: { method: string; body?: string },
): Promise<DarbResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: darbHeaders(config),
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : "Darb injoignable",
    };
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body — hand back the raw text */
  }
  return { ok: true, status: response.status, body };
}
