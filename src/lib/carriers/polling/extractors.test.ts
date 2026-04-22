import { describe, test, expect } from "vitest";
import {
  parseNavexResponse,
  parseDexpressBatchResponse,
} from "./extractors";

describe("parseNavexResponse", () => {
  test("extracts etat from direct object", () => {
    const body = { status: 1, etat: "En cours", status_message: "TRACK-1" };
    const result = parseNavexResponse("TRACK-1", body);
    expect(result.trackingNumber).toBe("TRACK-1");
    expect(result.etat).toBe("En cours");
    expect(result.rawBody).toBe(body);
  });

  test("extracts etat from array-wrapped response", () => {
    const body = [{ status: 1, etat: "Livrer", status_message: "TRACK-2" }];
    const result = parseNavexResponse("TRACK-2", body);
    expect(result.etat).toBe("Livrer");
  });

  test("returns null etat when empty string + ERREUR marker", () => {
    const body = { status: 0, etat: "", status_message: "ERREUR!." };
    const result = parseNavexResponse("BAD-TRACK", body);
    expect(result.etat).toBeNull();
  });

  test("returns null etat when etat is empty string without ERREUR", () => {
    const body = { status: 0, etat: "", status_message: "anything" };
    expect(parseNavexResponse("X", body).etat).toBeNull();
  });

  test("returns null etat when body shape is malformed", () => {
    expect(parseNavexResponse("X", "not-json").etat).toBeNull();
    expect(parseNavexResponse("X", null).etat).toBeNull();
    expect(parseNavexResponse("X", []).etat).toBeNull();
    expect(parseNavexResponse("X", {}).etat).toBeNull();
  });
});

describe("parseDexpressBatchResponse", () => {
  test("extracts entries from 4000 response", () => {
    const body = {
      code: 4000,
      message: "success",
      data: [
        { order_snum: 1032, status_key: 10, name_status: "تم التسليم", date: "2023-10-17", time: "04-32-21" },
        { order_snum: 1232, status_key: 1, name_status: "عند العميل", date: "2023-10-18", time: "12-57-36" },
      ],
    };
    const results = parseDexpressBatchResponse(body);
    expect(results).toHaveLength(2);
    expect(results[0].trackingNumber).toBe("1032");
    expect(results[0].statusKey).toBe(10);
    expect(results[0].nameStatus).toBe("تم التسليم");
    expect(results[1].trackingNumber).toBe("1232");
    expect(results[1].statusKey).toBe(1);
  });

  test("returns empty array for non-4000 code", () => {
    expect(parseDexpressBatchResponse({ code: 4002, message: "Invalid Tracking Numbers" })).toEqual([]);
    expect(parseDexpressBatchResponse({ code: 4010, errors: {} })).toEqual([]);
  });

  test("returns empty array for missing data", () => {
    expect(parseDexpressBatchResponse({ code: 4000 })).toEqual([]);
    expect(parseDexpressBatchResponse({ code: 4000, data: null })).toEqual([]);
  });

  test("returns empty array for malformed body", () => {
    expect(parseDexpressBatchResponse(null)).toEqual([]);
    expect(parseDexpressBatchResponse("string")).toEqual([]);
    expect(parseDexpressBatchResponse([])).toEqual([]);
  });

  test("skips entries missing required fields", () => {
    const body = {
      code: 4000,
      data: [
        { order_snum: 1, status_key: 10, name_status: "ok" },
        { order_snum: 2 },
        { status_key: 1, name_status: "bad" },
      ],
    };
    const results = parseDexpressBatchResponse(body);
    expect(results).toHaveLength(1);
    expect(results[0].trackingNumber).toBe("1");
  });
});
