import { describe, it, expect } from "vitest";
import {
  XDELIVERY_STATUSES,
  normalizeXDeliveryStatus,
  mapXDeliveryStatus,
} from "./xdelivery-statuses";

describe("normalizeXDeliveryStatus", () => {
  it("knows the 12 documented statuses plus ARCHIVED", () => {
    expect(XDELIVERY_STATUSES.map((s) => s.slug)).toHaveLength(13);
    expect(normalizeXDeliveryStatus("ARCHIVED")).toBe("ARCHIVED");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(normalizeXDeliveryStatus("  delivered_paid ")).toBe("DELIVERED_PAID");
  });

  it("returns null on unknown or empty input, never throws", () => {
    expect(normalizeXDeliveryStatus("TRANSFER_SENT")).toBeNull();
    expect(normalizeXDeliveryStatus("")).toBeNull();
    expect(normalizeXDeliveryStatus(null)).toBeNull();
  });
});

describe("mapXDeliveryStatus", () => {
  it.each([
    ["CREATED", null],
    ["PENDING", null],
    ["COLLECTED", "dispatched"],
    ["ARRIVED_AT_DEPOT", "deposit"],
    ["OUT_FOR_DELIVERY", "out_for_delivery"],
    ["RETURNED_AT_DEPOT", "delivery_delayed"],
    ["DELIVERED", "delivered"],
    ["DELIVERED_PAID", "delivered"],
    ["RETURNED_TO_DEPOT_CLIENT", "returning"],
    ["RETURNED_TO_DEPOT_SENDER", "returning"],
    ["PENDING_RETURNS", "to_be_returned"],
    ["RETURNED_TO_SENDER", "to_be_returned"],
    ["ARCHIVED", null],
  ])("%s → %s", (raw, target) => {
    expect(mapXDeliveryStatus(raw)?.target).toBe(target);
  });

  it("never targets returned: only the warehouse return scan gives stock back", () => {
    for (const s of XDELIVERY_STATUSES) {
      expect(mapXDeliveryStatus(s.slug)?.target).not.toBe("returned");
    }
  });

  it("is null for an unknown status, so the caller logs it instead of guessing", () => {
    expect(mapXDeliveryStatus("SOMETHING_NEW")).toBeNull();
  });

  it("writes the status and the motif into the history note", () => {
    expect(mapXDeliveryStatus("RETURNED_AT_DEPOT", "Report 06/10/2026")?.note).toBe(
      "X-Delivery: RETURNED_AT_DEPOT — Report 06/10/2026",
    );
    expect(mapXDeliveryStatus("DELIVERED", "  ")?.note).toBe("X-Delivery: DELIVERED");
  });

  it("caps a runaway motif", () => {
    const note = mapXDeliveryStatus("RETURNED_AT_DEPOT", "x".repeat(500))!.note;
    expect(note.length).toBeLessThanOrEqual(240);
  });

  it("returns the normalized slug", () => {
    expect(mapXDeliveryStatus("delivered")?.slug).toBe("DELIVERED");
  });
});
