import { describe, it, expect } from "vitest";
import {
  deskAge,
  firstName,
  zonedDayStartIso,
  deadCarrierBySite,
  foldSummary,
} from "../desk-sortir";

describe("deskAge — the bench age as the desk prints it", () => {
  it("says 'now' under an hour", () => {
    expect(deskAge(0)).toEqual({ unit: "now", n: 0, late: false });
    expect(deskAge(0.9)).toEqual({ unit: "now", n: 0, late: false });
  });

  it("counts whole hours under a day", () => {
    expect(deskAge(2.7)).toEqual({ unit: "hours", n: 2, late: false });
    expect(deskAge(23.9)).toEqual({ unit: "hours", n: 23, late: false });
  });

  it("counts whole days from a day on, and is late only past 48 h", () => {
    expect(deskAge(26)).toEqual({ unit: "days", n: 1, late: false });
    expect(deskAge(48)).toEqual({ unit: "days", n: 2, late: false });
    expect(deskAge(70)).toEqual({ unit: "days", n: 2, late: true });
  });
});

describe("firstName", () => {
  it("keeps the first word only", () => {
    expect(firstName("محمد الزواغي")).toBe("محمد");
    expect(firstName("  Mohamed  Ben Ali ")).toBe("Mohamed");
  });

  it("is empty for a missing name", () => {
    expect(firstName(null)).toBe("");
    expect(firstName("")).toBe("");
  });
});

describe("zonedDayStartIso — the market's midnight, in UTC", () => {
  it("is 22:00 UTC the day before for Libya (UTC+2)", () => {
    // 00:30 in Tripoli on 3 Oct is 22:30 UTC on 2 Oct.
    expect(zonedDayStartIso("Africa/Tripoli", new Date("2026-10-02T22:30:00Z"))).toBe(
      "2026-10-02T22:00:00.000Z",
    );
  });

  it("is 23:00 UTC the day before for Tunisia (UTC+1)", () => {
    expect(zonedDayStartIso("Africa/Tunis", new Date("2026-10-02T10:00:00Z"))).toBe(
      "2026-10-01T23:00:00.000Z",
    );
  });
});

describe("deadCarrierBySite — the share of set-aside parcels whose carrier is switched off", () => {
  const T = "site-t";
  const B = "site-b";
  const dex = { name: "Dexpress", is_active: false };
  const darb = { name: "Darb Tripoli", is_active: true };

  it("counts only inactive carriers, per building, largest first", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ warehouse_id: T, carrier_extra: null, carrier: dex })),
      { warehouse_id: T, carrier_extra: null, carrier: darb },
      { warehouse_id: T, carrier_extra: null, carrier: { name: "Old", is_active: false } },
      { warehouse_id: B, carrier_extra: null, carrier: darb },
    ];
    expect(deadCarrierBySite(rows)).toEqual({
      [T]: [
        { carrier: "Dexpress", n: 3 },
        { carrier: "Old", n: 1 },
      ],
    });
  });

  it("ignores parcels the carrier ships from its own warehouse — they are never ours", () => {
    const rows = [
      { warehouse_id: T, carrier_extra: { fulfil_from_carrier_warehouse: "true" }, carrier: dex },
      { warehouse_id: T, carrier_extra: { fulfil_from_carrier_warehouse: true }, carrier: dex },
    ];
    expect(deadCarrierBySite(rows)).toEqual({});
  });

  it("ignores rows with no building or no carrier", () => {
    const rows = [
      { warehouse_id: null, carrier_extra: null, carrier: dex },
      { warehouse_id: T, carrier_extra: null, carrier: null },
    ];
    expect(deadCarrierBySite(rows)).toEqual({});
  });
});

describe("foldSummary — the older parcels, per building", () => {
  const sites = [
    { id: "t", name: "Tripoli" },
    { id: "b", name: "Benghazi" },
  ];

  it("sums the buildings and keeps their order", () => {
    const out = foldSummary(sites, { t: 335, b: 11 }, { t: [{ carrier: "Dexpress", n: 323 }] });
    expect(out.total).toBe(346);
    expect(out.parts).toEqual([
      { site: "Tripoli", n: 335, dead: [{ carrier: "Dexpress", n: 323 }] },
      { site: "Benghazi", n: 11, dead: [] },
    ]);
  });

  it("leaves out a building with nothing set aside", () => {
    const out = foldSummary(sites, { t: 0, b: 11 }, {});
    expect(out.total).toBe(11);
    expect(out.parts.map((p) => p.site)).toEqual(["Benghazi"]);
  });

  it("is empty when nothing is set aside anywhere", () => {
    expect(foldSummary(sites, {}, {})).toEqual({ total: 0, parts: [] });
  });
});
