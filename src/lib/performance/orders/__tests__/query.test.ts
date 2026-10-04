import { describe, it, expect } from "vitest";
import { parseState, stateToParams, EMPTY_STATE, type PerfState } from "@/lib/performance/orders/query";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";
const V2 = "44444444-4444-4444-8444-444444444444";
const A1 = "55555555-5555-4555-8555-555555555555";

describe("URL state of the page", () => {
  it("defaults to 30 days, everything, no comparison", () => {
    expect(parseState(new URLSearchParams())).toEqual(EMPTY_STATE);
    expect(EMPTY_STATE).toMatchObject({ period: "30d", sel: {}, ag: [], cmp: null });
  });
  it("round-trips products with sizes, agents and each comparison", () => {
    const states: PerfState[] = [
      { ...EMPTY_STATE, period: "m:2026-09" as const, sel: { [P1]: [V1, V2], [P2]: null }, ag: [A1] },
      { ...EMPTY_STATE, period: "custom" as const, from: "2026-09-02", to: "2026-09-20", cmp: { kind: "p" as const, sel: { [P2]: null } } },
      { ...EMPTY_STATE, cmp: { kind: "a" as const, ag: [A1] } },
      { ...EMPTY_STATE, cmp: { kind: "d" as const, from: "2026-08-01", to: "2026-08-31" } },
      { ...EMPTY_STATE, cmp: { kind: "p" as const, sel: {} } },
      { ...EMPTY_STATE, store: P1 },
    ];
    for (const s of states) expect(parseState(stateToParams(s))).toEqual(s);
  });
  it("drops what it cannot read", () => {
    const s = parseState(new URLSearchParams("period=nope&p=not-a-uuid,&ag=x&cmp=d:2026-09-10|2026-09-01"));
    expect(s).toEqual(EMPTY_STATE);
  });
  it("reads the store opened from Accueil (?boutique=)", () => {
    expect(parseState(new URLSearchParams(`boutique=${P1}`)).store).toBe(P1);
    expect(parseState(new URLSearchParams("boutique=nope")).store).toBeNull();
  });
  it("writes nothing for the defaults", () => {
    expect(stateToParams(EMPTY_STATE).toString()).toBe("");
  });
});
