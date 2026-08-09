import { describe, test, expect, vi } from "vitest";
import {
  buildQuoteRequest,
  parseQuoteResponse,
  fetchDarbQuote,
  HARVEST_QUOTE_AMOUNT,
} from "./darb-rate-quote";
import type { CarrierConfig } from "./types";

const INPUT = {
  serviceId: "6783c612dcf305c9e775c987",
  city: "بنغازي",
  area: "قمينس",
  amount: 199,
};

function okBody(shipping: number, breakdown?: Record<string, number>) {
  return {
    status: true,
    data: {
      invoices: [
        {
          currency: "lyd",
          items: [
            { type: "product", amount: 199, currency: "lyd", quantity: 1 },
            {
              type: "shipping",
              amount: shipping,
              currency: "lyd",
              breakdown: breakdown ?? { branchToBranch: 0, pickFromDoor: 0, dropToDoor: 15 },
            },
          ],
        },
      ],
    },
  };
}

describe("buildQuoteRequest", () => {
  test("sends the lowercase country code and currency the vendor requires", () => {
    const body = buildQuoteRequest(INPUT) as Record<string, never>;
    expect((body.to as unknown as Record<string, string>).countryCode).toBe("lby");
    expect((body.products as unknown as Array<{ currency: string }>)[0].currency).toBe("lyd");
  });

  test("carries service, city and area verbatim", () => {
    const body = buildQuoteRequest(INPUT) as Record<string, unknown>;
    expect(body.service).toBe(INPUT.serviceId);
    expect(body.to).toMatchObject({ city: "بنغازي", area: "قمينس" });
  });

  test("omits the street address — a quote needs only city and area", () => {
    const to = (buildQuoteRequest(INPUT) as Record<string, unknown>).to as Record<string, unknown>;
    expect(to).not.toHaveProperty("address");
  });

  test("puts the order value on products[0].amount and marks it chargeable", () => {
    const products = (buildQuoteRequest(INPUT) as Record<string, unknown>)
      .products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ amount: 199, quantity: 1, isChargeable: true });
  });

  test("defaults paymentBy to sales", () => {
    expect((buildQuoteRequest(INPUT) as Record<string, unknown>).paymentBy).toBe("sales");
  });

  // The vendor rejects a 1-char products[].title with a misleading
  // 400 @ products.0.title that looks like a destination error.
  test("always sends a product title of usable length", () => {
    const products = (buildQuoteRequest(INPUT) as Record<string, unknown>)
      .products as Array<{ title: string }>;
    expect(products[0].title.length).toBeGreaterThan(2);
  });

  // Probed 2026-08-08: amount 0 returns HTTP 500 "Your sales cannot cover the
  // charges!" on both accounts, because paymentBy:sales deducts shipping from a
  // zero settlement. The harvest must never quote at zero.
  test("HARVEST_QUOTE_AMOUNT is non-zero", () => {
    expect(HARVEST_QUOTE_AMOUNT).toBeGreaterThan(0);
  });
});

