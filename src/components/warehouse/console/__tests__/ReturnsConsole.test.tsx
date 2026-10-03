import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { ReturnsConsole } from "../ReturnsConsole";
import type { ReturnsPayload } from "@/app/api/warehouse/returns/returns-data";
import { atDarb, onTheWay, processed } from "../../returns/__tests__/fixtures";

/**
 * « Rentrer » on the desk — prototype C.returns.
 *
 * Three stacked sections for the building the top bar chose: what Darb holds
 * for us (a table, each row with « Relivrer au client » and « Recevoir… »),
 * what is still on the road (greyed, inert) and what was decided in the last
 * seven days. No KPI tiles, no decision panel, no scan field — the top bar owns
 * scanning on the desk.
 */
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

let params = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/fr/warehouse/returns",
  useSearchParams: () => params,
}));

let pageData: ReturnsPayload | undefined;
let pageError: Error | undefined;
const mutate = vi.fn();
const swrKeys: string[] = [];
vi.mock("swr", () => ({
  default: (key: string) => {
    swrKeys.push(key);
    return { data: pageData, error: pageError, isLoading: false, mutate };
  },
}));

const souad = atDarb("o-souad", { hoursAtDarb: 96, customer_name: "Souad Mabrouk", customer_city: "Tobrouk" });
const mounir = atDarb("o-mounir", {
  hoursAtDarb: 25,
  customer_name: "Mounir",
  customer_city: "Zawiya",
  product_name: "Sac de frappe · petit",
  darb_reason: "no_answer",
});

function payload(over: Partial<ReturnsPayload> = {}): ReturnsPayload {
  return {
    orders: [mounir, souad],
    nextCursor: null,
    onTheWay: [onTheWay("w-1"), onTheWay("w-2", { customer_city: "Misrata" }), onTheWay("w-3", { customer_city: "Benghazi" })],
    processed: [],
    ...over,
  };
}

function show(p: ReturnsPayload | null = payload(), warehouseId: string | null = null) {
  pageData = p ?? undefined;
  return render(<ReturnsConsole marketId="m-ly" warehouseId={warehouseId} />);
}

