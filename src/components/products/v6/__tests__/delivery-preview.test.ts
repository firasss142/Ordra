import { describe, it, expect } from "vitest";
import { previewDelivery } from "../delivery-preview";

// The server's 30-day averages for qr-01, per delivery.
const BASIS = { carrier: 1816.269 / 77, units: 1, parcels: 155.681 / 77, confirmed: 159 / 77, ads: 10566.192 / 77 };

describe("previewDelivery — the edit page's what-if on typed values", () => {
  it("subtracts, from the typed price, what one delivery costs on average", () => {
    const p = previewDelivery({ price: 249, cogs: 40, packing: 0.5, processing: 0 }, BASIS);
    expect(p.before).toBeCloseTo(249 - 23.588 - 40 - 1.0109, 2);
    expect(p.net).toBeCloseTo(47.18, 2);
  });

  it("moves with the cost being typed", () => {
    const a = previewDelivery({ price: 249, cogs: 40, packing: 0.5, processing: 0 }, BASIS);
    const b = previewDelivery({ price: 249, cogs: 50, packing: 0.5, processing: 0 }, BASIS);
    expect(a.net - b.net).toBeCloseTo(10, 10);
  });

  it("charges processing per confirmed order when there is one", () => {
    const p = previewDelivery({ price: 249, cogs: 40, packing: 0.5, processing: 1 }, BASIS);
    expect(p.processing).toBeCloseTo(159 / 77, 10);
  });

  it("splits the price into the rail's bar, summing to 1", () => {
    const p = previewDelivery({ price: 249, cogs: 40, packing: 0.5, processing: 0 }, BASIS);
    expect(p.shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });
});
