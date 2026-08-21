import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarehouseTabBar } from "../WarehouseTabBar";
import { Package } from "lucide-react";

let pathnameMock = "/fr/warehouse/preparation";
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
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

describe("WarehouseTabBar — index tab", () => {
  afterEach(() => {
    pathnameMock = "/fr/warehouse/preparation";
  });

  it("marks an exact tab active only on its own path, not on children", () => {
    // `/fr/warehouse` is a prefix of every other warehouse route, so a plain
    // startsWith would light up "Aujourd'hui" on every page in the section.
    pathnameMock = "/fr/warehouse/preparation";
    render(
      <WarehouseTabBar
        tabs={[
          { href: "/fr/warehouse", label: "Aujourd'hui", icon: Package, exact: true },
          { href: "/fr/warehouse/preparation", label: "Préparation", icon: Package },
        ]}
        direction="ltr"
      />,
    );
    expect(screen.getByRole("link", { name: /Aujourd'hui/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Préparation/ })).toHaveAttribute("aria-current", "page");
  });

  it("marks the exact tab active on its own path", () => {
    pathnameMock = "/fr/warehouse";
    render(
      <WarehouseTabBar
        tabs={[{ href: "/fr/warehouse", label: "Aujourd'hui", icon: Package, exact: true }]}
        direction="ltr"
      />,
    );
    expect(screen.getByRole("link", { name: /Aujourd'hui/ })).toHaveAttribute("aria-current", "page");
  });
});
