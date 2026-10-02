import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import { CountRun } from "../CountRun";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * The count run — « Compter », the fourth job of the day.
 *
 * Not one product had ever been counted on 2026-10-02. The run takes the agent
 * through the catalogue one product per screen, never-counted first, the
 * number typed with the delta shown live, the reason pre-filled. A first count
 * of seven products should take minutes.
 */

const row = (over: Partial<WarehouseStockRow>): WarehouseStockRow => ({
  product_id: "p", name: "x", sku: null, image_url: null, current_stock: 0, low_stock_threshold: 0,
  stock_goal: null, goal_pct: null, damaged_return_count: 0, engaged: 0, free: 0,
  last_counted_at: null, accuracy: null, series: [], sites: [], unallocated: 0, incoming: null,
  ...over,
});

let stock: WarehouseStockRow[] = [];
let sites: WarehouseSitesResponse = { sites: [], mine: null, pinned: false, unassigned: false };
const mutate = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key.startsWith("/api/warehouse/sites") ? sites : { rows: stock },
    error: undefined,
    isLoading: false,
    mutate,
  }),
}));

const BENGHAZI = { id: "B", code: "benghazi", name: "Benghazi", isDefault: false };
const TRIPOLI = { id: "T", code: "tripoli", name: "Tripoli", isDefault: true };

function renderRun() {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <CountRun locale="fr" />
    </NextIntlClientProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stock = [
    row({ product_id: "counted", name: "Mushaf Tahajjud", current_stock: 216, last_counted_at: "2026-09-01T10:00:00Z",
          sites: [{ warehouse_id: "B", code: "benghazi", name: "Benghazi", current_stock: 216, last_counted_at: "2026-09-01T10:00:00Z" }] }),
    row({ product_id: "never", name: "Coran Tadabbur", current_stock: 943 }),
  ];
  sites = { sites: [TRIPOLI, BENGHAZI], mine: "B", pinned: true, unassigned: false };
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stock_after: 943 }) });
  vi.stubGlobal("fetch", fetchMock);
  mutate.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("CountRun", () => {
  it("starts with what has never been counted, one product per screen", () => {
    renderRun();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Coran Tadabbur");
    expect(screen.getByTestId("count-progress")).toHaveTextContent("1 / 2");
  });

  it("counts the agent's own building, with the reason already written", async () => {
    renderRun();
    fireEvent.change(screen.getByLabelText("Combien en comptez-vous sur l'étagère ?"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et suivant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/warehouse/stock/count");
    expect(JSON.parse(init.body)).toEqual({
      product_id: "never",
      counted_qty: 900,
      note: "Comptage d'inventaire",
      warehouse_id: "B",
    });
  });

  it("moves on to the next product after a save", async () => {
    renderRun();
    fireEvent.change(screen.getByLabelText("Combien en comptez-vous sur l'étagère ?"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et suivant" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Mushaf Tahajjud"));
  });

  it("lets a product be skipped without recording anything", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Mushaf Tahajjud");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says a first count is a first count, not a gap against zero", () => {
    renderRun();
    fireEvent.change(screen.getByLabelText("Combien en comptez-vous sur l'étagère ?"), { target: { value: "900" } });
    expect(screen.getByTestId("count-delta")).toHaveTextContent("Premier comptage de ce bâtiment");
  });

  it("shows the gap against this building's last count, live", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));
    fireEvent.change(screen.getByLabelText("Combien en comptez-vous sur l'étagère ?"), { target: { value: "212" } });
    expect(screen.getByTestId("count-delta")).toHaveTextContent("−4");
  });

  it("ends with what was done and a way back", async () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));
    expect(screen.getByText("Comptage terminé")).toBeInTheDocument();
    expect(screen.getByText("0 compté · 2 passés")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour au stock" })).toHaveAttribute("href", "/fr/warehouse/stock");
  });

  it("lets a manager choose which building is being counted", async () => {
    sites = { sites: [TRIPOLI, BENGHAZI], mine: null, pinned: false, unassigned: false };
    renderRun();
    fireEvent.change(screen.getByLabelText("Bâtiment"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Combien en comptez-vous sur l'étagère ?"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et suivant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).warehouse_id).toBe("T");
  });

  it("does not offer a building an agent cannot count", () => {
    renderRun();
    expect(screen.queryByLabelText("Bâtiment")).toBeNull();
  });

  it("counts a single product when opened from that product", () => {
    // « Compter » on a stock row or a product page opens the run on that one
    // product: one way to count, with the same first-count rule everywhere.
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <CountRun locale="fr" productId="counted" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Mushaf Tahajjud");
    expect(screen.getByTestId("count-progress")).toHaveTextContent("1 / 1");
  });

  it("opens on the building named in the address, for a manager", async () => {
    sites = { sites: [TRIPOLI, BENGHAZI], mine: null, pinned: false, unassigned: false };
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <CountRun locale="fr" initialSiteId="B" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText("Bâtiment")).toHaveValue("B");
  });

  it("keeps the product on screen and says so when the save fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Stock insuffisant" }) });
    renderRun();
    fireEvent.change(screen.getByLabelText("Combien en comptez-vous sur l'étagère ?"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et suivant" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Coran Tadabbur");
  });
});
