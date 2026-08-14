/**
 * Meta Marketing API (Graph) client — campaign insights and account metadata.
 *
 * SERVER-SIDE ONLY. This module handles a long-lived system-user access token,
 * which must never reach a browser bundle. Nothing here may be imported from a
 * client component.
 *
 * Parsing lives in insights.ts, which is pure and fully tested. This file owns
 * only the things that need a network: URL construction, pagination, throttle
 * reporting and error classification. It returns raw MetaInsightsRow values and
 * lets the caller normalise them, so the transport can be exercised against the
 * live API without dragging the arithmetic along.
 *
 * ── Pinning ────────────────────────────────────────────────────────────────
 * The Graph version is pinned, never floating. Meta ships breaking changes on
 * roughly a quarterly cadence and an unversioned call silently follows the
 * newest release, so a sync that worked yesterday can start returning a
 * different shape with no deploy on our side. v26.0 is current (29 Jul 2026);
 * v24.0 is the oldest still supported, which is the floor for how long we can
 * leave this untouched.
 *
 * ── Attribution windows ────────────────────────────────────────────────────
 * We deliberately do NOT send action_attribution_windows. Meta removed the
 * 7-day-view and 28-day-view windows on 12 Jan 2026, and requesting a removed
 * window does not raise an error — it returns no data at all. Omitting the
 * parameter takes the account's default and is the only safe option.
 */

import type { MetaInsightsRow } from "./insights";

/** Current pinned Graph version. See the header on why this is not floating. */
const DEFAULT_GRAPH_VERSION = "v26.0";

/** Meta caps insights pages well below this; 200 keeps the page count sane. */
const PAGE_LIMIT = 200;

/** Matches the timeout every other outbound integration in this repo uses. */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Hard stop on pagination. A cursor loop that never terminates would hang the
 * sync job indefinitely; at 200 rows a page this still covers ~40k daily rows,
 * far more than any account we run produces in one window.
 */
const MAX_PAGES = 200;

/**
 * The fields we ask for, in Meta's own naming. Everything here arrives as a
 * numeric string except actions, which is an array of {action_type, value}
 * where value is itself a string.
 */
const INSIGHTS_FIELDS = [
  "campaign_id",
  "campaign_name",
  // Needed to decide which lead action type to believe — without it the
  // objective branch in extractLeadCount is unreachable and every campaign
  // silently falls back to the pixel count.
  "objective",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "actions",
  "account_currency",
  "date_start",
  "date_stop",
].join(",");

export interface MetaClientConfig {
  /** Ad account id, with or without the `act_` prefix — both are accepted. */
  adAccountId: string;
  /** System-user access token. Never logged, never placed in an error. */
  accessToken: string;
  /** Graph version override; defaults to the pinned DEFAULT_GRAPH_VERSION. */
  graphVersion?: string;
}

export interface FetchInsightsParams {
  /** Inclusive start date, YYYY-MM-DD. */
  since: string;
  /** Inclusive end date, YYYY-MM-DD. */
  until: string;
  /** Optional caller cancellation, combined with the per-request timeout. */
  signal?: AbortSignal;
}

export interface FetchInsightsResult {
  rows: MetaInsightsRow[];
  /**
   * Account-level rate-limit utilisation percentage from the last response, or
   * null when Meta sent no usable throttle header. The caller backs off as this
   * approaches 100.
   */
  accUtilPct: number | null;
}

export interface MetaAccountMeta {
  name: string;
  currency: string;
  timezoneName: string;
}

/**
 * A classified Graph API failure.
 *
 * The booleans exist so callers never have to remember Meta's numbering. The
 * three cases are handled very differently: a throttle should back off and
 * retry the same window later, a window-too-large should split the range and
 * retry immediately, and an auth failure should stop the sync and alert a human
 * because no amount of retrying will fix a revoked token.
 */
