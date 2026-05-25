import { describe, test, expect, vi } from "vitest";
import { parseAjaxOrderCase, fetchDexpressStatus } from "./tracking";
import { CarrierDispatchError } from "../errors";
import type { DexpressClient } from "./client";

// Real bodies captured via scripts/probe-dexpress-ajax-status.ts on 2026-05-25.
// Tracking numbers + their canonical Dexpress statuses are documented in
// plans/dexpress-order-status-display.md under "Empirical findings".
const PROBE_BODIES = {
  // 1343188 → فى الشركة (IN_COMPANY, id 3)
  inCompany:
    '{"response_case":201,"order_status":"3","order_accept":"1","status_name":"فى الشركة"}',
  // 1339630 → تم التسليم (DELIVERED, id 10)
  delivered:
    '{"response_case":201,"order_status":"10","order_accept":"1","status_name":"تم التسليم"}',
  // 1341657 → جارى التوصيل (OUT_FOR_DELIVERY, id 7)
  outForDelivery:
    '{"response_case":201,"order_status":"7","order_accept":"1","status_name":"جارى التوصيل"}',
  // 99999999 → not found
  notFound: '{"response_case":404}',
} as const;

describe("parseAjaxOrderCase — confirmed probe captures", () => {
  test("IN_COMPANY probe body (1343188)", () => {
    const snap = parseAjaxOrderCase("1343188", PROBE_BODIES.inCompany);
    expect(snap).toEqual({
      kind: "ok",
      trackingNumber: "1343188",
      slug: "IN_COMPANY",
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    });
  });

  test("DELIVERED probe body (1339630)", () => {
    const snap = parseAjaxOrderCase("1339630", PROBE_BODIES.delivered);
    expect(snap).toEqual({
      kind: "ok",
      trackingNumber: "1339630",
      slug: "DELIVERED",
      statusId: 10,
      rawLabel: "تم التسليم",
      isAccepted: true,
    });
  });

  test("OUT_FOR_DELIVERY probe body (1341657)", () => {
    const snap = parseAjaxOrderCase("1341657", PROBE_BODIES.outForDelivery);
    expect(snap).toEqual({
      kind: "ok",
      trackingNumber: "1341657",
      slug: "OUT_FOR_DELIVERY",
      statusId: 7,
      rawLabel: "جارى التوصيل",
      isAccepted: true,
    });
  });
});

describe("parseAjaxOrderCase — not-found branch (Dexpress response_case 404)", () => {
  test("response_case:404 returns kind:not_found, NOT an error", () => {
    const snap = parseAjaxOrderCase("99999999", PROBE_BODIES.notFound);
    expect(snap).toEqual({
      kind: "not_found",
      trackingNumber: "99999999",
    });
  });

  test("response_case:404 with extra unexpected fields still returns not_found", () => {
    const snap = parseAjaxOrderCase(
      "99999999",
      '{"response_case":404,"some_extra_field":"ignored"}'
    );
    expect(snap.kind).toBe("not_found");
  });
});

describe("parseAjaxOrderCase — order_accept is a string in JSON", () => {
  test('order_accept:"1" → isAccepted:true', () => {
    const body =
      '{"response_case":201,"order_status":"3","order_accept":"1","status_name":"فى الشركة"}';
    const snap = parseAjaxOrderCase("x", body);
    expect(snap.kind).toBe("ok");
    if (snap.kind === "ok") expect(snap.isAccepted).toBe(true);
  });

  test('order_accept:"0" → isAccepted:false', () => {
    const body =
      '{"response_case":201,"order_status":"3","order_accept":"0","status_name":"فى الشركة"}';
    const snap = parseAjaxOrderCase("x", body);
    expect(snap.kind).toBe("ok");
    if (snap.kind === "ok") expect(snap.isAccepted).toBe(false);
  });

  test("order_accept missing → isAccepted:false (defensive default)", () => {
    const body =
      '{"response_case":201,"order_status":"3","status_name":"فى الشركة"}';
    const snap = parseAjaxOrderCase("x", body);
    expect(snap.kind).toBe("ok");
    if (snap.kind === "ok") expect(snap.isAccepted).toBe(false);
  });
});

