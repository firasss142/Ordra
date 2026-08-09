import type { CarrierConfig } from "./types";

/**
 * Darb Assabil shipping-price quotes — POST /api/local/shipments/calculate/shipping.
 *
 * This is the vendor's PREVIEW endpoint. It prices a shipment without creating
 * one, and it is the only source of truth for what Darb will actually charge to
 * deliver to a given (city, area) from a given account's branch. Nothing here
 * may ever call /api/local/shipments — that creates a real shipment.
 *
 * Vendor contract (delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md §5.5):
 *  - HTTP 200 does NOT mean success — always check body.status === true.
 *  - Authorization uses the literal "apikey " prefix (not "Bearer").
 *  - countryCode/currency are lowercase ("lby"/"lyd"); uppercase silently fails.
 *  - The response invoice splits shipping into { branchToBranch, pickFromDoor,
 *    dropToDoor }. branchToBranch is the origin-branch leg — it is what makes
 *    the Tripoli and Benghazi accounts price the same destination differently.
 *
 * MISSING IS NOT ZERO. Every failure path returns ok:false. A quote we could not
 * obtain must never surface as a 0 LYD delivery, because Darb does legitimately
 * quote 0 for its own branchToBranch leg and downstream code compares prices.
 */

export type DarbPaymentBy = "sales" | "receiver";

export interface DarbQuoteRequestInput {
  serviceId: string;
  city: string;
  area: string;
  /** COD value of the goods. Must be > 0 — see HARVEST_QUOTE_AMOUNT. */
  amount: number;
  /** Defaults to "sales". Probed 2026-08-08: the price is identical either way. */
  paymentBy?: DarbPaymentBy;
  title?: string;
}

/**
 * The nominal order value the harvest quotes at.
 *
 * Probed 2026-08-08: the shipping fee is INVARIANT to this (50/199/500/2000 all
 * return the same price), so any non-zero value works — but zero does NOT. With
 * paymentBy:"sales" Darb deducts shipping from the settlement, so amount 0
 * returns HTTP 500 "Your sales cannot cover the charges!" on both accounts.
 */
export const HARVEST_QUOTE_AMOUNT = 100;

/** Long enough to clear the vendor's products[].title min-length check. */
const DEFAULT_TITLE = "Article";

export function buildQuoteRequest(
  input: DarbQuoteRequestInput,
): Record<string, unknown> {
  return {
    service: input.serviceId,
    paymentBy: input.paymentBy ?? "sales",
    products: [
      {
        title: input.title && input.title.length > 2 ? input.title : DEFAULT_TITLE,
        quantity: 1,
        amount: input.amount,
        currency: "lyd",
        isChargeable: input.amount > 0,
      },
    ],
    // No `address` — a quote resolves the destination branch from city + area.
    to: { countryCode: "lby", city: input.city, area: input.area },
  };
}

export type DarbQuoteResult =
  | {
      ok: true;
      shippingAmount: number;
      currency: string;
      breakdown: Record<string, number> | null;
    }
  | { ok: false; httpStatus: number; errorMessage: string };

function failure(httpStatus: number, errorMessage: string): DarbQuoteResult {
  return { ok: false, httpStatus, errorMessage };
}

export function parseQuoteResponse(raw: {
  status: number;
  body: unknown;
}): DarbQuoteResult {
  const body =
    raw.body && typeof raw.body === "object" && !Array.isArray(raw.body)
      ? (raw.body as Record<string, unknown>)
      : {};

  if (body.status !== true) {
    const messages = body.messages as Array<{ message?: string }> | undefined;
    const message =
      messages?.[0]?.message ??
      (typeof body.message === "string" ? body.message : undefined) ??
      (typeof raw.body === "string" ? raw.body.slice(0, 200) : undefined) ??
      "Carrier rejected the quote";
    return failure(raw.status, message);
  }

  const data = (body.data ?? {}) as Record<string, unknown>;
  const invoices = Array.isArray(data.invoices)
    ? (data.invoices as Array<Record<string, unknown>>)
    : [];
  const invoice = invoices[0];
  if (!invoice) return failure(raw.status, "Quote returned no invoice");

  const items = Array.isArray(invoice.items)
    ? (invoice.items as Array<Record<string, unknown>>)
    : [];
  const shipping = items.find((i) => i.type === "shipping");
  if (!shipping) return failure(raw.status, "Quote returned no shipping item");

  const amount = Number(shipping.amount);
  if (!Number.isFinite(amount)) {
    return failure(raw.status, "Quote returned a non-numeric shipping amount");
  }

  const breakdown = shipping.breakdown;
  return {
    ok: true,
    shippingAmount: amount,
    currency:
      (typeof shipping.currency === "string" && shipping.currency) ||
      (typeof invoice.currency === "string" && invoice.currency) ||
      "lyd",
    breakdown:
      breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)
        ? (breakdown as Record<string, number>)
        : null,
  };
}

export interface FetchQuoteDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export async function fetchDarbQuote(
  config: CarrierConfig,
  input: DarbQuoteRequestInput,
  deps: FetchQuoteDeps = {},
): Promise<DarbQuoteResult> {
  const { api_key: apiKey, account_id: accountId } = config.apiCredentials;
  if (!apiKey || !accountId) {
    // A config problem, not a destination problem — say so rather than calling
    // out and getting a 401 that looks like the area is unserviceable.
    return failure(0, "Darb Assabil: api_key or account_id missing");
  }

  const doFetch = deps.fetchFn ?? fetch;
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");

  let response: Response;
  try {
    response = await doFetch(`${base}/api/local/shipments/calculate/shipping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `apikey ${apiKey}`,
        "X-API-VERSION": "1.0.0",
        "X-ACCOUNT-ID": accountId,
      },
      body: JSON.stringify(buildQuoteRequest(input)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15000),
    });
  } catch (e) {
    return failure(0, e instanceof Error ? e.message : "transport failure");
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    try {
      parsed = await response.text();
    } catch {
      parsed = null;
    }
  }

  return parseQuoteResponse({ status: response.status, body: parsed });
}
