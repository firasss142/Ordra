import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import { StockConsole } from "../StockConsole";

/**
 * Entrepôt › Stock — three depths of one question, addressable.
 *
 * The tab used to be local state, so nothing could link to Réceptions or to
 * one product's movements: « Recevoir » on Aujourd'hui and « Mouvements » on a
 * stock row both landed on the wrong tab. The tab and the product now live in
 * the address.
 */

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => "/fr/warehouse/stock",
}));

vi.mock("../WarehouseStockClient", () => ({ WarehouseStockClient: () => <div data-testid="levels" /> }));
vi.mock("@/components/warehouse/receptions/ReceptionsConsole", () => ({
  ReceptionsConsole: () => <div data-testid="receptions" />,
}));
vi.mock("../JournalConsole", () => ({
  JournalConsole: ({ productId }: { productId?: string | null }) => (
    <div data-testid="journal" data-product={productId ?? ""} />
  ),
}));

function renderConsole(role: "market_manager" | "warehouse_agent" | "agent" = "market_manager") {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <StockConsole locale="fr" role={role} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { search = ""; replace.mockClear(); });
afterEach(cleanup);

describe("StockConsole", () => {
  it("opens on the levels", () => {
    renderConsole();
    expect(screen.getByTestId("levels")).toBeInTheDocument();
  });

  it("opens the tab the address names — « Recevoir » lands on Réceptions", () => {
    search = "tab=receptions";
    renderConsole();
    expect(screen.getByTestId("receptions")).toBeInTheDocument();
  });

  it("opens one product's movements from the address", () => {
    search = "tab=journal&product=p1";
    renderConsole();
    expect(screen.getByTestId("journal")).toHaveAttribute("data-product", "p1");
  });

  it("writes the chosen tab into the address, so it can be shared and reloaded", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("tab", { name: /Réceptions/ }));
    expect(replace).toHaveBeenCalledWith("/fr/warehouse/stock?tab=receptions", { scroll: false });
  });

  it("falls back to the levels when the address names a tab the role cannot see", () => {
    search = "tab=receptions";
    renderConsole("agent");
    expect(screen.getByTestId("levels")).toBeInTheDocument();
  });
});