describe("parseAjaxOrderCase — unknown status ID degrades gracefully", () => {
  test("unknown order_status → slug:null, statusId still parsed, rawLabel preserved", () => {
    const body =
      '{"response_case":201,"order_status":"9999","order_accept":"1","status_name":"some new arabic"}';
    const snap = parseAjaxOrderCase("x", body);
    expect(snap).toEqual({
      kind: "ok",
      trackingNumber: "x",
      slug: null,
      statusId: 9999,
      rawLabel: "some new arabic",
      isAccepted: true,
    });
  });

  test("order_status missing but status_name matches a known label → slug resolved via label fallback", () => {
    // Defensive fallback: if Dexpress ever drops order_status from the response,
    // we can still resolve via the Arabic label as long as it's in the taxonomy.
    const body =
      '{"response_case":201,"order_accept":"1","status_name":"تم التسليم"}';
    const snap = parseAjaxOrderCase("x", body);
    expect(snap.kind).toBe("ok");
    if (snap.kind === "ok") {
      expect(snap.slug).toBe("DELIVERED");
      expect(snap.statusId).toBe(10); // resolved via label
      expect(snap.rawLabel).toBe("تم التسليم");
    }
  });

  test("both order_status and status_name missing → slug:null, statusId:null, rawLabel:''", () => {
    const body = '{"response_case":201,"order_accept":"1"}';
    const snap = parseAjaxOrderCase("x", body);
    expect(snap).toEqual({
      kind: "ok",
      trackingNumber: "x",
      slug: null,
      statusId: null,
      rawLabel: "",
      isAccepted: true,
    });
  });
});

describe("parseAjaxOrderCase — error paths", () => {
  test("throws CarrierDispatchError on unexpected response_case (e.g. 500)", () => {
    expect(() =>
      parseAjaxOrderCase("x", '{"response_case":500}')
    ).toThrow(CarrierDispatchError);
    expect(() =>
      parseAjaxOrderCase("x", '{"response_case":500}')
    ).toThrow(/UNEXPECTED_RESPONSE_CASE/);
  });

  test("throws CarrierDispatchError on missing response_case", () => {
    expect(() => parseAjaxOrderCase("x", "{}")).toThrow(
      CarrierDispatchError
    );
  });

  test("throws CarrierDispatchError on malformed JSON", () => {
    expect(() =>
      parseAjaxOrderCase("x", "not json")
    ).toThrow(CarrierDispatchError);
    expect(() => parseAjaxOrderCase("x", "")).toThrow(CarrierDispatchError);
  });

  test("throws on response_case that is a string instead of number", () => {
    // Defensive: if Dexpress ever sends `"response_case":"201"` (string), we
    // want to bail rather than silently misinterpret. Strict number check.
    expect(() =>
      parseAjaxOrderCase("x", '{"response_case":"201"}')
    ).toThrow(CarrierDispatchError);
  });
});

describe("fetchDexpressStatus — I/O wrapper around getJsonEndpoint + parseAjaxOrderCase", () => {
  function fakeClient(
    bodyText: string,
    status = 200
  ): DexpressClient {
    return {
      getJsonEndpoint: vi.fn().mockResolvedValue({ status, bodyText }),
    } as unknown as DexpressClient;
  }

  test("calls /merchant/ajax-order-case/{trackingNumber} via the client", async () => {
    const client = fakeClient(
      '{"response_case":201,"order_status":"3","order_accept":"1","status_name":"فى الشركة"}'
    );

    await fetchDexpressStatus("1343188", client);

    expect(client.getJsonEndpoint).toHaveBeenCalledWith(
      "/merchant/ajax-order-case/1343188"
    );
  });

  test("returns the parsed snapshot for an ok response", async () => {
    const client = fakeClient(
      '{"response_case":201,"order_status":"10","order_accept":"1","status_name":"تم التسليم"}'
    );
    const snap = await fetchDexpressStatus("1339630", client);
    expect(snap).toEqual({
      kind: "ok",
      trackingNumber: "1339630",
      slug: "DELIVERED",
      statusId: 10,
      rawLabel: "تم التسليم",
      isAccepted: true,
    });
  });

  test("returns kind:not_found for Dexpress response_case 404", async () => {
    const client = fakeClient('{"response_case":404}');
    const snap = await fetchDexpressStatus("99999999", client);
    expect(snap).toEqual({
      kind: "not_found",
      trackingNumber: "99999999",
    });
  });

  test("propagates CarrierDispatchError thrown by the parser", async () => {
    const client = fakeClient('{"response_case":500}');
    await expect(fetchDexpressStatus("x", client)).rejects.toThrow(
      CarrierDispatchError
    );
  });

  test("URL-encodes the tracking number", async () => {
    // Defensive: Dexpress IDs are numeric, but never trust that.
    const client = fakeClient('{"response_case":404}');
    await fetchDexpressStatus("abc/123", client);
    expect(client.getJsonEndpoint).toHaveBeenCalledWith(
      "/merchant/ajax-order-case/abc%2F123"
    );
  });
});
