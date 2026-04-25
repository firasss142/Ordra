import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarehouseTabBar } from "../WarehouseTabBar";
import { Package } from "lucide-react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/fr/warehouse/preparation",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("swr", () => ({ preload: vi.fn() }));

const tabs = [
  { href: "/fr/warehouse/preparation", label: "Préparation", icon: Package, prefetchKey: "/api/warehouse/to-label" },
  { href: "/fr/warehouse/returns", label: "Retours", icon: Package, prefetchKey: "/api/warehouse/returns" },
  { href: "/fr/warehouse/history", label: "Historique", icon: Package, prefetchKey: "/api/warehouse/history" },
];

describe("WarehouseTabBar", () => {
  it("renders all tab labels", () => {
    render(<WarehouseTabBar tabs={tabs} direction="ltr" />);
    expect(screen.getByText("Préparation")).toBeInTheDocument();
    expect(screen.getByText("Retours")).toBeInTheDocument();
    expect(screen.getByText("Historique")).toBeInTheDocument();
  });

  it("marks the active tab via aria-current=page", () => {
    render(<WarehouseTabBar tabs={tabs} direction="ltr" />);
    const active = screen.getByRole("link", { name: /préparation/i });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("does not mark inactive tabs as current", () => {
    render(<WarehouseTabBar tabs={tabs} direction="ltr" />);
    const other = screen.getByRole("link", { name: /retours/i });
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("renders one link per tab", () => {
    render(<WarehouseTabBar tabs={tabs} direction="ltr" />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("uses no hardcoded hex colors in classNames", () => {
    const { container } = render(<WarehouseTabBar tabs={tabs} direction="ltr" />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/#1A1A1A|#E1E3E5|#6D7175/);
  });
});
