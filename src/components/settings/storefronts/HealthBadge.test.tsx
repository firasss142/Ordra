import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthBadge, computeHealthState, formatRelative } from "./HealthBadge";

describe("computeHealthState", () => {
  test("inactive when storefront disabled", () => {
    expect(
      computeHealthState({
        is_active: false,
        last_webhook_received_at: new Date().toISOString(),
        last_webhook_status: "processed",
        webhook_failure_count: 0,
      }),
    ).toBe("inactive");
  });

  test("never when no webhook has ever arrived", () => {
    expect(
      computeHealthState({
        is_active: true,
        last_webhook_received_at: null,
        last_webhook_status: null,
        webhook_failure_count: 0,
      }),
    ).toBe("never");
  });

  test("failing when 3+ consecutive errors", () => {
    expect(
      computeHealthState({
        is_active: true,
        last_webhook_received_at: new Date().toISOString(),
        last_webhook_status: "error",
        webhook_failure_count: 5,
      }),
    ).toBe("failing");
  });

  test("stale when last webhook older than threshold", () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();
    expect(
      computeHealthState({
        is_active: true,
        last_webhook_received_at: oldDate,
        last_webhook_status: "processed",
        webhook_failure_count: 0,
      }),
    ).toBe("stale");
  });

  test("ok when recent + healthy", () => {
    expect(
      computeHealthState({
        is_active: true,
        last_webhook_received_at: new Date().toISOString(),
        last_webhook_status: "processed",
        webhook_failure_count: 0,
      }),
    ).toBe("ok");
  });
});

describe("HealthBadge", () => {
  test("renders connected label for ok state", () => {
    render(<HealthBadge state="ok" />);
    expect(screen.getByText("Connecté")).toBeDefined();
  });

  test("renders failure label for failing state", () => {
    render(<HealthBadge state="failing" />);
    expect(screen.getByText("Échec")).toBeDefined();
  });
});

describe("formatRelative", () => {
  test("returns em dash for null", () => {
    expect(formatRelative(null)).toBe("—");
  });

  test("returns recent string for seconds ago", () => {
    expect(formatRelative(new Date().toISOString())).toBe("à l'instant");
  });
});
