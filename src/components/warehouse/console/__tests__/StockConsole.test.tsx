import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import { StockConsole } from "../StockConsole";

/**
 * Entrepôt › Stock — three depths of one question, addressable.
 *
 * On the desk: « Stock », then the soft tabs Niveaux | Réceptions | Mouvements
 * (`C.stock`, `.tabs`), the tab in the address. On the phone: no tabs at all
 * (`R.stock`), but the address still opens Réceptions — « Recevoir » on
 * Aujourd'hui links there — and one product's movements.
 */

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => "/fr/warehouse/stock",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("../WarehouseStockClient", () => ({
  WarehouseStockClient: ({ variant, siteId }: { variant: string; siteId: string | null }) => (
    <div data-testid="levels" data-variant={variant} data-site={siteId ?? ""} />
  ),
}));
vi.mock("@/components/warehouse/receptions/ReceptionsConsole", () => ({
  ReceptionsConsole: () => <div data-testid="receptions" />,
}));
vi.mock("../JournalConsole", () => ({
  JournalConsole: ({ productId, kind }: { productId?: string | null; kind?: string }) => (
    <div data-testid="journal" data-product={productId ?? ""} data-kind={kind ?? ""} />
  ),
}));

type Role = "market_manager" | "warehouse_agent" | "agent";
function renderConsole(role: Role = "market_manager", siteId: string | null = null) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <StockConsole
        locale="fr"
        role={role}
        variant={role === "warehouse_agent" ? "agent" : "desk"}
        siteId={siteId}
        eyebrow={role === "warehouse_agent" ? "Benghazi · jeudi 2 octobre" : null}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { search = ""; replace.mockClear(); });
afterEach(cleanup);

describe("StockConsole — desk", () => {
  it("opens on the levels under the title « Stock »", () => {
    renderConsole();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stock");
    expect(screen.getByTestId("levels")).toHaveAttribute("data-variant", "desk");
  });

  it("offers the three soft tabs, in the prototype's order", () => {
    renderConsole();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Niveaux", "Réceptions", "Mouvements"]);
    expect(screen.getByRole("tab", { name: "Niveaux" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the tab the address names — « Recevoir » lands on Réceptions", () => {
    search = "tab=receptions";
    renderConsole();
    expect(screen.getByTestId("receptions")).toBeInTheDocument();
  });

  it("opens one product's movements, and the family, from the address", () => {
    search = "tab=journal&product=p1&kind=scan";
    renderConsole();
    expect(screen.getByTestId("journal")).toHaveAttribute("data-product", "p1");
    expect(screen.getByTestId("journal")).toHaveAttribute("data-kind", "scan");
  });

  it("writes the chosen tab into the address, so it can be shared and reloaded", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("tab", { name: /Réceptions/ }));
    expect(replace).toHaveBeenCalledWith("/fr/warehouse/stock?tab=receptions", { scroll: false });
  });

  it("keeps the building the top bar chose when the tab changes", () => {
    search = "warehouse_id=B";
    renderConsole("market_manager", "B");
    fireEvent.click(screen.getByRole("tab", { name: "Mouvements" }));
    expect(replace).toHaveBeenCalledWith("/fr/warehouse/stock?warehouse_id=B&tab=journal", { scroll: false });
  });

  it("hands the building in view to the levels", () => {
    renderConsole("market_manager", "B");
    expect(screen.getByTestId("levels")).toHaveAttribute("data-site", "B");
  });

  it("falls back to the levels when the address names a tab the role cannot see", () => {
    search = "tab=receptions";
    renderConsole("agent");
    expect(screen.getByTestId("levels")).toBeInTheDocument();
  });
});

describe("StockConsole — phone", () => {
  it("shows the levels with no tabs", () => {
    renderConsole("warehouse_agent", "B");
    expect(screen.getByTestId("levels")).toHaveAttribute("data-variant", "agent");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("still opens Réceptions from the address", () => {
    search = "tab=receptions";
    renderConsole("warehouse_agent", "B");
    expect(screen.getByTestId("receptions")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens one product's movements, with the way back to that product", () => {
    search = "tab=journal&product=p1";
    renderConsole("warehouse_agent", "B");
    expect(screen.getByTestId("journal")).toHaveAttribute("data-product", "p1");
    expect(screen.getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/fr/warehouse/stock/p1");
  });
});
