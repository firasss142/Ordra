import { describe, it, expect } from "vitest";
import { destinationKey } from "./destination-key";

describe("destinationKey", () => {
  // The Darb pair is the only thing the rates route actually resolves a quote
  // from, so when it is bound it alone decides the key.
  it("uses the bound Darb pair when there is one", () => {
    expect(destinationKey({ darb_destination_id: 18, customer_city: "الخمس" })).toBe("darb:18");
  });

  it("falls back to the city text when no pair is bound", () => {
    // Intake stores a free-text city; the route resolves it with resolveDarbAny.
    expect(destinationKey({ darb_destination_id: null, customer_city: "بنغازي" })).toBe("city:بنغازي");
  });

  it("ignores case and surrounding blanks so a cosmetic edit is not a new quote", () => {
    expect(destinationKey({ darb_destination_id: null, customer_city: "  Tripoli " }))
      .toBe(destinationKey({ darb_destination_id: null, customer_city: "tripoli" }));
  });

  it("says 'none' when the order has no destination at all", () => {
    expect(destinationKey({ darb_destination_id: null, customer_city: null })).toBe("none");
    expect(destinationKey({ darb_destination_id: null, customer_city: "   " })).toBe("none");
    expect(destinationKey(null)).toBe("none");
    expect(destinationKey(undefined)).toBe("none");
  });

  // The whole point: two different destinations must never share a key, or SWR
  // serves the first one's quote for the second one's address.
  it("gives two destinations two different keys", () => {
    const khoms = destinationKey({ darb_destination_id: 18, customer_city: "الخمس" });
    const benghazi = destinationKey({ darb_destination_id: 78, customer_city: "بنغازي" });
    expect(khoms).not.toBe(benghazi);
  });

  it("is stable across renders for an unchanged destination", () => {
    const a = destinationKey({ darb_destination_id: 18, customer_city: "الخمس" });
    const b = destinationKey({ darb_destination_id: 18, customer_city: "الخمس" });
    expect(a).toBe(b);
  });
});
