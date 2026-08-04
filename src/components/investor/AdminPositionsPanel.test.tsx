import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AdminPositionsPanel } from "./AdminPositionsPanel";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
  mutate: vi.fn(),
}));

const MARKETS = [
  { id: "m-ly", code: "ly", name: "Libya" },
  { id: "m-tn", code: "tn", name: "Tunisia" },
];

const PRODUCTS = [
  { id: "prod-1", name: "Biovera", market_id: "m-tn" },
  { id: "prod-2", name: "Autre LY", market_id: "m-ly" },
];

const INVESTORS = [
  { id: "u-1", legal_name: "Ilyes Capital SARL", full_name: "ilyes", configured: true },
];

const position = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  investor_id: "u-1",
  product_id: "prod-1",
  market_id: "m-tn",
  amount: 20000,
  effective_from: "2026-03-01",
  effective_to: null,
  status: "active",
  products: { name: "Biovera", image_url: null },
  investors: { legal_name: "Ilyes Capital SARL" },
  ...over,
});

function mount(
  positions: ReturnType<typeof position>[],
  positionsState: { error?: unknown; isLoading?: boolean } = {}
) {
  const mutatePositions = vi.fn();
  mockUseSWR.mockImplementation((key: string) => {
    if (key === "/api/admin/investments") {
      return {
        data: { data: positions },
        error: positionsState.error,
        isLoading: positionsState.isLoading ?? false,
        mutate: mutatePositions,
      };
    }
    if (key === "/api/admin/investments/investors") {
      return { data: { data: INVESTORS }, error: undefined, isLoading: false };
    }
    if (typeof key === "string" && key.startsWith("/api/products")) {
      return { data: { data: PRODUCTS }, error: undefined, isLoading: false };
    }
    return { data: undefined };
  });
  return {
    ...render(<AdminPositionsPanel markets={MARKETS} locale="fr" />),
    mutatePositions,
  };
}

beforeEach(() => {
  mockUseSWR.mockReset();
  vi.restoreAllMocks();
});

/**
 * Capital was formatted with the market selected in the period-close form,
 * which defaults to markets[0]. A Tunisian position therefore rendered as
 * Libyan dinars — "‏20.000,000 د.ل.‏" for 20 000,000 DT — and changing an
 * unrelated dropdown silently re-denominated every row.
 */
describe("AdminPositionsPanel — capital currency", () => {
  test("uses each position's own market, not the period-close selector", () => {
    mount([
      position({ id: "p-tn", market_id: "m-tn", amount: 20000 }),
      position({
        id: "p-ly",
        market_id: "m-ly",
        amount: 30000,
        products: { name: "Autre", image_url: null },
      }),
    ]);

    const rows = screen.getAllByRole("row").slice(1);
    const tnRow = rows.find((r) => within(r).queryByText("Biovera"))!;
    const lyRow = rows.find((r) => within(r).queryByText("Autre"))!;

    expect(tnRow).toHaveTextContent("DT");
    expect(tnRow).not.toHaveTextContent("د.ل");
    expect(lyRow).toHaveTextContent("د.ل");
  });

  /**
   * The settlement market selector now lives in a different panel entirely, so
   * it cannot reach these figures at all — the structural version of the fix.
   */
  test("carries no market selector that could re-denominate the table", () => {
    mount([position({ market_id: "m-tn", amount: 20000 })]);
    expect(screen.queryByLabelText("Marché")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("20 000,000 DT");
  });

  test("shows which market a position belongs to", () => {
    mount([position({ market_id: "m-tn" })]);
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Tunisia");
  });
});

describe("AdminPositionsPanel — opening a position", () => {
  test("creates an investor position", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    mount([]);

    fireEvent.click(screen.getByRole("button", { name: /Ouvrir une position/i }));
    fireEvent.change(screen.getByLabelText(/Détenteur/i), { target: { value: "u-1" } });
    fireEvent.change(screen.getByLabelText(/Produit/i), { target: { value: "prod-1" } });
    fireEvent.change(screen.getByLabelText(/Capital/i), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText(/Depuis/i), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/investments");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      investor_id: "u-1",
      product_id: "prod-1",
      amount: 20000,
      effective_from: "2026-03-01",
    });
  });

  /**
   * House capital is an investment_positions row with investor_id NULL. Without
   * it the pro-rata denominator counts only investor money and every share is
   * overstated.
   */
  test("records house capital as a null investor", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    mount([]);

    fireEvent.click(screen.getByRole("button", { name: /Ouvrir une position/i }));
    fireEvent.change(screen.getByLabelText(/Détenteur/i), { target: { value: "__house__" } });
    fireEvent.change(screen.getByLabelText(/Produit/i), { target: { value: "prod-1" } });
    fireEvent.change(screen.getByLabelText(/Capital/i), { target: { value: "30000" } });
    fireEvent.change(screen.getByLabelText(/Depuis/i), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).investor_id).toBeNull();
  });

  test("rejects a non-positive amount before calling the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount([]);

    fireEvent.click(screen.getByRole("button", { name: /Ouvrir une position/i }));
    fireEvent.change(screen.getByLabelText(/Produit/i), { target: { value: "prod-1" } });
    fireEvent.change(screen.getByLabelText(/Capital/i), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/Depuis/i), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("requires a product and a start date", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount([]);

    fireEvent.click(screen.getByRole("button", { name: /Ouvrir une position/i }));
    fireEvent.change(screen.getByLabelText(/Capital/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("AdminPositionsPanel — closing a position", () => {
  test("end-dates an active position", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    mount([position()]);

    fireEvent.click(screen.getByRole("button", { name: /Clôturer/i }));
    fireEvent.change(screen.getByLabelText(/Date de clôture/i), {
      target: { value: "2026-06-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Clôturer la position/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/investments/p-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ effective_to: "2026-06-30" });
  });

  test("offers no close action on an already closed position", () => {
    mount([position({ status: "closed", effective_to: "2026-05-01" })]);
    expect(screen.queryByRole("button", { name: /Clôturer/i })).not.toBeInTheDocument();
  });

  test("surfaces a rejected close", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "effective_to precedes effective_from" }), {
        status: 422,
      })
    );
    mount([position()]);

    fireEvent.click(screen.getByRole("button", { name: /Clôturer/i }));
    fireEvent.change(screen.getByLabelText(/Date de clôture/i), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Clôturer la position/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/precedes/i);
  });

  test("refreshes the table after closing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 })
    );
    const { mutatePositions } = mount([position()]);

    fireEvent.click(screen.getByRole("button", { name: /Clôturer/i }));
    fireEvent.change(screen.getByLabelText(/Date de clôture/i), {
      target: { value: "2026-06-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Clôturer la position/i }));

    await waitFor(() => expect(mutatePositions).toHaveBeenCalled());
  });
});
