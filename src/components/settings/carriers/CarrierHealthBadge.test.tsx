import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CarrierHealthBadge,
  computeCarrierHealth,
  formatDeliveryRate,
  formatHours,
  AdapterBadge,
} from "./CarrierHealthBadge";

describe("computeCarrierHealth", () => {
  const base = {
    is_active: true,
    reachable: null,
    delivery_rate_30d: null,
    sample_size: 0,
  } as const;

  test("inactive when disabled", () => {
    expect(computeCarrierHealth({ ...base, is_active: false })).toBe("inactive");
  });

  test("failing when test reachable=false", () => {
    expect(computeCarrierHealth({ ...base, reachable: false })).toBe("failing");
  });

  test("failing when delivery rate below threshold with enough samples", () => {
    expect(
      computeCarrierHealth({
        ...base,
        reachable: true,
        delivery_rate_30d: 0.4,
        sample_size: 20,
      })
    ).toBe("failing");
  });

  test("connected when rate healthy and reachable", () => {
    expect(
      computeCarrierHealth({
        ...base,
        reachable: true,
        delivery_rate_30d: 0.85,
        sample_size: 20,
      })
    ).toBe("connected");
  });

  test("idle when active but no sample and not tested", () => {
    expect(computeCarrierHealth({ ...base, reachable: true })).toBe("idle");
  });

  test("unknown when never tested and no samples", () => {
    expect(computeCarrierHealth(base)).toBe("unknown");
  });

  test("connected when only samples, no ping but good rate", () => {
    expect(
      computeCarrierHealth({
        ...base,
        delivery_rate_30d: 0.9,
        sample_size: 50,
      })
    ).toBe("connected");
  });
});

describe("CarrierHealthBadge", () => {
  test("renders connected label", () => {
    render(<CarrierHealthBadge state="connected" />);
    expect(screen.getByText("Connecté")).toBeInTheDocument();
  });
  test("renders failing label", () => {
    render(<CarrierHealthBadge state="failing" />);
    expect(screen.getByText("En échec")).toBeInTheDocument();
  });
  test("renders inactive label", () => {
    render(<CarrierHealthBadge state="inactive" />);
    expect(screen.getByText("Désactivé")).toBeInTheDocument();
  });
});

describe("AdapterBadge", () => {
  test("capitalizes known adapter code", () => {
    render(<AdapterBadge code="navex" known />);
    expect(screen.getByText("Navex")).toBeInTheDocument();
  });
  test("shows personalisé for unknown", () => {
    render(<AdapterBadge code="whatever" known={false} />);
    expect(screen.getByText("Personnalisé")).toBeInTheDocument();
  });
});

describe("formatters", () => {
  test("formatDeliveryRate rounds to percent", () => {
    expect(formatDeliveryRate(0.876)).toBe("88%");
    expect(formatDeliveryRate(null)).toBe("—");
  });
  test("formatHours prints reasonable units", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.5)).toBe("< 1 h");
    expect(formatHours(12)).toBe("12 h");
    expect(formatHours(72)).toBe("3 j");
  });
});
