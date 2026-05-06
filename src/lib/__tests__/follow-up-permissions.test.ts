import { describe, test, expect } from "vitest";
import {
  canViewFollowUp,
  canCreateFollowUp,
  canEditFollowUp,
  canAppendEntry,
  canTransitionFollowUp,
  canDeleteFollowUp,
  isFollowUpEligibleOrderStatus,
} from "../follow-up-permissions";

const AGENT_ID = "agent-1";
const OTHER_AGENT_ID = "agent-2";
const MARKET_A = "m-a";
const MARKET_B = "m-b";

const followUpInMarketA = {
  market_id: MARKET_A,
  confirming_agent_id: AGENT_ID,
};
const followUpOtherAgentMarketA = {
  market_id: MARKET_A,
  confirming_agent_id: OTHER_AGENT_ID,
};
const followUpInMarketB = {
  market_id: MARKET_B,
  confirming_agent_id: OTHER_AGENT_ID,
};

describe("canViewFollowUp", () => {
  test("super_admin sees any follow-up in any market", () => {
    expect(canViewFollowUp("super_admin", followUpInMarketA, AGENT_ID, MARKET_B)).toBe(true);
    expect(canViewFollowUp("super_admin", followUpInMarketB, AGENT_ID, null)).toBe(true);
  });

  test("market_manager sees own market, not other markets", () => {
    expect(canViewFollowUp("market_manager", followUpInMarketA, "mgr", MARKET_A)).toBe(true);
    expect(canViewFollowUp("market_manager", followUpInMarketB, "mgr", MARKET_A)).toBe(false);
  });

  test("market_manager with null market_id denied", () => {
    expect(canViewFollowUp("market_manager", followUpInMarketA, "mgr", null)).toBe(false);
  });

  test("agent sees only follow-ups where they're the confirming agent", () => {
    expect(canViewFollowUp("agent", followUpInMarketA, AGENT_ID, MARKET_A)).toBe(true);
    expect(canViewFollowUp("agent", followUpOtherAgentMarketA, AGENT_ID, MARKET_A)).toBe(false);
  });
});

describe("canCreateFollowUp", () => {
  const order = { market_id: MARKET_A };

  test("super_admin always", () => {
    expect(canCreateFollowUp("super_admin", order, AGENT_ID, "any", null)).toBe(true);
  });

  test("market_manager in own market", () => {
    expect(canCreateFollowUp("market_manager", order, AGENT_ID, "mgr", MARKET_A)).toBe(true);
    expect(canCreateFollowUp("market_manager", order, AGENT_ID, "mgr", MARKET_B)).toBe(false);
  });

  test("agent only when they are the confirming agent AND same market", () => {
    expect(canCreateFollowUp("agent", order, AGENT_ID, AGENT_ID, MARKET_A)).toBe(true);
    expect(canCreateFollowUp("agent", order, OTHER_AGENT_ID, AGENT_ID, MARKET_A)).toBe(false);
    expect(canCreateFollowUp("agent", order, AGENT_ID, AGENT_ID, MARKET_B)).toBe(false);
  });

  test("agent blocked when confirming agent is null (e.g. order confirmed by manager)", () => {
    expect(canCreateFollowUp("agent", order, null, AGENT_ID, MARKET_A)).toBe(false);
  });
});

describe("canEditFollowUp / canAppendEntry", () => {
  test("mirror canViewFollowUp (agent must be confirming)", () => {
    expect(canEditFollowUp("agent", followUpInMarketA, AGENT_ID, MARKET_A)).toBe(true);
    expect(canEditFollowUp("agent", followUpOtherAgentMarketA, AGENT_ID, MARKET_A)).toBe(false);
    expect(canAppendEntry("agent", followUpInMarketA, AGENT_ID, MARKET_A)).toBe(true);
    expect(canAppendEntry("agent", followUpOtherAgentMarketA, AGENT_ID, MARKET_A)).toBe(false);
  });
});

describe("canTransitionFollowUp", () => {
  test("valid graph + view permission", () => {
    expect(
      canTransitionFollowUp("agent", followUpInMarketA, "open", "in_progress", AGENT_ID, MARKET_A)
    ).toBe(true);
    expect(
      canTransitionFollowUp("agent", followUpInMarketA, "resolved", "in_progress", AGENT_ID, MARKET_A)
    ).toBe(true);
  });

  test("rejects invalid graph transitions", () => {
    expect(
      canTransitionFollowUp("super_admin", followUpInMarketA, "resolved", "escalated", AGENT_ID, null)
    ).toBe(false);
    expect(
      canTransitionFollowUp("market_manager", followUpInMarketA, "open", "open", "mgr", MARKET_A)
    ).toBe(false);
  });

  test("rejects when caller cannot view follow-up", () => {
    expect(
      canTransitionFollowUp("agent", followUpOtherAgentMarketA, "open", "in_progress", AGENT_ID, MARKET_A)
    ).toBe(false);
  });
});

describe("canDeleteFollowUp", () => {
  test("super_admin only", () => {
    expect(canDeleteFollowUp("super_admin")).toBe(true);
    expect(canDeleteFollowUp("market_manager")).toBe(false);
    expect(canDeleteFollowUp("agent")).toBe(false);
  });
});

describe("isFollowUpEligibleOrderStatus", () => {
  test("accepts post-confirmation statuses", () => {
    ["confirmed", "uploaded", "dispatched", "deposit", "in_transit", "to_be_returned"].forEach(
      (s) => expect(isFollowUpEligibleOrderStatus(s)).toBe(true)
    );
  });

  test("rejects pre-confirmation and terminal statuses", () => {
    ["new", "assigned", "attempt_1", "callback_scheduled", "delivered", "returned", "rejected", "cancelled"].forEach(
      (s) => expect(isFollowUpEligibleOrderStatus(s)).toBe(false)
    );
  });
});
