import { describe, test, expect } from "vitest";
import { buildZoneIndex, zoneForOrder, type ZonedOrderInput } from "./zone-index";

/**
 * Turning a queue row into the roll colour the operator must pick up.
 *
 * Precedence is the whole point. `branch_group` on the order is what Darb
 * actually did with the parcel; the directory is only what Darb's rules say it
 * should do. They disagree in production — 16 الزاوية shipments are filed under
 * TR while the directory puts الزاوية under ZWY — so the order's own value has
 * to win, or the bench would be told a colour the carrier is not using.
 */

const DIRECTORY = [
  { branch_group: "BN", color: "#339307", city: "بنغازي", area: "" },
  { branch_group: "BN", color: "#339307", city: "بنغازي", area: "قمينس" },
  { branch_group: "TR", color: "#d80a0a", city: "طرابلس", area: "" },
  { branch_group: "TR", color: "#d80a0a", city: "طرابلس", area: "جنزور" },
  { branch_group: "ZWY", color: "#fc6401", city: "الزاوية", area: "" },
  { branch_group: "SB", color: "#0cbceb", city: "سبها", area: "أوباري" },
];

const index = buildZoneIndex(DIRECTORY);

function order(o: Partial<ZonedOrderInput>): ZonedOrderInput {
  return { branch_group: null, customer_city: null, customer_area: null, ...o };
}

describe("zoneForOrder", () => {
  test("uses the order's own branch group before the directory", () => {
    // The directory would say الزاوية → ZWY orange. Darb filed this parcel
    // under TR, so it takes a red sticker whatever the directory thinks.
    const zone = zoneForOrder(order({ branch_group: "TR", customer_city: "الزاوية" }), index);
    expect(zone.branchGroup).toBe("TR");
    expect(zone.colorHex).toBe("#d80a0a");
    expect(zone.source).toBe("carrier");
  });

  test("falls back to the directory when the order has no branch group", () => {
    const zone = zoneForOrder(order({ customer_city: "بنغازي" }), index);
    expect(zone.branchGroup).toBe("BN");
    expect(zone.colorHex).toBe("#339307");
    expect(zone.source).toBe("directory");
  });

  test("names the zone in both languages, from the colour", () => {
    const zone = zoneForOrder(order({ customer_city: "سبها", customer_area: "أوباري" }), index);
    expect(zone.colorHex).toBe("#0cbceb");
    expect(zone.nameFr).toBe("Région méridionale");
    expect(zone.nameAr).toBe("المنطقة الجنوبية");
    expect(zone.colourFr).toBe("Cyan");
  });

  test("resolves an area filed as a city", () => {
    expect(zoneForOrder(order({ customer_city: "جنزور" }), index).colorHex).toBe("#d80a0a");
  });

  test("is unknown rather than wrong when Darb serves no such place", () => {
    const zone = zoneForOrder(order({ customer_city: "القربوللي" }), index);
    expect(zone.colorHex).toBeNull();
    expect(zone.branchGroup).toBeNull();
    expect(zone.source).toBe("unknown");
    expect(zone.nameFr).toBeNull();
  });

  test("is unknown for a branch group the directory does not know", () => {
    // A new Darb branch we have not synced yet: we know where it goes, but not
    // what colour that is. Saying so beats inventing one.
    const zone = zoneForOrder(order({ branch_group: "NEWBRANCH" }), index);
    expect(zone.branchGroup).toBe("NEWBRANCH");
    expect(zone.colorHex).toBeNull();
    expect(zone.source).toBe("unknown");
  });

  test("handles an order with nothing to go on", () => {
    expect(zoneForOrder(order({}), index).source).toBe("unknown");
  });
});

describe("buildZoneIndex", () => {
  test("maps every branch group in the directory to its colour", () => {
    expect(index.colorByBranchGroup.get("BN")).toBe("#339307");
    expect(index.colorByBranchGroup.get("SB")).toBe("#0cbceb");
  });

  test("survives a directory row with no colour", () => {
    const sparse = buildZoneIndex([
      { branch_group: "EXP", color: null, city: "طرابلس", area: "زناتة" },
    ]);
    expect(sparse.colorByBranchGroup.get("EXP")).toBeUndefined();
    expect(zoneForOrder(order({ branch_group: "EXP" }), sparse).colorHex).toBeNull();
  });
});
