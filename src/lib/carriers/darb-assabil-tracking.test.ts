import { describe, test, expect, afterEach, vi } from "vitest";
import {
  parseShipmentStatus,
  parseTimeline,
  parseShipmentFull,
  fetchDarbStatus,
  fetchDarbTimeline,
  fetchDarbShipment,
  fetchDarbShipmentPage,
  parseShipmentPage,
  type DarbStatusSnapshot,
} from "./darb-assabil-tracking";
import type { CarrierConfig } from "./types";

const mockConfig: CarrierConfig = {
  id: "darb-carrier-id",
  code: "darb_assabil",
  apiEndpoint: "https://v2.sabil.ly",
  apiCredentials: {
    api_key: "decrypted-api-key-123",
    account_id: "692637b42f63874515cebd63",
  },
  deliveryFee: 5,
  returnFee: 3,
};

// ── parseShipmentStatus ──────────────────────────────────────────────
describe("parseShipmentStatus", () => {
  test("reads data.results[0].status (list shape) and normalizes it", () => {
    const snap = parseShipmentStatus("SH1584689", {
      status: true,
      data: { results: [{ _id: "abc", reference: "SH1584689", status: "completed" }] },
    });
    expect(snap).toEqual<DarbStatusSnapshot>({
      kind: "ok",
      reference: "SH1584689",
      slug: "completed",
      rawStatus: "completed",
    });
  });

  test("keeps rawStatus but null slug for an unrecognized status", () => {
    const snap = parseShipmentStatus("SH1", {
      status: true,
      data: { results: [{ status: "teleported" }] },
    });
    expect(snap).toEqual<DarbStatusSnapshot>({
      kind: "ok",
      reference: "SH1",
      slug: null,
      rawStatus: "teleported",
    });
  });

  test("treats body.status === false as not_found (HTTP 200 ≠ success)", () => {
    const snap = parseShipmentStatus("SH1", {
      status: false,
      messages: [{ message: "Shipment not found" }],
    });
    expect(snap).toEqual<DarbStatusSnapshot>({ kind: "not_found", reference: "SH1" });
  });

  test("treats an empty results array as not_found", () => {
    const snap = parseShipmentStatus("SH1", { status: true, data: { results: [] } });
    expect(snap.kind).toBe("not_found");
  });
});

// ── parseTimeline ────────────────────────────────────────────────────
describe("parseTimeline", () => {
  test("extracts ordered events with Arabic description + timestamp", () => {
    const events = parseTimeline({
      status: true,
      data: {
        _id: "abc",
        timeline: [
          {
            type: "info",
            description: { en: "Shipment is created", ar: "تم إنشاء الشحنة" },
            timestamp: "2026-05-07T21:58:12.019Z",
          },
          {
            type: "success",
            description: { en: "Delivered", ar: "تم التسليم" },
            timestamp: "2026-05-09T10:00:00.000Z",
          },
        ],
      },
    });
    expect(events).toEqual([
      { type: "info", labelAr: "تم إنشاء الشحنة", timestamp: "2026-05-07T21:58:12.019Z" },
      { type: "success", labelAr: "تم التسليم", timestamp: "2026-05-09T10:00:00.000Z" },
    ]);
  });

  test("returns an empty array when body.status is false", () => {
    expect(parseTimeline({ status: false })).toEqual([]);
  });

  test("tolerates a missing ar description (falls back to en)", () => {
    const events = parseTimeline({
      status: true,
      data: { timeline: [{ type: "info", description: { en: "X" }, timestamp: "t" }] },
    });
    expect(events[0].labelAr).toBe("X");
  });
});

// ── noisy-event filtering ────────────────────────────────────────────
// Darb emits low-value, untranslated system rows (the "referenced" type:
// "Reference the order by 1113059", "Box Reference the order by BX18KF").
// These add noise to the Arabic-RTL panel and never carry an AR translation.
// The parser drops them so the timeline shows only meaningful milestones.
describe("noisy-event filtering", () => {
  test("parseTimeline drops 'referenced' rows, keeps meaningful events", () => {
    const events = parseTimeline({
      status: true,
      data: {
        timeline: [
          { type: "info", description: { en: "Shipment is created", ar: "تم إنشاء الشحنة" }, timestamp: "t1" },
          { type: "referenced", description: { en: "Reference the order by 1113059", ar: "Reference the order by 1113059" }, timestamp: "t2" },
          { type: "referenced", description: { en: "Box Reference the order by BX18KF", ar: "Box Reference the order by BX18KF" }, timestamp: "t3" },
          { type: "completed", description: { en: "Delivered", ar: "تم التسليم" }, timestamp: "t4" },
        ],
      },
    });
    expect(events.map((e) => e.type)).toEqual(["info", "completed"]);
  });

  test("parseShipmentFull also drops noisy events from its inline timeline", () => {
    const full = parseShipmentFull("", {
      status: true,
      data: {
        results: [
          {
            reference: "1143633",
            status: "completed",
            timeline: [
              { type: "referenced", description: { en: "Reference the order by X", ar: "Reference the order by X" }, timestamp: "t1" },
              { type: "booked", description: { en: "Booked", ar: "تم الحجز" }, timestamp: "t2" },
            ],
          },
        ],
      },
    });
    expect(full.timeline.map((e) => e.type)).toEqual(["booked"]);
  });
});

