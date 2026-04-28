import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ProductsFilterBar, type ProductFilterMode } from "./ProductsFilterBar";

function renderBar(overrides: Partial<React.ComponentProps<typeof ProductsFilterBar>> = {}) {
  const defaults: React.ComponentProps<typeof ProductsFilterBar> = {
    marketLabel: "Tunisie",
    mode: "catalogue" as ProductFilterMode,
    onModeChange: vi.fn(),
    status: "all",
    onStatusChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    selectedCount: 0,
    onBulkActivate: vi.fn(),
    onBulkDeactivate: vi.fn(),
    onBulkClear: vi.fn(),
    canManage: true,
    canViewPerformance: true,
  };
  return render(<ProductsFilterBar {...defaults} {...overrides} />);
}

describe("ProductsFilterBar", () => {
  it("renders mode toggle with Catalogue and Performance options", () => {
    renderBar();
    expect(screen.getByRole("tab", { name: "Catalogue" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Performance" })).toBeInTheDocument();
  });

  it("calls onModeChange when switching to Performance", async () => {
    const onModeChange = vi.fn();
    renderBar({ onModeChange });
    await userEvent.click(screen.getByRole("tab", { name: "Performance" }));
    expect(onModeChange).toHaveBeenCalledWith("performance");
  });

  it("calls onModeChange when switching to Catalogue", async () => {
    const onModeChange = vi.fn();
    renderBar({ mode: "performance", onModeChange });
    await userEvent.click(screen.getByRole("tab", { name: "Catalogue" }));
    expect(onModeChange).toHaveBeenCalledWith("catalogue");
  });

  it("renders all status pills", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Tous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actifs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stock bas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Perdant de l'argent" })).toBeInTheDocument();
  });

  it("calls onStatusChange when status pill is clicked", async () => {
    const onStatusChange = vi.fn();
    renderBar({ onStatusChange });
    await userEvent.click(screen.getByRole("button", { name: "Actifs" }));
    expect(onStatusChange).toHaveBeenCalledWith("active");
  });

  it("renders search input", () => {
    renderBar();
    expect(screen.getByPlaceholderText("Rechercher un produit…")).toBeInTheDocument();
  });

  it("calls onSearchChange when user types in search", async () => {
    const onSearchChange = vi.fn();
    renderBar({ onSearchChange });
    const input = screen.getByPlaceholderText("Rechercher un produit…");
    await userEvent.type(input, "sport");
    expect(onSearchChange).toHaveBeenCalled();
  });

  it("does not show bulk action buttons when selectedCount is 0", () => {
    renderBar({ selectedCount: 0 });
    expect(screen.queryByRole("button", { name: "Activer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Désactiver" })).not.toBeInTheDocument();
  });

  it("shows bulk action buttons when selectedCount > 0", () => {
    renderBar({ selectedCount: 3 });
    expect(screen.getByRole("button", { name: "Activer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Désactiver" })).toBeInTheDocument();
  });

  it("calls onBulkActivate when Activer is clicked", async () => {
    const onBulkActivate = vi.fn();
    renderBar({ selectedCount: 2, onBulkActivate });
    await userEvent.click(screen.getByRole("button", { name: "Activer" }));
    expect(onBulkActivate).toHaveBeenCalled();
  });

  it("calls onBulkDeactivate when Désactiver is clicked", async () => {
    const onBulkDeactivate = vi.fn();
    renderBar({ selectedCount: 2, onBulkDeactivate });
    await userEvent.click(screen.getByRole("button", { name: "Désactiver" }));
    expect(onBulkDeactivate).toHaveBeenCalled();
  });

  it("renders the market label as a read-only chip (sidebar is the only writer)", () => {
    renderBar({ marketLabel: "Libye" });
    const chip = screen.getByText("Libye");
    expect(chip.closest("button")).toBeNull();
  });

  it("hides add-product link when canManage is false", () => {
    renderBar({ canManage: false });
    expect(screen.queryByRole("link", { name: /Ajouter un produit/ })).not.toBeInTheDocument();
  });

  it("shows add-product link when canManage is true", () => {
    renderBar({ canManage: true });
    expect(screen.getByRole("link", { name: /Ajouter un produit/ })).toBeInTheDocument();
  });

  it("hides mode toggle when canViewPerformance is false", () => {
    renderBar({ canViewPerformance: false });
    expect(screen.queryByRole("tab", { name: "Performance" })).not.toBeInTheDocument();
  });
});
