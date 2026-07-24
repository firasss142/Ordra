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