// ── parseShipmentFull ────────────────────────────────────────────────
// The by-_id endpoint (GET /api/local/shipments/:id) returns the authoritative
// status, the REAL human reference, AND the full timeline inline — all in one
// call. This is the single source we trust (the stored tracking_number / the
// separate timeline/:reference endpoint are unreliable; see investigation).
describe("parseShipmentFull", () => {
  test("extracts snapshot + real reference + inline timeline from the list shape", () => {
    const full = parseShipmentFull("STORED-REF", {
      status: true,
      data: {
        results: [
          {
            _id: "6a36a94a7043ef2602adb50f",
            reference: "1143633",
            status: "completed",
            timeline: [
              { type: "info", description: { en: "Created", ar: "تم الإنشاء" }, timestamp: "t1" },
              { type: "completed", description: { en: "Delivered", ar: "تم التسليم" }, timestamp: "t2" },
            ],
          },
        ],
      },
    });
    expect(full).toEqual({
      kind: "ok",
      reference: "1143633", // the REAL reference, not the passed-in stored one
      slug: "completed",
      rawStatus: "completed",
      timeline: [
        { type: "info", labelAr: "تم الإنشاء", timestamp: "t1" },
        { type: "completed", labelAr: "تم التسليم", timestamp: "t2" },
      ],
    });
  });

  test("not_found (body.status false) → kind not_found, empty timeline", () => {
    const full = parseShipmentFull("STORED-REF", { status: false, messages: [{ message: "x" }] });
    expect(full.kind).toBe("not_found");
    expect(full.timeline).toEqual([]);
  });

  test("empty results → not_found with empty timeline", () => {
    const full = parseShipmentFull("STORED-REF", { status: true, data: { results: [] } });
    expect(full.kind).toBe("not_found");
    expect(full.timeline).toEqual([]);
  });

  test("ok with unknown status keeps rawStatus + null slug, still returns timeline + reference", () => {
    const full = parseShipmentFull("STORED-REF", {
      status: true,
      data: {
        results: [
          {
            reference: "999",
            status: "teleported",
            timeline: [{ type: "info", description: { en: "X" }, timestamp: "t" }],
          },
        ],
      },
    });
    expect(full.kind).toBe("ok");
    if (full.kind === "ok") {
      expect(full.slug).toBeNull();
      expect(full.rawStatus).toBe("teleported");
      expect(full.reference).toBe("999");
    }
    expect(full.timeline).toHaveLength(1);
  });
});

// ── fetchDarbShipment ────────────────────────────────────────────────
describe("fetchDarbShipment", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("GETs the by-_id endpoint and returns snapshot + reference + timeline", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            results: [
              {
                _id: "69fd0af4889e7a3cd010f1a1",
                reference: "1143633",
                status: "released",
                timeline: [
                  { type: "info", description: { en: "Created", ar: "تم الإنشاء" }, timestamp: "t1" },
                ],
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const full = await fetchDarbShipment("69fd0af4889e7a3cd010f1a1", mockConfig);

    expect(full.kind).toBe("ok");
    if (full.kind === "ok") {
      expect(full.slug).toBe("released");
      expect(full.reference).toBe("1143633");
      expect(full.timeline).toEqual([
        { type: "info", labelAr: "تم الإنشاء", timestamp: "t1" },
      ]);
    }
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://v2.sabil.ly/api/local/shipments/69fd0af4889e7a3cd010f1a1");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "apikey decrypted-api-key-123",
    );
  });

  test("returns not_found without an HTTP call when internalId is empty", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const full = await fetchDarbShipment("", mockConfig);
    expect(full.kind).toBe("not_found");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── fetchDarbStatus ──────────────────────────────────────────────────
describe("fetchDarbStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("GETs /api/local/shipments/:id with the apikey headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: true, data: { results: [{ status: "released" }] } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const snap = await fetchDarbStatus("SH1584689", "69fd0af4889e7a3cd010f1a1", mockConfig);

    expect(snap).toEqual<DarbStatusSnapshot>({
      kind: "ok",
      reference: "SH1584689",
      slug: "released",
      rawStatus: "released",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://v2.sabil.ly/api/local/shipments/69fd0af4889e7a3cd010f1a1");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "apikey decrypted-api-key-123",
    );
  });

  test("returns not_found when the internal id is missing (no HTTP call)", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const snap = await fetchDarbStatus("SH1584689", "", mockConfig);
    expect(snap.kind).toBe("not_found");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── fetchDarbTimeline ────────────────────────────────────────────────
describe("fetchDarbTimeline", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("GETs /api/local/shipments/timeline/:reference and parses events", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            timeline: [
              { type: "info", description: { en: "Created", ar: "تم الإنشاء" }, timestamp: "t1" },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const events = await fetchDarbTimeline("SH1584689", mockConfig);

    expect(events).toEqual([{ type: "info", labelAr: "تم الإنشاء", timestamp: "t1" }]);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://v2.sabil.ly/api/local/shipments/timeline/SH1584689");
  });

  test("throws on a network failure so the route can surface a 502", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchDarbTimeline("SH1", mockConfig)).rejects.toThrow("ECONNRESET");
  });
});

