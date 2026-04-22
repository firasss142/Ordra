import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductListItem } from "../ProductListItem";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

// Mock next-intl
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

const baseProduct = {
  id: "prod-1",
  name: "Crème Hydratante",
  unit_cogs: 12,
  packing_cost: 2.5,
  low_stock_threshold: 10,
  current_stock: 5,
  is_active: true,
  variant_count: 3,
};

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
}

beforeEach(() => {
  mockMessages = frMessages;
});

describe("ProductListItem", () => {
  it("renders product name", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.getByText("Crème Hydratante")).toBeInTheDocument();
  });

  it("renders variant count as plain number", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders current_stock as currency-less number", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders COGS with locale-aware currency format", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    // French locale: comma decimal separator
    expect(screen.getByText("12,00 TND")).toBeInTheDocument();
  });

  it("renders packing_cost with locale-aware currency format", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.getByText("2,50 TND")).toBeInTheDocument();
  });

  it("calls onToggleActive callback with product id when toggle is clicked", async () => {
    const onToggleActive = vi.fn();
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={onToggleActive}
      />
    );
    // For active product, the toggle action text
    const toggleBtn = screen.getByRole("button", { name: /désactiver|activer/i });
    await userEvent.click(toggleBtn);
    expect(onToggleActive).toHaveBeenCalledWith("prod-1");
  });

  it("'Modifier' link navigates to /[locale]/products/[id]", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    const link = screen.getByText("Modifier");
    expect(link.closest("a")).toHaveAttribute("href", "/fr/products/prod-1");
  });

  it("low stock badge has aria-label for accessibility", () => {
    renderInTable(
      <ProductListItem
        product={baseProduct}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    // prod has current_stock=5, low_stock_threshold=10 → low stock
    expect(screen.getByLabelText("Stock bas")).toBeInTheDocument();
  });

  it("does not show low stock badge when threshold is 0", () => {
    const productNoThreshold = { ...baseProduct, low_stock_threshold: 0 };
    renderInTable(
      <ProductListItem
        product={productNoThreshold}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Stock bas")).not.toBeInTheDocument();
  });

  it("does not show low stock badge when stock is above threshold", () => {
    const productHighStock = { ...baseProduct, current_stock: 50 };
    renderInTable(
      <ProductListItem
        product={productHighStock}
        locale="fr"
        currency="TND"
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Stock bas")).not.toBeInTheDocument();
  });

  describe("i18n — Arabic locale", () => {
    beforeEach(() => {
      mockMessages = arMessages;
    });

    it("renders Arabic low stock badge text", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="ar"
          currency="LYD"
          onToggleActive={vi.fn()}
        />
      );
      expect(screen.getByText("مخزون منخفض")).toBeInTheDocument();
    });

    it("renders Arabic edit link text", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="ar"
          currency="LYD"
          onToggleActive={vi.fn()}
        />
      );
      expect(screen.getByText("تعديل")).toBeInTheDocument();
    });

    it("renders Arabic deactivate button for active product", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="ar"
          currency="LYD"
          onToggleActive={vi.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: "تعطيل" })
      ).toBeInTheDocument();
    });

    it("renders Arabic activate button for inactive product", () => {
      const inactiveProduct = { ...baseProduct, is_active: false };
      renderInTable(
        <ProductListItem
          product={inactiveProduct}
          locale="ar"
          currency="LYD"
          onToggleActive={vi.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: "تفعيل" })
      ).toBeInTheDocument();
    });

    it("renders Arabic aria-label on low stock badge", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="ar"
          currency="LYD"
          onToggleActive={vi.fn()}
        />
      );
      expect(screen.getByLabelText("مخزون منخفض")).toBeInTheDocument();
    });
  });

  describe("i18n — RTL logical properties", () => {
    it("uses marginInlineStart (not marginLeft) on low stock badge", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="fr"
          currency="TND"
          onToggleActive={vi.fn()}
        />
      );
      const badge = screen.getByLabelText("Stock bas");
      const style = badge.getAttribute("style") ?? "";
      expect(style).toContain("margin-inline-start");
      expect(style).not.toContain("margin-left");
    });

    it("uses marginInlineEnd (not marginRight) on edit link", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="fr"
          currency="TND"
          onToggleActive={vi.fn()}
        />
      );
      const link = screen.getByText("Modifier");
      const style = link.getAttribute("style") ?? "";
      expect(style).toContain("margin-inline-end");
      expect(style).not.toContain("margin-right");
    });
  });

  describe("i18n — locale-aware currency", () => {
    it("uses comma decimal separator for French locale", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="fr"
          currency="TND"
          onToggleActive={vi.fn()}
        />
      );
      expect(screen.getByText("12,00 TND")).toBeInTheDocument();
    });

    it("formats Arabic locale currency correctly", () => {
      renderInTable(
        <ProductListItem
          product={baseProduct}
          locale="ar"
          currency="LYD"
          onToggleActive={vi.fn()}
        />
      );
      // Arabic locale should format with Arabic numerals or standard numerals
      // The key thing is the currency code changes to LYD
      expect(screen.getByText(/12.*LYD/)).toBeInTheDocument();
    });
  });
});
