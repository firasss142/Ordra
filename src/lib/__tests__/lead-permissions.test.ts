import { describe, test, expect } from "vitest";
import {
  canViewLeads,
  canCreateLead,
  canAssignLeads,
  canConvertLead,
  canArchiveLead,
  canTransitionLead,
} from "../lead-permissions";

describe("canViewLeads", () => {
  test("super_admin sees any market", () => {
    expect(canViewLeads("super_admin", "m1", "m2")).toBe(true);
  });

  test("market_manager sees own market only", () => {
    expect(canViewLeads("market_manager", "m1", "m1")).toBe(true);
    expect(canViewLeads("market_manager", "m1", "m2")).toBe(false);
  });

  test("agent sees own market only", () => {
    expect(canViewLeads("agent", "m1", "m1")).toBe(true);
    expect(canViewLeads("agent", "m1", "m2")).toBe(false);
  });
});

describe("canCreateLead", () => {
  test("super_admin can create in any market", () => {
    expect(canCreateLead("super_admin", "m1", "m2")).toBe(true);
  });

  test("manager/agent can create in own market only", () => {
    expect(canCreateLead("market_manager", "m1", "m1")).toBe(true);
    expect(canCreateLead("market_manager", "m1", "m2")).toBe(false);
    expect(canCreateLead("agent", "m1", "m1")).toBe(true);
    expect(canCreateLead("agent", "m1", "m2")).toBe(false);
  });
});

describe("canAssignLeads", () => {
  test("super_admin + manager can assign", () => {
    expect(canAssignLeads("super_admin", "m1", "m2")).toBe(true);
    expect(canAssignLeads("market_manager", "m1", "m1")).toBe(true);
  });

  test("manager blocked on other market", () => {
    expect(canAssignLeads("market_manager", "m1", "m2")).toBe(false);
  });

  test("agent cannot assign", () => {
    expect(canAssignLeads("agent", "m1", "m1")).toBe(false);
  });
});

describe("canConvertLead", () => {
  test("agent can convert only their own assigned qualified lead", () => {
    const lead = { status: "qualified", assigned_to: "agent-1" };
    expect(canConvertLead("agent", "agent-1", lead)).toBe(true);
  });

  test("agent cannot convert lead assigned to someone else", () => {
    const lead = { status: "qualified", assigned_to: "agent-2" };
    expect(canConvertLead("agent", "agent-1", lead)).toBe(false);
  });

  test("agent cannot convert non-qualified lead", () => {
    const lead = { status: "attempt_1", assigned_to: "agent-1" };
    expect(canConvertLead("agent", "agent-1", lead)).toBe(false);
  });

  test("manager can convert any qualified lead in own market", () => {
    const lead = { status: "qualified", assigned_to: "agent-99" };
    expect(canConvertLead("market_manager", "mgr-1", lead)).toBe(true);
  });

  test("cannot convert terminal leads", () => {
    const lead = { status: "won", assigned_to: "agent-1" };
    expect(canConvertLead("agent", "agent-1", lead)).toBe(false);
    expect(canConvertLead("market_manager", "mgr-1", lead)).toBe(false);
  });
});

describe("canArchiveLead", () => {
  test("super_admin and manager can archive", () => {
    expect(canArchiveLead("super_admin")).toBe(true);
    expect(canArchiveLead("market_manager")).toBe(true);
  });

  test("agent cannot archive", () => {
    expect(canArchiveLead("agent")).toBe(false);
  });
});

describe("canTransitionLead", () => {
  test("blocks invalid transition regardless of role", () => {
    expect(canTransitionLead("super_admin", "new", "won")).toBe(false);
    expect(canTransitionLead("market_manager", "attempt_1", "attempt_3")).toBe(false);
  });

  test("allows valid transitions for super_admin + manager", () => {
    expect(canTransitionLead("super_admin", "assigned", "qualified")).toBe(true);
    expect(canTransitionLead("market_manager", "new", "assigned")).toBe(true);
  });

  test("agent can only transition to agent-allowed targets", () => {
    expect(canTransitionLead("agent", "assigned", "attempt_1")).toBe(true);
    expect(canTransitionLead("agent", "attempt_1", "qualified")).toBe(true);
    expect(canTransitionLead("agent", "attempt_1", "callback_scheduled")).toBe(true);
    expect(canTransitionLead("agent", "qualified", "lost")).toBe(true);
  });

  test("agent cannot archive directly (manager-only action)", () => {
    expect(canTransitionLead("agent", "new", "archived")).toBe(false);
    expect(canTransitionLead("agent", "qualified", "archived")).toBe(false);
  });

  test("agent cannot bypass qualification to won", () => {
    expect(canTransitionLead("agent", "qualified", "won")).toBe(false);
  });
});
