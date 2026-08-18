/**
 * Darb Assabil status reading — the read-only side of the carrier integration.
 *
 * Two distinct endpoints, two distinct identifiers (a documented Darb gotcha):
 *  - Bucket slug  → GET /api/local/shipments/:id      (the internal _id)
 *      Returns the authoritative top-level `status` enum, in a list shape
 *      (`data.results[0]`). Drives the cached `carrier_status_slug` projection.
 *  - Timeline     → GET /api/local/shipments/timeline/:reference (the SH… code)
 *      Returns append-only bilingual events. Drives the detail-panel timeline.
 *
 * Vendor contract: HTTP 200 ≠ success — always check `body.status === true`.
 * Auth: "apikey " literal prefix + X-API-VERSION + X-ACCOUNT-ID headers.
 *
 * This module NEVER writes OMS state. The slug it produces is a projection;
 * callers persist it to `carrier_status_slug` and NEVER to `orders.status`.
 */

import type { CarrierConfig } from "./types";
import { normalizeDarbStatus, type DarbSlug } from "./darb-assabil-statuses";

export type DarbStatusSnapshot =
  | {
      kind: "ok";
      reference: string;
      slug: DarbSlug | null;
      rawStatus: string;
    }
  | {
      kind: "not_found";
      reference: string;
    };

export interface DarbTimelineEvent {
  type: string;
  /** Arabic label (Libya market); falls back to English if `ar` is absent. */
  labelAr: string;
  timestamp: string;
}

/**
 * Everything the by-`_id` endpoint gives us in ONE call: the authoritative
 * status snapshot, the REAL human reference (which the carrier re-assigns after
 * creation, so the stored tracking_number is unreliable), and the inline
 * timeline. This is the single trusted read for Darb status + timeline.
 */
export type DarbShipmentFull =
  | {
      kind: "ok";
      reference: string;
      slug: DarbSlug | null;
      rawStatus: string;
      timeline: DarbTimelineEvent[];
    }
  | {
      kind: "not_found";
      timeline: [];
    };

// ── Pure parsers ─────────────────────────────────────────────────────

/**
 * Parse a `GET /api/local/shipments/:id` body into a status snapshot. The
 * authoritative status lives at `data.results[0].status` (single-shipment GET
 * still returns a list shape). `body.status === false` or an empty result set
 * means the carrier doesn't recognize the shipment → not_found.
 */
export function parseShipmentStatus(
  reference: string,
  body: unknown,
): DarbStatusSnapshot {
  const b = asRecord(body);
  if (b.status !== true) return { kind: "not_found", reference };

  const results = asRecord(b.data).results;
  const first = Array.isArray(results) ? asRecord(results[0]) : {};
  const rawStatus = typeof first.status === "string" ? first.status : "";
  if (!rawStatus) return { kind: "not_found", reference };

  return {
    kind: "ok",
    reference,
    slug: normalizeDarbStatus(rawStatus),
    rawStatus,
  };
}

/**
 * Parse a `GET /api/local/shipments/timeline/:reference` body into ordered
 * (oldest-first) events. Returns [] when the body isn't a success envelope.
 */
export function parseTimeline(body: unknown): DarbTimelineEvent[] {
  const b = asRecord(body);
  if (b.status !== true) return [];
  return mapTimelineEvents(asRecord(b.data).timeline);
}

/**
 * Event types Darb emits that are low-value internal bookkeeping — the carrier
 * never gives them a real Arabic translation (ar === en raw English like
 * "Reference the order by 1113059" / "Box Reference the order by BX18KF"). We
 * drop them so the Arabic-RTL panel shows only meaningful milestones.
 */
const NOISY_DARB_EVENT_TYPES: ReadonlySet<string> = new Set(["referenced"]);

/** Map a raw timeline array (oldest-first) into DarbTimelineEvent[], dropping noise. */
function mapTimelineEvents(timeline: unknown): DarbTimelineEvent[] {
  if (!Array.isArray(timeline)) return [];
  const events: DarbTimelineEvent[] = [];
  for (const raw of timeline) {
    const e = asRecord(raw);
    const type = typeof e.type === "string" ? e.type : "info";
    if (NOISY_DARB_EVENT_TYPES.has(type)) continue;
    const desc = asRecord(e.description);
    const ar = typeof desc.ar === "string" && desc.ar ? desc.ar : null;
    const en = typeof desc.en === "string" && desc.en ? desc.en : null;
    events.push({
      type,
      labelAr: ar ?? en ?? "",
      timestamp: typeof e.timestamp === "string" ? e.timestamp : "",
    });
  }
  return events;
}

/**
 * Parse the by-`_id` (`GET /api/local/shipments/:id`) body into a full read:
 * status snapshot + the REAL reference + the inline timeline. The single-shipment
 * GET returns a list shape (`data.results[0]`) that carries `status`, `reference`,
 * and `timeline` together. `status !== true` or an empty result set → not_found.
 */
