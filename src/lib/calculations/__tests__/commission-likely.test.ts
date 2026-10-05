import { describe, test, expect } from "vitest";
import { likelyPerParcel } from "../commission-likely";

/**
 * « Mes commissions » › En route: each parcel on the road shows « ≈ 7 » — the rate times how
 * often this agent's confirmed orders end up delivered. Rounded like the RPC's est_likely.
 */
describe("likelyPerParcel", () => {
  test("rate × delivery rate, rounded to a whole unit like est_likely", () => {
    expect(likelyPerParcel({ enabled: true, rate: 10, deliveryRate: 0.714 })).toBe(7);
    expect(likelyPerParcel({ enabled: true, rate: 10, deliveryRate: 0.55 })).toBe(6);
  });

  test("no figure when the commission is off, there is no rate, or no rate of delivery yet", () => {
    expect(likelyPerParcel({ enabled: false, rate: 10, deliveryRate: 0.7 })).toBeNull();
    expect(likelyPerParcel({ enabled: true, rate: null, deliveryRate: 0.7 })).toBeNull();
    expect(likelyPerParcel({ enabled: true, rate: 10, deliveryRate: null })).toBeNull();
  });
});