// ── parseShipmentPage ────────────────────────────────────────────────
describe("parseShipmentPage", () => {
  test("returns every record plus the server's totalCount", () => {
    const page = parseShipmentPage({
      status: true,
      data: {
        totalCount: 710,
        results: [
          { _id: "a", reference: "1609701", status: "processing" },
          { _id: "b", reference: "SH2057634", status: "pending" },
        ],
      },
    });
    expect(page.totalCount).toBe(710);
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({ _id: "a", status: "processing" });
  });

  test("treats body.status === false as an empty page (HTTP 200 is not success)", () => {
    const page = parseShipmentPage({ status: false, messages: [{ message: "Invalid choice!" }] });
    expect(page).toEqual({ records: [], totalCount: null });
  });

  test("tolerates a missing totalCount (includeTotalCount not requested)", () => {
    const page = parseShipmentPage({ status: true, data: { results: [{ _id: "a" }] } });
    expect(page.totalCount).toBeNull();
    expect(page.records).toHaveLength(1);
  });

  test("returns an empty page rather than throwing on a malformed body", () => {
    expect(parseShipmentPage(null)).toEqual({ records: [], totalCount: null });
    expect(parseShipmentPage("gateway timeout")).toEqual({ records: [], totalCount: null });
    expect(parseShipmentPage({ status: true, data: { results: "nope" } })).toEqual({
      records: [],
      totalCount: null,
    });
  });
});

// ── fetchDarbShipmentPage ────────────────────────────────────────────
describe("fetchDarbShipmentPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("GETs the list endpoint with no :id, paging params and includeTotalCount", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { totalCount: 710, results: [] } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchDarbShipmentPage(mockConfig, { offset: 500, limit: 500 });

    const [url, init] = mockFetch.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/local/shipments");
    expect(parsed.searchParams.get("offset")).toBe("500");
    expect(parsed.searchParams.get("limit")).toBe("500");
    expect(parsed.searchParams.get("includeTotalCount")).toBe("true");
    // Newest-updated first is what makes an early-exit delta sweep possible.
    expect(parsed.searchParams.get("sort")).toBe('{"updatedAt":-1}');
    expect((init as RequestInit).method).toBe("GET");
  });

  test("sends the three Darb auth headers with the literal apikey prefix", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { results: [] } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchDarbShipmentPage(mockConfig, { offset: 0, limit: 10 });

    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("apikey decrypted-api-key-123");
    expect(headers["X-API-VERSION"]).toBe("1.0.0");
    expect(headers["X-ACCOUNT-ID"]).toBe("692637b42f63874515cebd63");
  });

  test("NEVER sends a multi-value status filter — Darb silently honours only the last", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { results: [] } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchDarbShipmentPage(mockConfig, { offset: 0, limit: 10, status: "released" });

    const parsed = new URL(mockFetch.mock.calls[0][0] as string);
    expect(parsed.searchParams.getAll("status")).toEqual(["released"]);
    expect(parsed.searchParams.get("negateStatus")).toBeNull();
  });

  test("returns the parsed page", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { totalCount: 2, results: [{ _id: "a", status: "delayed" }] },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const page = await fetchDarbShipmentPage(mockConfig, { offset: 0, limit: 500 });
    expect(page.totalCount).toBe(2);
    expect(page.records[0]).toMatchObject({ _id: "a", status: "delayed" });
  });

  test("throws on a network failure so the caller can record a failed run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    await expect(fetchDarbShipmentPage(mockConfig, { offset: 0, limit: 10 })).rejects.toThrow(
      "ETIMEDOUT",
    );
  });
});
