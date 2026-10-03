import { describe, test, expect } from "vitest";
import { teamAlertInputs } from "./alerts";
import type { TeamAlerts } from "./types";

const LY = "00000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-10-02T21:56:00Z");

const payload: TeamAlerts = {
  computed_at: "2026-10-02T21:56:00Z",
  markets: [
    {
      market_id: LY,
      call_delay_hours: 2,
      idle_minutes: 30,
      last_order_at: "2026-09-29T15:30:00Z",
      agents: [
        { agent_id: "r", name: "roqaya", uncalled: 7, oldest_min: 666, to_call: 7, idle_since: null },
        { agent_id: "t", name: "tasnim", uncalled: 0, oldest_min: null, to_call: 3, idle_since: "2026-10-02T21:10:00Z" },
      ],
    },
  ],
};

describe("the bell's three team alerts", () => {
  test("orders stopped arriving: one per market, anchored on the last order", () => {
    const intake = teamAlertInputs(payload, NOW).filter((a) => a.type === "intake_silent");
    expect(intake).toEqual([
      {
        type: "intake_silent",
        entityId: LY,
        entityKind: "market",
        href: "/system/settings/shops",
        primary: "Libye",
        secondary: null,
        anchor: "2026-09-29T15:30:00Z",
        meta: null,
        marketId: LY,
      },
    ]);
  });

  test("no intake alert within six hours of the last order, nor for a market that never had one", () => {
    const recent = { ...payload, markets: [{ ...payload.markets[0], last_order_at: "2026-10-02T18:00:00Z", agents: [] }] };
    expect(teamAlertInputs(recent, NOW)).toEqual([]);
    const never = { ...payload, markets: [{ ...payload.markets[0], last_order_at: null, agents: [] }] };
    expect(teamAlertInputs(never, NOW)).toEqual([]);
  });

  test("orders not called N h after assignment: per agent, anchored on the oldest, with the count", () => {
    const unc = teamAlertInputs(payload, NOW).filter((a) => a.type === "agent_uncalled");
    expect(unc).toEqual([
      {
        type: "agent_uncalled",
        entityId: "r",
        entityKind: "agent",
        href: "/team?agent=r",
        primary: "roqaya",
        secondary: null,
        anchor: new Date(NOW - 666 * 60_000).toISOString(),
        meta: { count: 7, hours: 2 },
        marketId: LY,
      },
    ]);
  });

  test("online without calling: per agent, anchored on her last action", () => {
    const idle = teamAlertInputs(payload, NOW).filter((a) => a.type === "agent_idle");
    expect(idle).toEqual([
      {
        type: "agent_idle",
        entityId: "t",
        entityKind: "agent",
        href: "/team?agent=t",
        primary: "tasnim",
        secondary: null,
        anchor: "2026-10-02T21:10:00Z",
        meta: { to_call: 3 },
        marketId: LY,
      },
    ]);
  });

  test("an empty or foreign payload yields nothing rather than throwing", () => {
    expect(teamAlertInputs(null, NOW)).toEqual([]);
    expect(teamAlertInputs({ products: [] } as unknown as TeamAlerts, NOW)).toEqual([]);
  });
});
