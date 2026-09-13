import { describe, test, expect } from "vitest";
import { canTogglePickup } from "../pickup-window";

// Turning pickup OFF and turning it back ON are not the same act.
//
// OFF is an observation: the agent watched the driver load and leave. They are
// the only person standing in the building, so they must be able to say it.
//
// ON again, before midnight, contradicts that observation — it re-summons a
// driver. Restricting it to a manager stops a wrong press being quietly undone
// by whoever pressed it, and makes the reversal a decision someone owns.
describe("canTogglePickup", () => {
  const site = "site-tripoli";

  describe("turning pickup OFF (the driver has been)", () => {
    test("a warehouse agent may switch off their OWN site", () => {
      expect(
        canTogglePickup({
          role: "warehouse_agent",
          actorSiteId: site,
          targetSiteId: site,
          turningOff: true,
        }),
      ).toBe(true);
    });

    test("a warehouse agent may NOT switch off the other building", () => {
      expect(
        canTogglePickup({
          role: "warehouse_agent",
          actorSiteId: "site-benghazi",
          targetSiteId: site,
          turningOff: true,
        }),
      ).toBe(false);
    });

    test("an unassigned warehouse agent may switch off nothing", () => {
      expect(
        canTogglePickup({
          role: "warehouse_agent",
          actorSiteId: null,
          targetSiteId: site,
          turningOff: true,
        }),
      ).toBe(false);
    });

    test("manager and super_admin may switch off any site", () => {
      for (const role of ["market_manager", "super_admin"] as const) {
        expect(
          canTogglePickup({
            role,
            actorSiteId: null,
            targetSiteId: site,
            turningOff: true,
          }),
        ).toBe(true);
      }
    });
  });

  describe("turning pickup back ON before midnight", () => {
    test("a warehouse agent may NOT, even on their own site", () => {
      expect(
        canTogglePickup({
          role: "warehouse_agent",
          actorSiteId: site,
          targetSiteId: site,
          turningOff: false,
        }),
      ).toBe(false);
    });

    test("manager and super_admin may", () => {
      for (const role of ["market_manager", "super_admin"] as const) {
        expect(
          canTogglePickup({
            role,
            actorSiteId: null,
            targetSiteId: site,
            turningOff: false,
          }),
        ).toBe(true);
      }
    });
  });

  test("roles with no business here are refused both ways", () => {
    for (const role of ["agent", "investor"] as const) {
      expect(
        canTogglePickup({ role, actorSiteId: site, targetSiteId: site, turningOff: true }),
      ).toBe(false);
      expect(
        canTogglePickup({ role, actorSiteId: site, targetSiteId: site, turningOff: false }),
      ).toBe(false);
    }
  });
});