describe("parseQuoteResponse", () => {
  test("extracts the shipping amount, currency and breakdown", () => {
    const r = parseQuoteResponse({ status: 200, body: okBody(15) });
    expect(r).toEqual({
      ok: true,
      shippingAmount: 15,
      currency: "lyd",
      breakdown: { branchToBranch: 0, pickFromDoor: 0, dropToDoor: 15 },
    });
  });

  // HTTP 200 does NOT mean success on this vendor — always check body.status.
  test("treats HTTP 200 with body.status false as a failure", () => {
    const r = parseQuoteResponse({
      status: 200,
      body: { status: false, messages: [{ message: "Unable to fetch branch 'LBY-x,y'!" }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorMessage).toBe("Unable to fetch branch 'LBY-x,y'!");
  });

  test("surfaces the vendor message from an HTTP 500 rejection", () => {
    const r = parseQuoteResponse({
      status: 500,
      body: { status: false, messages: [{ message: "Your sales cannot cover the charges!" }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.httpStatus).toBe(500);
      expect(r.errorMessage).toBe("Your sales cannot cover the charges!");
    }
  });

  // The single most dangerous confusion in this feature: a missing price must
  // never surface as a free delivery.
  test("returns a failure, not a 0 fee, when the invoice has no shipping item", () => {
    const r = parseQuoteResponse({
      status: 200,
      body: { status: true, data: { invoices: [{ currency: "lyd", items: [{ type: "product", amount: 199 }] }] } },
    });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("shippingAmount");
  });

  test("returns a failure when there are no invoices at all", () => {
    const r = parseQuoteResponse({ status: 200, body: { status: true, data: { invoices: [] } } });
    expect(r.ok).toBe(false);
  });

  // Benghazi genuinely quotes branchToBranch 0 into بنغازي, so a real zero must
  // survive as a price.
  test("accepts a genuine zero shipping amount as a success", () => {
    const r = parseQuoteResponse({ status: 200, body: okBody(0, { branchToBranch: 0, pickFromDoor: 0, dropToDoor: 0 }) });
    expect(r).toMatchObject({ ok: true, shippingAmount: 0 });
  });

  test("finds the shipping item wherever it sits in items[]", () => {
    const body = {
      status: true,
      data: {
        invoices: [
          {
            currency: "lyd",
            items: [
              { type: "shipping", amount: 25, currency: "lyd", breakdown: {} },
              { type: "product", amount: 199, currency: "lyd" },
            ],
          },
        ],
      },
    };
    expect(parseQuoteResponse({ status: 200, body })).toMatchObject({ ok: true, shippingAmount: 25 });
  });

  test("never folds a product item into the shipping fee", () => {
    const r = parseQuoteResponse({ status: 200, body: okBody(15) });
    expect(r).toMatchObject({ shippingAmount: 15 });
  });

  test("handles a non-JSON text body without throwing", () => {
    const r = parseQuoteResponse({ status: 502, body: "<html>Bad Gateway</html>" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.httpStatus).toBe(502);
  });

  test("handles a transport failure reported as status 0", () => {
    const r = parseQuoteResponse({ status: 0, body: null });
    expect(r.ok).toBe(false);
  });

  test("rejects a non-numeric shipping amount rather than coercing it", () => {
    const body = {
      status: true,
      data: { invoices: [{ currency: "lyd", items: [{ type: "shipping", amount: "abc" }] }] },
    };
    expect(parseQuoteResponse({ status: 200, body }).ok).toBe(false);
  });
});

describe("fetchDarbQuote", () => {
  const config: CarrierConfig = {
    id: "carrier-1",
    code: "darb_assabil",
    apiEndpoint: "https://v2.sabil.ly",
    apiCredentials: { api_key: "secret-key", account_id: "acct-1" },
    deliveryFee: 10,
    returnFee: 5,
  };

  test("posts to calculate/shipping with the vendor's three auth headers", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(okBody(15)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await fetchDarbQuote(config, INPUT, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, shippingAmount: 15 });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v2.sabil.ly/api/local/shipments/calculate/shipping");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("apikey secret-key");
    expect(headers["X-API-VERSION"]).toBe("1.0.0");
    expect(headers["X-ACCOUNT-ID"]).toBe("acct-1");
  });

  test("never calls the shipment-creating endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(okBody(15)), { status: 200 }));
    await fetchDarbQuote(config, INPUT, { fetchFn: fetchFn as unknown as typeof fetch });
    const url = (fetchFn.mock.calls[0] as [string])[0];
    expect(url).toContain("/calculate/shipping");
  });

  test("falls back to the vendor base url when the carrier has none", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(okBody(15)), { status: 200 }));
    await fetchDarbQuote({ ...config, apiEndpoint: "" }, INPUT, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(
      "https://v2.sabil.ly/api/local/shipments/calculate/shipping",
    );
  });

  test("turns a thrown transport error into an ok:false result", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    const r = await fetchDarbQuote(config, INPUT, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.httpStatus).toBe(0);
      expect(r.errorMessage).toContain("ETIMEDOUT");
    }
  });

  test("reports a config error instead of calling out with no api key", async () => {
    const fetchFn = vi.fn();
    const r = await fetchDarbQuote(
      { ...config, apiCredentials: { account_id: "acct-1" } },
      INPUT,
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
