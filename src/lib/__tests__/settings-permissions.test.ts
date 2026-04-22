import { describe, it, expect } from "vitest";
import {
  canReadSettings,
  canWriteSettings,
  canManageCarriers,
  canManageStorefronts,
  canManageAgents,
} from "../settings-permissions";

describe("canReadSettings", () => {
  it("super_admin can read any market settings", () => {
    expect(canReadSettings("super_admin", "market-ly", "market-tn")).toBe(true);
  });

  it("super_admin can read own market settings", () => {
    expect(canReadSettings("super_admin", "market-tn", "market-tn")).toBe(true);
  });

  it("market_manager can read own market settings", () => {
    expect(canReadSettings("market_manager", "market-tn", "market-tn")).toBe(
      true
    );
  });

  it("market_manager cannot read another market's settings", () => {
    expect(canReadSettings("market_manager", "market-ly", "market-tn")).toBe(
      false
    );
  });

  it("agent cannot read settings", () => {
    expect(canReadSettings("agent", "market-tn", "market-tn")).toBe(false);
  });

  it("agent cannot read settings even for own market", () => {
    expect(canReadSettings("agent", "market-tn", "market-tn")).toBe(false);
  });
});

describe("canWriteSettings", () => {
  it("super_admin can write any market settings", () => {
    expect(canWriteSettings("super_admin", "market-ly", "market-tn")).toBe(
      true
    );
  });

  it("super_admin can write own market settings", () => {
    expect(canWriteSettings("super_admin", "market-tn", "market-tn")).toBe(
      true
    );
  });

  it("market_manager can write own market settings", () => {
    expect(canWriteSettings("market_manager", "market-tn", "market-tn")).toBe(
      true
    );
  });

  it("market_manager cannot write another market's settings", () => {
    expect(canWriteSettings("market_manager", "market-ly", "market-tn")).toBe(
      false
    );
  });

  it("agent cannot write settings", () => {
    expect(canWriteSettings("agent", "market-tn", "market-tn")).toBe(false);
  });
});

describe("canManageCarriers", () => {
  it("super_admin can manage carriers", () => {
    expect(canManageCarriers("super_admin")).toBe(true);
  });

  it("market_manager cannot manage carriers", () => {
    expect(canManageCarriers("market_manager")).toBe(false);
  });

  it("agent cannot manage carriers", () => {
    expect(canManageCarriers("agent")).toBe(false);
  });
});

describe("canManageStorefronts", () => {
  it("super_admin can manage storefronts", () => {
    expect(canManageStorefronts("super_admin")).toBe(true);
  });

  it("market_manager cannot manage storefronts", () => {
    expect(canManageStorefronts("market_manager")).toBe(false);
  });

  it("agent cannot manage storefronts", () => {
    expect(canManageStorefronts("agent")).toBe(false);
  });
});

describe("canManageAgents", () => {
  it("super_admin can manage agents in any market", () => {
    expect(canManageAgents("super_admin", "market-ly", "market-tn")).toBe(true);
  });

  it("super_admin can manage agents in own market", () => {
    expect(canManageAgents("super_admin", "market-tn", "market-tn")).toBe(true);
  });

  it("market_manager can manage agents in own market", () => {
    expect(canManageAgents("market_manager", "market-tn", "market-tn")).toBe(
      true
    );
  });

  it("market_manager cannot manage agents in another market", () => {
    expect(canManageAgents("market_manager", "market-ly", "market-tn")).toBe(
      false
    );
  });

  it("agent cannot manage agents", () => {
    expect(canManageAgents("agent", "market-tn", "market-tn")).toBe(false);
  });
});
