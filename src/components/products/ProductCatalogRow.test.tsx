import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), val);
      return val;
    };
    return resolve;
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ProductCatalogRow } from "./ProductCatalogRow";
import type { BulkProductMetrics } from "@/app/api/products/profitability-bulk/route";

const baseProduct = {
  id: "prod-1",
  name: "Crème Hydratante",
  unit_cogs: 12,
  packing_cost: 2.5,
  cpl: 1.5,
  low_stock_threshold: 10,
  current_stock: 50,
  system_inventory: 50,
  real_inventory: 50,
  is_active: true,
  variant_count: 2,
  market_id: "m-1",
};

const lowStockProduct = {
  ...baseProduct,
  current_stock: 5,
  system_inventory: 5,
  real_inventory: 3,
};

const greenMetrics: BulkProductMetrics = {
  product_id: "prod-1",
  total_leads: 100,
  confirmation_rate: 65,
  delivery_rate: 75,
  return_rate: 10,
  revenue: 5000,
  simplified_net_profit: 1000,
  margin_pct: 20,
};

const noDataMetrics: BulkProductMetrics = {
  product_id: "prod-1",
  total_leads: 0,
  confirmation_rate: 0,
  delivery_rate: 0,
  return_rate: 0,
  revenue: 0,
  simplified_net_profit: 0,
  margin_pct: 0,
};

const losingMetrics: BulkProductMetrics = {
  ...greenMetrics,
  simplified_net_profit: -200,
  margin_pct: -4,
};

beforeEach(() => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

function renderRow(overrides: Partial<React.ComponentProps<typeof ProductCatalogRow>> = {}) {
  const defaults: React.ComponentProps<typeof ProductCatalogRow> = {
    product: baseProduct,
    metrics: greenMetrics,
    mode: "performance",
    locale: "fr",
    currency: "TND",
    isSelected: false,
    onSelect: vi.fn(),
    onToggleActive: vi.fn(),
    onAdjustStock: vi.fn(),
    onThresholdSave: vi.fn(),
    canManage: true,
    canToggleActive: true,
  };
  return render(<ProductCatalogRow {...defaults} {...overrides} />);
}

describe("ProductCatalogRow", () => {
  it("renders product name", () => {
    renderRow();
    expect(screen.getByText("Crème Hydratante")).toBeInTheDocument();
  });

  it("shows green health dot when active, stocked, and margin >= 5", () => {
    renderRow({ metrics: greenMetrics });
    const dot = screen.getByRole("img", { name: /sain/i });
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveStyle({ backgroundColor: "#008060" });
  });

  it("shows red health dot when margin_pct < 0", () => {
    renderRow({ metrics: losingMetrics });
    const dot = screen.getByRole("img", { name: /déficitaire/i });
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveStyle({ backgroundColor: "#D72C0D" });
  });

  it("shows amber health dot when product is low stock", () => {
    renderRow({ product: lowStockProduct, metrics: greenMetrics });
    expect(screen.getByRole("img", { name: /surveiller/i })).toBeInTheDocument();
  });

  it("shows green health dot when no metrics data is available (catalogue mode)", () => {
    renderRow({ metrics: noDataMetrics });
    // No leads = no margin signal; stocked + active = green
    expect(screen.getByRole("img", { name: /sain/i })).toBeInTheDocument();
  });

  it("shows metrics in performance mode", () => {
    renderRow({ mode: "performance", metrics: greenMetrics });
    expect(screen.getByText(/65/)).toBeInTheDocument(); // confirmation rate
    expect(screen.getByText(/75/)).toBeInTheDocument(); // delivery rate
  });

  it("shows COGS info in catalogue mode", () => {
    renderRow({ mode: "catalogue" });
    // COGS value should appear in catalogue mode
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it("hides inline threshold edit when canManage is false", () => {
    renderRow({ mode: "catalogue", canManage: false });
    expect(screen.queryByRole("spinbutton", { name: /seuil/i })).not.toBeInTheDocument();
  });

  it("shows inline threshold input in catalogue mode when canManage", () => {
    renderRow({ mode: "catalogue", canManage: true });
    // threshold field should be editable
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("calls onToggleActive when toggle is clicked", async () => {
    const onToggleActive = vi.fn();
    renderRow({ onToggleActive, canToggleActive: true });
    const toggle = screen.getByRole("checkbox", { name: /statut/i });
    await userEvent.click(toggle);
    expect(onToggleActive).toHaveBeenCalledWith("prod-1");
  });

  it("does not show active toggle when canToggleActive is false", () => {
    renderRow({ canToggleActive: false });
    expect(screen.queryByRole("checkbox", { name: /statut/i })).not.toBeInTheDocument();
  });

  it("shows low stock badge when stock <= threshold", () => {
    renderRow({ product: { ...baseProduct, current_stock: 5, low_stock_threshold: 10 } });
    expect(screen.getByLabelText("Stock bas")).toBeInTheDocument();
  });

  it("does not show low stock badge when stock > threshold", () => {
    renderRow({ product: { ...baseProduct, current_stock: 20, low_stock_threshold: 10 } });
    expect(screen.queryByLabelText("Stock bas")).not.toBeInTheDocument();
  });

  it("calls onAdjustStock from ⋯ menu (super_admin only)", async () => {
    const onAdjustStock = vi.fn();
    renderRow({ onAdjustStock, canManage: true });
    // Open the ⋯ menu
    const menuBtn = screen.getByRole("button", { name: /actions/i });
    await userEvent.click(menuBtn);
    // Stock adjustment option should appear
    await waitFor(() => expect(screen.getByText(/ajuster stock/i)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/ajuster stock/i));
    expect(onAdjustStock).toHaveBeenCalledWith("prod-1", "Crème Hydratante");
  });

  it("checkbox selects the row", async () => {
    const onSelect = vi.fn();
    renderRow({ onSelect, isSelected: false });
    const checkbox = screen.getByRole("checkbox", { name: /sélectionner/i });
    await userEvent.click(checkbox);
    expect(onSelect).toHaveBeenCalledWith("prod-1");
  });

  it("shows variant chips when variant_count > 0", () => {
    renderRow({ product: { ...baseProduct, variant_count: 2 } });
    expect(screen.getByText(/2 variante/i)).toBeInTheDocument();
  });

  it("does not show variant chips when variant_count is 0", () => {
    renderRow({ product: { ...baseProduct, variant_count: 0 } });
    expect(screen.queryByText(/variante/i)).not.toBeInTheDocument();
  });
});
