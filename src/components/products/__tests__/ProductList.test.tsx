import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProductList } from "../ProductList";
import type { Role } from "@/types";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

// Mock next-intl — useTranslations returns a function that resolves keys
let mockMessages = frMessages;
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = mockMessages;
      for (const p of parts) {
        val = (val as Record<string, unknown>)?.[p];
      }
      return typeof val === "string" ? val : key;
    };
    return resolve;
  },
}));

// Mock SWR
vi.mock("swr", () => ({
  default: vi.fn(),
}));

import useSWR from "swr";

const mockProducts = [
  {
    id: "prod-1",
    market_id: "market-tn",
    name: "Crème Hydratante",
    unit_cogs: 12,
    packing_cost: 2.5,
    cpl: 3,
    confirmation_processing_cost: 0.5,
    low_stock_threshold: 10,
    current_stock: 5,
    damaged_return_count: 2,
    is_active: true,
    variant_count: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "prod-2",
    market_id: "market-tn",
    name: "Sérum Anti-âge",
    unit_cogs: 25,
    packing_cost: 3,
    cpl: 5,
    confirmation_processing_cost: 1,
    low_stock_threshold: 0,
    current_stock: 2,
    damaged_return_count: 0,
    is_active: false,
    variant_count: 1,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
];

const mockMarkets = [
  { id: "market-tn", name: "Tunisia", code: "tn" },
  { id: "market-ly", name: "Libya", code: "ly" },
];

function setupSWR(products = mockProducts, markets = mockMarkets) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string | null) => {
      if (key && key.includes("/api/products")) {
        return { data: { data: products }, mutate: vi.fn() };
      }
      if (key && key.includes("/api/markets")) {
        return { data: { data: markets }, mutate: vi.fn() };
      }
      return { data: undefined, mutate: vi.fn() };
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMessages = frMessages;
  setupSWR();
});