/** A label whose count sits in its own isolated span. */
function label(text: string) {
  return screen.getByText(
    (_, el) => el?.textContent === text && Array.from(el.children).every((c) => c.textContent !== text),
  );
}

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  params = new URLSearchParams();
  pageError = undefined;
  replace.mockClear();
  mutate.mockClear();
  swrKeys.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReturnsConsole — the page", () => {
  it("opens with the title and Darb's rule, and nothing the prototype does not draw", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Rentrer" })).toBeInTheDocument();
    expect(screen.getByText("Un colis n'est reçu qu'une fois enregistré en retour par Darb.")).toBeInTheDocument();
    // No KPI tiles, no scan field, no decision panel.
    expect(screen.queryByTestId(/wh-kpi-/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Décision")).toBeNull();
  });

  it("reads the building the top bar chose", () => {
    show(payload(), "w-ben");
    expect(swrKeys.at(-1)).toContain("warehouse_id=w-ben");
    cleanup();
    swrKeys.length = 0;
    show(payload(), null);
    expect(swrKeys.at(-1)).not.toContain("warehouse_id");
  });

  it("shows a placeholder while the list is in flight, not an empty verdict", () => {
    show(null);
    expect(screen.getByTestId("wh-returns-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/Chez Darb pour nous/)).toBeNull();
  });

  it("a failed load names itself and offers a retry", () => {
    pageError = new Error("500");
    show(null);
    expect(screen.queryByTestId("wh-returns-skeleton")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger les retours.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(mutate).toHaveBeenCalled();
  });
});

describe("ReturnsConsole — Chez Darb pour nous", () => {
  it("counts the receivable parcels and heads the table with the prototype's columns", () => {
    show();
    expect(label("Chez Darb pour nous · 2")).toBeInTheDocument();
    const table = screen.getByTestId("wh-returns-atdarb");
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Colis", "Client", "Motif Darb", "Chez Darb depuis", "Bâtiment", ""]);
  });

  it("lists the longest-held first, each row carrying product, tracking, client, reason, age and building", () => {
    show();
    const rows = screen.getAllByTestId("wh-return-row");
    expect(rows).toHaveLength(2);
    const first = rows[0];
    expect(first).toHaveTextContent("مصحف القرآن تدبر وعمل");
    expect(first).toHaveTextContent("×1");
    expect(first).toHaveTextContent("SHo-souad");
    expect(first).toHaveTextContent("Souad Mabrouk · Tobrouk");
    expect(first).toHaveTextContent("Refusé par le client");
    expect(first).toHaveTextContent("بنغازي");
    expect(rows[1]).toHaveTextContent("Client injoignable");
  });

  it("flags more than two days at Darb with an amber chip, and leaves a day plain", () => {
    show();
    const [late, fresh] = screen.getAllByTestId("wh-return-row");
    expect(within(late).getByText("4 j").closest("[data-tone]")).toHaveAttribute("data-tone", "warn");
    expect(within(fresh).getByText("1 j").closest("[data-tone]")).toBeNull();
  });

  it("says plainly when Darb holds nothing for us", () => {
    show(payload({ orders: [] }));
    expect(label("Chez Darb pour nous · 0")).toBeInTheDocument();
    expect(screen.getByText("Rien chez Darb pour nous.")).toBeInTheDocument();
  });
});

describe("ReturnsConsole — Recevoir… (the verdict)", () => {
  it("opens the parcel's verdict with two equal choices", () => {
    show();
    fireEvent.click(within(screen.getAllByTestId("wh-return-row")[0]).getByRole("button", { name: "Recevoir…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("SHo-souad");
    expect(within(dialog).getByRole("button", { name: /Intact/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Abîmé/ })).toBeInTheDocument();
  });

  it("restocks through scan_return_in, then refreshes, closes and says so", async () => {
    show();
    fireEvent.click(within(screen.getAllByTestId("wh-return-row")[0]).getByRole("button", { name: "Recevoir…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Intact/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe("/api/warehouse/scan-return");
    expect(JSON.parse(init.body)).toMatchObject({ order_id: "o-souad", is_damaged: false });
    expect(mutate).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Reçu · en stock +1");
  });

  it("will not write off a parcel without a cause", async () => {
    show();
    fireEvent.click(within(screen.getAllByTestId("wh-return-row")[0]).getByRole("button", { name: "Recevoir…" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Abîmé/ }));
    const record = within(dialog).getByRole("button", { name: "Enregistrer comme abîmé" });
    expect(record).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Dommage transporteur" }));
    expect(record).not.toBeDisabled();
    fireEvent.click(record);
    await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
    expect(JSON.parse(fetchMock().mock.calls[0][1].body)).toMatchObject({
      is_damaged: true,
      return_reason: "carrier_damage",
    });
  });

  it("closes without recording anything", () => {
    show();
    fireEvent.click(within(screen.getAllByTestId("wh-return-row")[0]).getByRole("button", { name: "Recevoir…" }));
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("?order= opens that parcel's verdict, so a scan can land on it", () => {
    params = new URLSearchParams("order=o-mounir&warehouse_id=w-ben");
    show();
    expect(screen.getByRole("dialog")).toHaveTextContent("SHo-mounir");
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    // Closing drops the order and keeps the building.
    expect(replace).toHaveBeenCalledWith("/fr/warehouse/returns?warehouse_id=w-ben");
  });
});

describe("ReturnsConsole — Relivrer au client", () => {
  it("asks once more, then sends the parcel to scan_received_in — never to the restock path", async () => {
    show();
    const row = screen.getAllByTestId("wh-return-row")[0];
    fireEvent.click(within(row).getByRole("button", { name: "Relivrer au client" }));
    // A parcel back on the road is not undone by a click: the first press asks.
    expect(fetchMock()).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Confirmer la relivraison" }));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe("/api/warehouse/scan-received");
    expect(JSON.parse(init.body)).toEqual({ order_id: "o-souad" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Relivraison enregistrée"));
    expect(mutate).toHaveBeenCalled();
  });

  it("says why when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: "not to_be_returned" }) }));
    show();
    const row = screen.getAllByTestId("wh-return-row")[0];
    fireEvent.click(within(row).getByRole("button", { name: "Relivrer au client" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirmer la relivraison" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not to_be_returned"));
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("ReturnsConsole — En route", () => {
  it("greys what is still on the road, and none of it can be acted on", () => {
    show();
    expect(label("En route — pas encore recevables · 3")).toBeInTheDocument();
    const rows = screen.getAllByTestId("wh-return-onway");
    expect(rows).toHaveLength(3);
    rows.forEach((r) => expect(within(r).queryByRole("button")).toBeNull());
    expect(rows[1]).toHaveTextContent("Misrata");
  });

  it("hides the road section when nothing is on the way", () => {
    show(payload({ onTheWay: [] }));
    expect(screen.queryByText(/En route/)).toBeNull();
  });
});

describe("ReturnsConsole — Traités, 7 derniers jours", () => {
  it("says so when nothing was decided this week", () => {
    show();
    expect(screen.getByText("Traités — 7 derniers jours")).toBeInTheDocument();
    expect(screen.getByText("Aucun retour traité cette semaine.")).toBeInTheDocument();
  });

  it("lists each decision with its outcome", () => {
    show(
      payload({
        processed: [
          processed("p-1"),
          processed("p-2", { outcome: "damaged", return_reason: "packaging" }),
          processed("p-3", { outcome: "redelivered" }),
        ],
      }),
    );
    const rows = screen.getAllByTestId("wh-return-processed");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Intact · en stock");
    expect(rows[1]).toHaveTextContent("Abîmé · Emballage");
    expect(rows[2]).toHaveTextContent("Relivré");
    expect(screen.queryByText("Aucun retour traité cette semaine.")).toBeNull();
  });
});