export function parseShipmentFull(
  storedReference: string,
  body: unknown,
): DarbShipmentFull {
  void storedReference; // the real reference comes from the response, not the input
  const b = asRecord(body);
  if (b.status !== true) return { kind: "not_found", timeline: [] };

  const results = asRecord(b.data).results;
  const first = Array.isArray(results) ? asRecord(results[0]) : null;
  if (!first) return { kind: "not_found", timeline: [] };

  const rawStatus = typeof first.status === "string" ? first.status : "";
  const reference = typeof first.reference === "string" ? first.reference : "";
  if (!rawStatus && !reference) return { kind: "not_found", timeline: [] };

  return {
    kind: "ok",
    reference,
    slug: normalizeDarbStatus(rawStatus),
    rawStatus,
    timeline: mapTimelineEvents(first.timeline),
  };
}

/**
 * One page of the shipment LIST endpoint. `records` are raw vendor objects —
 * projection into OMS shapes is `darb-assabil-shipment.ts`'s job, so this stays
 * a pure transport parser.
 */
export interface DarbShipmentPage {
  records: Array<Record<string, unknown>>;
  /** `data.totalCount`, or null when the caller didn't ask for it. */
  totalCount: number | null;
}

/**
 * Parse a `GET /api/local/shipments` (no `:id`) list body. Never throws — a
 * malformed or `status:false` body is an empty page, and the caller decides
 * whether that is an error.
 */
export function parseShipmentPage(body: unknown): DarbShipmentPage {
  const b = asRecord(body);
  if (b.status !== true) return { records: [], totalCount: null };

  const data = asRecord(b.data);
  const results = data.results;
  return {
    records: Array.isArray(results)
      ? results.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      : [],
    totalCount: typeof data.totalCount === "number" ? data.totalCount : null,
  };
}

// ── Fetchers ─────────────────────────────────────────────────────────

/**
 * Fetch the authoritative status for a shipment via its internal `_id`.
 * A missing `internalId` (order dispatched before _id capture) short-circuits
 * to not_found without an HTTP call — we can't address the shipment.
 */
export async function fetchDarbStatus(
  reference: string,
  internalId: string,
  config: CarrierConfig,
): Promise<DarbStatusSnapshot> {
  if (!internalId) return { kind: "not_found", reference };
  const base = baseUrl(config);
  const { body } = await getJson(
    `${base}/api/local/shipments/${encodeURIComponent(internalId)}`,
    config,
  );
  return parseShipmentStatus(reference, body);
}

/**
 * Fetch the full shipment by its internal `_id`: status + real reference +
 * inline timeline, in one call. Preferred over fetchDarbTimeline (whose
 * `:reference` endpoint depends on the unreliable stored tracking_number).
 * A missing `internalId` short-circuits to not_found without an HTTP call.
 */
export async function fetchDarbShipment(
  internalId: string,
  config: CarrierConfig,
): Promise<DarbShipmentFull> {
  if (!internalId) return { kind: "not_found", timeline: [] };
  const base = baseUrl(config);
  const { body } = await getJson(
    `${base}/api/local/shipments/${encodeURIComponent(internalId)}`,
    config,
  );
  return parseShipmentFull("", body);
}

/**
 * Fetch ONE PAGE of the account's shipments via the list endpoint.
 *
 * `GET /api/local/shipments` with the `:id` segment omitted is a paginated list
 * (vendor Postman marks `:id` "(optional)"). Verified live 2026-08-17: `limit=500`
 * is served, `sort` and `offset` work, and `data.totalCount` is exact. That makes
 * a full two-account mirror ~3 requests instead of one request per order.
 *
 * Sorted newest-updated-first so a caller can stop early once it reaches records
 * older than its last successful sweep.
 *
 * DO NOT add a multi-value filter here. Darb rejects a comma-separated enum with
 * HTTP 400 "Invalid choice!", and — far worse — silently honours only the LAST
 * value of a repeated param, returning confidently wrong data. Filter locally.
 * See docs/darb-assabil-sync.md §1.
 */
export async function fetchDarbShipmentPage(
  config: CarrierConfig,
  options: { offset: number; limit: number; status?: DarbSlug },
): Promise<DarbShipmentPage> {
  const base = baseUrl(config);
  const params = new URLSearchParams({
    offset: String(options.offset),
    limit: String(options.limit),
    includeTotalCount: "true",
    sort: '{"updatedAt":-1}',
  });
  // Single value only — never `append`.
  if (options.status) params.set("status", options.status);

  const { body } = await getJson(`${base}/api/local/shipments?${params}`, config);
  return parseShipmentPage(body);
}

/** Fetch the append-only timeline for a shipment via its `SH…` reference. */
export async function fetchDarbTimeline(
  reference: string,
  config: CarrierConfig,
): Promise<DarbTimelineEvent[]> {
  const base = baseUrl(config);
  const { body } = await getJson(
    `${base}/api/local/shipments/timeline/${encodeURIComponent(reference)}`,
    config,
  );
  return parseTimeline(body);
}

// ── Internals ────────────────────────────────────────────────────────

function baseUrl(config: CarrierConfig): string {
  return (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
}

/** The three headers every Darb Assabil request needs (apikey literal prefix). */
function buildHeaders(config: CarrierConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `apikey ${config.apiCredentials.api_key}`,
    "X-API-VERSION": "1.0.0",
    "X-ACCOUNT-ID": config.apiCredentials.account_id,
  };
}

/** GET JSON with a 15s timeout; parse JSON body, falling back to raw text. */
async function getJson(
  url: string,
  config: CarrierConfig,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(config),
    signal: AbortSignal.timeout(15000),
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = await response.text();
  }
  return { status: response.status, body: parsed };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