describe("ProductList", () => {
  describe("table columns", () => {
    it("renders table with correct column headers", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.getByText("Produit")).toBeInTheDocument();
      expect(screen.getByText("Variantes")).toBeInTheDocument();
      expect(screen.getByText("Stock")).toBeInTheDocument();
      expect(screen.getByText("Seuil")).toBeInTheDocument();
      expect(screen.getByText("COGS unitaire")).toBeInTheDocument();
      expect(screen.getByText("Emballage")).toBeInTheDocument();
      expect(screen.getByText("Statut")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });
  });

  describe("product data rendering", () => {
    it("shows product name in Produit column", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.getByText("Crème Hydratante")).toBeInTheDocument();
      expect(screen.getByText("Sérum Anti-âge")).toBeInTheDocument();
    });

    it("shows variant count number in Variantes column", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      const rows = screen.getAllByRole("row");
      const firstProductRow = rows[1];
      expect(within(firstProductRow).getByText("3")).toBeInTheDocument();
    });

    it("shows current_stock number in Stock column", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      const rows = screen.getAllByRole("row");
      const firstProductRow = rows[1];
      expect(within(firstProductRow).getByText("5")).toBeInTheDocument();
    });
  });

  describe("low stock alert", () => {
    it("shows 'Stock bas' badge when current_stock <= low_stock_threshold and threshold > 0", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      // prod-1: current_stock=5, low_stock_threshold=10 → low stock
      expect(screen.getByText("Stock bas")).toBeInTheDocument();
    });

    it("does NOT show 'Stock bas' badge when low_stock_threshold is 0", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      // prod-2: low_stock_threshold=0 → alerts disabled
      const rows = screen.getAllByRole("row");
      const secondProductRow = rows[2];
      expect(
        within(secondProductRow).queryByText("Stock bas")
      ).not.toBeInTheDocument();
    });
  });

  describe("active/inactive status", () => {
    it("shows green dot for active products", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      const rows = screen.getAllByRole("row");
      const activeRow = rows[1]; // prod-1 is active
      const dot = within(activeRow).getByText("●");
      expect(dot).toHaveStyle({ color: "#008060" });
    });

    it("shows grey dot for inactive products", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      const rows = screen.getAllByRole("row");
      const inactiveRow = rows[2]; // prod-2 is inactive
      const dot = within(inactiveRow).getByText("●");
      expect(dot).toHaveStyle({ color: "#6D7175" });
    });
  });

  describe("actions column", () => {
    it("shows 'Modifier' text link for super_admin", () => {
      render(<ProductList role="super_admin" marketId="market-tn" />);
      const modifierLinks = screen.getAllByText("Modifier");
      expect(modifierLinks.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT show 'Modifier' link for market_manager (lockdown: inspect-only)", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.queryByText("Modifier")).not.toBeInTheDocument();
    });

    it("shows activate/deactivate buttons for market_manager", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      // At least one "Désactiver" (active product) should be present
      expect(screen.getAllByText("Désactiver").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("role-based rendering", () => {
    it("does NOT show 'Ajouter un produit' button for market_manager (lockdown: SA-only create)", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(
        screen.queryByRole("button", { name: "Ajouter un produit" })
      ).not.toBeInTheDocument();
    });

    it("shows 'Ajouter un produit' button for super_admin", () => {
      render(<ProductList role="super_admin" marketId="market-tn" />);
      expect(
        screen.getByRole("button", { name: "Ajouter un produit" })
      ).toBeInTheDocument();
    });

    it("shows market selector dropdown for super_admin", () => {
      render(<ProductList role="super_admin" marketId="market-tn" />);
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Tunisia" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Libya" })
      ).toBeInTheDocument();
    });

    it("renders nothing for agent role", () => {
      const { container } = render(
        <ProductList role="agent" marketId="market-tn" />
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("empty state", () => {
    it("shows 'Aucun produit' message when products array is empty", () => {
      setupSWR([]);
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.getByText("Aucun produit")).toBeInTheDocument();
    });

    it("shows 'Ajouter un produit' button in empty state for super_admin", () => {
      setupSWR([]);
      render(<ProductList role="super_admin" marketId="market-tn" />);
      expect(
        screen.getByRole("button", { name: "Ajouter un produit" })
      ).toBeInTheDocument();
    });

    it("does NOT show 'Ajouter un produit' button in empty state for market_manager", () => {
      setupSWR([]);
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(
        screen.queryByRole("button", { name: "Ajouter un produit" })
      ).not.toBeInTheDocument();
    });

    it("does NOT render a table in empty state", () => {
      setupSWR([]);
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });

  describe("i18n — Arabic locale", () => {
    beforeEach(() => {
      mockMessages = arMessages;
      setupSWR();
    });

    it("renders Arabic table headers when locale is ar", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.getByText("المنتج")).toBeInTheDocument();
      expect(screen.getByText("المتغيرات")).toBeInTheDocument();
      expect(screen.getByText("المخزون")).toBeInTheDocument();
      expect(screen.getByText("الحد الأدنى")).toBeInTheDocument();
      expect(screen.getByText("تكلفة الوحدة")).toBeInTheDocument();
      expect(screen.getByText("التغليف")).toBeInTheDocument();
      expect(screen.getByText("الحالة")).toBeInTheDocument();
      expect(screen.getByText("الإجراءات")).toBeInTheDocument();
    });

    it("renders Arabic 'add product' button text for super_admin", () => {
      render(<ProductList role="super_admin" marketId="market-tn" />);
      expect(
        screen.getByRole("button", { name: "إضافة منتج" })
      ).toBeInTheDocument();
    });

    it("renders Arabic empty state message", () => {
      setupSWR([]);
      render(<ProductList role="market_manager" marketId="market-tn" />);
      expect(screen.getByText("لا توجد منتجات")).toBeInTheDocument();
    });
  });

  describe("i18n — RTL table headers", () => {
    it("uses textAlign 'start' (not 'left') for table headers", () => {
      render(<ProductList role="market_manager" marketId="market-tn" />);
      const th = screen.getByText("Produit").closest("th");
      const style = th?.getAttribute("style") ?? "";
      expect(style).toContain("text-align: start");
      expect(style).not.toContain("text-align: left");
    });
  });
});
