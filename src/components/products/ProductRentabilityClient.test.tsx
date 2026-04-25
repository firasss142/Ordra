import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import {
  getProductHealthSignals,
  ProductRentabilityClient,
} from "./ProductRentabilityClient";
import type { ProductProfitabilityData } from "@/types/profitability";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace
        ? `${namespace}.${key}`.split(".")
        : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val
        );
      }
      return val;
    };
    return resolve;
  },
}));

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
}));

function makeData(overrides: Partial<ProductProfitabilityData> = {}): {
  data: ProductProfitabilityData;
} {
  return {
    data: {
      product_name: "Test",
      current_stock: 50,
      low_stock_threshold: 10,
      currency: "TND",
      period: { from_date: "2026-04-01", to_date: "2026-04-13" },
      totalLeads: 100,
      confirmationRate: 60,
      deliveryRate: 80,
      returnRate: 5,
      revenue: 5000,
      totalCogs: 1500,
      totalDeliveryCost: 400,
      totalReturnCost: 100,
      totalPackingCost: 60,
      totalAdSpend: 500,
      totalProcessingCost: 30,
      simplifiedNetProfit: 2410,
      costPerDelivered: 38,
      confirmedCount: 60,
      dispatchedCount: 50,
      deliveredCount: 40,
      returnedCount: 5,
      previous: null,
      ...overrides,
    } as ProductProfitabilityData,
  };
}

describe("getProductHealthSignals", () => {
  test("flags critical return rate at 15% or above", () => {
    const data = makeData({ returnRate: 15 }).data;
    expect(getProductHealthSignals(data).returnRate).toBe("critical");
  });

  test("flags warn return rate between 10% and 15%", () => {
    const data = makeData({ returnRate: 12 }).data;
    expect(getProductHealthSignals(data).returnRate).toBe("warn");
  });

  test("flags ads pressure when ad spend ≥ 40% of revenue", () => {
    const data = makeData({ revenue: 1000, totalAdSpend: 500 }).data;
    expect(getProductHealthSignals(data).adsPressure).toBe(true);
  });

  test("flags low stock when current_stock ≤ threshold", () => {
    const data = makeData({ current_stock: 5, low_stock_threshold: 10 }).data;
    expect(getProductHealthSignals(data).lowStock).toBe(true);
  });

  test("flags negative profit when simplifiedNetProfit < 0", () => {
    const data = makeData({ simplifiedNetProfit: -100 }).data;
    expect(getProductHealthSignals(data).negativeProfit).toBe(true);
  });

  test("flags healthy margin when ≥ 15% and profit positive", () => {
    const data = makeData({ revenue: 1000, simplifiedNetProfit: 200 }).data;
    expect(getProductHealthSignals(data).healthyMargin).toBe(true);
  });
});

describe("ProductRentabilityClient", () => {
  const period = { from_date: "2026-04-01", to_date: "2026-04-13" };

  test("renders loading state", () => {
    mockUseSWR.mockReturnValue({ data: undefined, isLoading: true });
    render(
      <ProductRentabilityClient productId="p-1" period={period} />
    );
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });

  test("renders empty state when API returns no data", () => {
    mockUseSWR.mockReturnValue({ data: { data: null }, isLoading: false });
    render(
      <ProductRentabilityClient productId="p-1" period={period} />
    );
    expect(
      screen.getByText("Aucune donnée pour la période sélectionnée")
    ).toBeInTheDocument();
  });

  test("renders hero cards with values", () => {
    mockUseSWR.mockReturnValue({ data: makeData(), isLoading: false });
    render(
      <ProductRentabilityClient productId="p-1" period={period} />
    );
    // Hero labels (Profit net is also used in composition bars, so use getAllByText)
    expect(screen.getAllByText("Profit net").length).toBeGreaterThan(0);
    expect(screen.getByText("Chiffre d'affaires")).toBeInTheDocument();
    expect(screen.getByText("Profit / livrée")).toBeInTheDocument();
    // hero values render with currency suffix (we use FR format)
    expect(screen.getAllByText(/5 000,00 TND/).length).toBeGreaterThan(0);
  });

  test("shows critical return-rate pill when ≥ 15%", () => {
    mockUseSWR.mockReturnValue({
      data: makeData({ returnRate: 18 }),
      isLoading: false,
    });
    render(
      <ProductRentabilityClient productId="p-1" period={period} />
    );
    expect(screen.getByText("Élevé")).toBeInTheDocument();
  });

  test("shows ads-pressure pill when ad spend ≥ 40% of revenue", () => {
    mockUseSWR.mockReturnValue({
      data: makeData({ revenue: 1000, totalAdSpend: 500 }),
      isLoading: false,
    });
    render(
      <ProductRentabilityClient productId="p-1" period={period} />
    );
    expect(screen.getByText("Pub élevée")).toBeInTheDocument();
  });
});
