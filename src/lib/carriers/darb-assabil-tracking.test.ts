import { describe, test, expect, afterEach, vi } from "vitest";
import {
  parseShipmentStatus,
  parseTimeline,
  fetchDarbStatus,
  fetchDarbTimeline,
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