export class MetaApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly isThrottle: boolean;
  readonly isAuthFailure: boolean;
  /** Code 100 / subcode 1487534: retry with a narrower time_range. */
  readonly isWindowTooLarge: boolean;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    opts: {
      code?: number | null;
      subcode?: number | null;
      httpStatus?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "MetaApiError";
    this.code = opts.code ?? null;
    this.subcode = opts.subcode ?? null;
    this.httpStatus = opts.httpStatus ?? null;

    const code = this.code;
    // 4 is the Business-Use-Case rate limit; 17 is per-user; 613 is the
    // per-endpoint custom limit; the 80000 block is the newer per-product
    // family. 4/1504022 is Meta shedding load globally rather than throttling
    // us specifically, but it is retried the same way, so it lands here too.
    this.isThrottle =
      code === 4 || code === 17 || code === 613 || (code !== null && code >= 80000);
    this.isAuthFailure = code === 190;
    this.isWindowTooLarge = code === 100 && this.subcode === 1487534;
  }
}

/** Normalise an account id to the `act_<digits>` form Graph expects. */
function actId(adAccountId: string): string {
  const trimmed = adAccountId.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function graphBase(cfg: MetaClientConfig): string {
  return `https://graph.facebook.com/${cfg.graphVersion || DEFAULT_GRAPH_VERSION}`;
}

/**
 * Strip anything credential-shaped out of text that might end up in an error
 * message or a log line. Meta echoes the full request URL in some error
 * payloads, and `paging.next` always carries the token, so any string derived
 * from a response has to pass through here before it escapes this module.
 */
function redact(text: string): string {
  return text.replace(/access_token=[^&\s"]+/gi, "access_token=[REDACTED]");
}

/** Remove an inline credential from a URL Meta handed back to us. */
function stripToken(url: string): string {
  return url.replace(/([?&])access_token=[^&]*(&|$)/gi, (_m, lead, tail) =>
    tail === "&" ? lead : "",
  );
}

/**
 * Combine the caller's cancellation signal with a per-request timeout.
 * AbortSignal.any is not available on every runtime we might land on, so we
 * degrade to the timeout alone rather than throwing on an older engine.
 */
function requestSignal(caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!caller) return timeout;
  const anyOf = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  return typeof anyOf === "function" ? anyOf([caller, timeout]) : timeout;
}

/**
 * Read acc_id_util_pct out of the throttle header.
 *
 * The header is x-fb-ads-insights-throttle — NOT X-Business-Use-Case-Usage,
 * which covers a different family of endpoints and is absent here. Its value is
 * a JSON string carrying app_id_util_pct, acc_id_util_pct and
 * ads_api_access_tier.
 *
 * This never throws. The header is advisory: it tells us how hard to back off,
 * and a malformed or missing one is not a reason to fail a request whose body
 * arrived perfectly intact.
 */
function parseThrottleHeader(headers: Headers): number | null {
  try {
    const raw = headers.get("x-fb-ads-insights-throttle");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pct = parsed?.acc_id_util_pct;
    return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** GET with the standard 15s timeout; parse JSON, falling back to raw text. */
async function getJson(
  url: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  // The token travels as a header, never as a query parameter. A credential in
  // a URL is recorded by Meta's edge, by any egress proxy, and by anything that
  // captures outbound request URLs for telemetry — and this one has spending
  // authority on a live ad account. Graph accepts Bearer auth on every endpoint.
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: requestSignal(signal),
  });
  // Read the body once as text: a failed response.json() has already consumed
  // the stream, so a second read would throw instead of yielding the fallback.
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

/**
 * Turn a non-2xx Graph response into a classified MetaApiError. Meta returns
 * {"error":{"message","code","error_subcode","fbtrace_id"}}; anything that does
 * not match that shape is reported by HTTP status alone.
 */
function toApiError(status: number, body: unknown): MetaApiError {
  const error = asRecord(asRecord(body).error);
  const code = typeof error.code === "number" ? error.code : null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  const message =
    typeof error.message === "string" && error.message
      ? error.message
      : `Meta Graph API request failed with HTTP ${status}`;
  const trace = typeof error.fbtrace_id === "string" ? ` (fbtrace_id ${error.fbtrace_id})` : "";

  // redact() guards the message: Meta sometimes echoes the request URL back,
  // and that URL contains the access token.
  return new MetaApiError(redact(message) + trace, { code, subcode, httpStatus: status });
}

/**
 * Fetch daily campaign-level insights for a date range.
 *
 * Uses level=campaign with time_increment=1, so each row is one campaign on one
 * day. That granularity is required, not merely convenient: reach and frequency
 * are de-duplicated per person per period and are therefore NOT summable across
 * daily rows, so requesting a single aggregated row for the range would give a
 * reach we could never rebuild by day, while requesting days lets us aggregate
 * the additive metrics ourselves and leave reach alone.
 *
 * Follows `paging.next` cursors until Meta stops sending one. The returned
 * accUtilPct is the reading from the most recent response, which is the one
 * that reflects the load we have just added.
 */
export async function fetchCampaignInsights(
  cfg: MetaClientConfig,
  params: FetchInsightsParams,
): Promise<FetchInsightsResult> {
  const query = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: params.since, until: params.until }),
    fields: INSIGHTS_FIELDS,
    limit: String(PAGE_LIMIT),
  });
  // Note the absence of action_attribution_windows — see the module header.

  let url: string | null = `${graphBase(cfg)}/${actId(cfg.adAccountId)}/insights?${query}`;
  const rows: MetaInsightsRow[] = [];
  let accUtilPct: number | null = null;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { status, body, headers } = await getJson(url, cfg.accessToken, params.signal);

    // Read the throttle reading even on a failure — a 4 tells us we are rate
    // limited, and the header tells the caller how long to wait it out.
    const util = parseThrottleHeader(headers);
    if (util !== null) accUtilPct = util;

    if (status < 200 || status >= 300) throw toApiError(status, body);

    const payload = asRecord(body);
    const data = payload.data;
    if (Array.isArray(data)) rows.push(...(data as MetaInsightsRow[]));

    // `next` is a fully-formed URL that still carries the token inline, because
    // Meta echoes back what it received. Strip it: we supply the credential via
    // the Authorization header, and a token left in the URL would be logged by
    // everything the header change was made to avoid.
    const next = asRecord(payload.paging).next;
    url = typeof next === "string" && next ? stripToken(next) : null;
  }

  // A short read must never be reported as a clean one. If the page cap trips
  // while Meta is still offering a cursor, the window is incomplete — and the
  // caller would otherwise write status 'succeeded' with a partial spend total,
  // understating cost and overstating profit with no signal anywhere.
  if (url) {
    throw new MetaApiError(
      `Insights pagination exceeded ${MAX_PAGES} pages; the window is incomplete. ` +
        `Narrow the date range rather than trusting this result.`,
      { code: null, subcode: null, httpStatus: null },
    );
  }

  return { rows, accUtilPct };
}

/**
 * Fetch the ad account's display name, currency and timezone.
 *
 * The currency is what makes this call necessary rather than nice to have:
 * insights spend is denominated in the account's own currency, so it cannot be
 * converted to a market's dinars without knowing which currency it started in.
 * The timezone matters for the same class of reason — Meta buckets a "day"
 * against the account's timezone, not UTC, so a date here is only meaningful
 * alongside it.
 */
export async function fetchAccountMeta(cfg: MetaClientConfig): Promise<MetaAccountMeta> {
  const query = new URLSearchParams({
    fields: "name,currency,timezone_name",
  });
  const url = `${graphBase(cfg)}/${actId(cfg.adAccountId)}?${query}`;

  const { status, body } = await getJson(url, cfg.accessToken);
  if (status < 200 || status >= 300) throw toApiError(status, body);

  const account = asRecord(body);
  return {
    name: typeof account.name === "string" ? account.name : "",
    currency: typeof account.currency === "string" ? account.currency : "",
    timezoneName: typeof account.timezone_name === "string" ? account.timezone_name : "",
  };
}
