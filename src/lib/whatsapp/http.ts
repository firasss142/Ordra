/**
 * Graph transport for the WhatsApp Cloud API.
 *
 * SERVER-SIDE ONLY — handles a permanent System User token. Mirrors the two
 * small helpers of src/lib/meta-ads/client.ts (pinned version, Bearer header,
 * 15 s abort, body read once as text, redaction) without importing that
 * module: the ads client is stable and must not grow a dependency on this
 * one's release cadence.
 */
import { WhatsAppApiError, redact } from "./errors";

/** Current pinned Graph version. v26.0 released 29 Jul 2026. */
export const DEFAULT_GRAPH_VERSION = "v26.0";

/** Matches every other outbound integration in this repo. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Base URL override for LOCAL STUBS ONLY (the drain test points it at a fake
 * Graph that answers 200, then 429, then 190). Never set in production.
 */
export function graphBase(graphVersion?: string | null): string {
  const override = process.env.WHATSAPP_GRAPH_BASE_URL;
  const version = graphVersion || DEFAULT_GRAPH_VERSION;
  return `${override ? override.replace(/\/$/, "") : "https://graph.facebook.com"}/${version}`;
}

export { redact };

export function requestSignal(caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!caller) return timeout;
  const anyOf = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  return typeof anyOf === "function" ? anyOf([caller, timeout]) : timeout;
}

/** Remove an inline credential from a URL Meta handed back to us. */
export function stripToken(url: string): string {
  return url.replace(/([?&])access_token=[^&]*(&|$)/gi, (_m, lead, tail) => (tail === "&" ? lead : ""));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export interface GraphResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

async function run(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<GraphResponse> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: requestSignal(signal) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new WhatsAppApiError("Meta Graph API request timed out", { isTimeout: true });
    }
    throw err;
  }
  // Read once as text: a failed response.json() has already consumed the
  // stream, so a second read would throw instead of yielding the fallback.
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
 * Turn a non-2xx Graph response into a classified error. Meta returns
 * {"error":{"message","type","code","error_subcode","error_data":{"details"},
 * "fbtrace_id"}}; anything else is reported by HTTP status alone.
 */
export function toApiError(status: number, body: unknown): WhatsAppApiError {
  const error = asRecord(asRecord(body).error);
  const code = typeof error.code === "number" ? error.code : null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  const details = asRecord(error.error_data).details;
  const message =
    typeof error.message === "string" && error.message
      ? error.message
      : `Meta Graph API request failed with HTTP ${status}`;
  const trace = typeof error.fbtrace_id === "string" ? ` (fbtrace_id ${error.fbtrace_id})` : "";
  return new WhatsAppApiError(redact(message) + trace, {
    code,
    subcode,
    httpStatus: status,
    title: typeof error.error_user_title === "string" ? error.error_user_title : typeof error.type === "string" ? error.type : null,
    details: typeof details === "string" ? details : null,
    fbtraceId: typeof error.fbtrace_id === "string" ? error.fbtrace_id : null,
  });
}

function ensureOk(res: GraphResponse): unknown {
  if (res.status < 200 || res.status >= 300) throw toApiError(res.status, res.body);
  return res.body;
}

/** GET with Bearer auth; throws WhatsAppApiError on non-2xx. */
export async function getJson(url: string, accessToken: string, signal?: AbortSignal): Promise<unknown> {
  // The token travels as a header, never as a query parameter: a credential in
  // a URL is recorded by Meta's edge, by any egress proxy, and by anything
  // that captures outbound request URLs for telemetry.
  return ensureOk(await run(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }, signal));
}

/** POST a JSON body with Bearer auth; throws WhatsAppApiError on non-2xx. */
export async function postJson(
  url: string,
  accessToken: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return ensureOk(
    await run(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    ),
  );
}

/** DELETE with Bearer auth. */
export async function deleteJson(url: string, accessToken: string, signal?: AbortSignal): Promise<unknown> {
  return ensureOk(await run(url, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }, signal));
}

/**
 * Binary POST for the resumable upload API. That endpoint is the one place
 * Graph wants `Authorization: OAuth <token>` rather than Bearer, and the byte
 * offset as its own header.
 */
export async function postBinary(
  url: string,
  accessToken: string,
  bytes: Uint8Array,
  offset: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return ensureOk(
    await run(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: String(offset),
          "Content-Type": "application/octet-stream",
        },
        body: bytes as unknown as BodyInit,
      },
      signal,
    ),
  );
}
