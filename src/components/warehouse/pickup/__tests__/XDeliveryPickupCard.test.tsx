import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { XDeliveryPickupSite } from "@/lib/carriers/xdelivery/pickup-view";
import { XDeliveryPickupCard } from "../XDeliveryPickupCard";

/**
 * prototypes/xdelivery-v1.html, screens 1–2: the agent's « X-DELIVERY Enlèvement » card.
 */

let payload: { sites: XDeliveryPickupSite[] } | undefined;
const mutate = vi.fn();
vi.mock("swr", () => ({
  default: () => ({ data: payload, isLoading: false, mutate }),
}));

function site(over: Partial<XDeliveryPickupSite> = {}): XDeliveryPickupSite {
  return {
    warehouseId: "w-tunis",
    code: "tunis",
    name: "Tunis",
    disabled: false,
    disabledAt: null,
    canToggle: true,
    waiting: 3,
    // 14:20 in Tunis.
    lastRequest: { at: "2026-10-06T13:20:00Z", count: 4 },
    failure: null,
    parcels: [],
    ...over,
  };
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tunis">
      <XDeliveryPickupCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  payload = { sites: [site()] };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("XDeliveryPickupCard", () => {
  it("renders nothing where no site ships X-Delivery", () => {
    payload = { sites: [] };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("ON: says so, and what the next pass will ask for", () => {
    renderCard();
    const card = screen.getByTestId("xd-pickup-tunis");
    expect(within(card).getByText("Enlèvement")).toBeInTheDocument();
    expect(within(card).getByText("Demande automatique activée")).toBeInTheDocument();
    expect(within(card).getByRole("switch", { name: "Demande d'enlèvement" })).toHaveAttribute("aria-checked", "true");
    expect(within(card).getByTestId("xd-pickup-waiting")).toHaveTextContent("3");
    expect(within(card).getByTestId("xd-pickup-last")).toHaveTextContent("14:20");
    expect(within(card).getByTestId("xd-pickup-last")).toHaveTextContent("4 colis");
  });

  it("no request yet today says so instead of a blank", () => {
    payload = { sites: [site({ lastRequest: null })] };
    renderCard();
    expect(screen.getByTestId("xd-pickup-last")).toHaveTextContent("aucune demande aujourd'hui");
  });

  it("OFF: the time it was cut, the midnight reset, and the parcels left waiting", () => {
    payload = { sites: [site({ disabled: true, disabledAt: "2026-10-06T14:10:00Z" })] };
    renderCard();
    expect(screen.getByText("Coupé depuis 15:10")).toBeInTheDocument();
    expect(screen.getByText("Rien n'est demandé. Se rallume seul à minuit.")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("status")).toHaveTextContent("3 colis scannés attendent");
  });

  it("a press turns it OFF through the X-Delivery route, never Darb's", async () => {
    const fresh = { sites: [site({ disabled: true, disabledAt: "2026-10-06T14:10:00Z" })] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fresh });
    vi.stubGlobal("fetch", fetchMock);
    renderCard();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(fresh, { revalidate: false }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/warehouse/xdelivery-pickup",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ warehouse_id: "w-tunis", disabled: true }) }),
    );
  });

  it("the agent turns it back ON themselves", async () => {
    payload = { sites: [site({ disabled: true, disabledAt: "2026-10-06T14:10:00Z" })] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sites: [site()] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderCard();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ warehouse_id: "w-tunis", disabled: false });
  });

  it("a refused press says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    renderCard();
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByText("Action impossible. Réessayez.")).toBeInTheDocument();
  });

  it("someone who may not move it sees the state, not a live switch", () => {
    payload = { sites: [site({ canToggle: false })] };
    renderCard();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("a portal sign-in failure names where to fix it", () => {
    payload = { sites: [site({ failure: { kind: "login", at: "2026-10-06T13:20:00Z" } })] };
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent("Connexion au portail X-Delivery refusée");
    expect(screen.getByRole("alert")).toHaveTextContent("Connexions › Transporteurs");
  });

  it("lists the parcels: « À demander », or « Demandé » with the time", () => {
    payload = {
      sites: [
        site({
          parcels: [
            { orderId: "o1", tracking: "611791217700001", city: "Sousse", product: "Pantalon M", quantity: 1, requested: false, requestedAt: null },
            { orderId: "o2", tracking: "611791200300002", city: "Bizerte", product: "Chemise", quantity: 2, requested: true, requestedAt: "2026-10-06T13:20:00Z" },
          ],
        }),
      ],
    };
    renderCard();
    const rows = screen.getAllByTestId("xd-pickup-parcel");
    expect(rows[0]).toHaveTextContent("Colis 6117 9121 7700 001");
    expect(rows[0]).toHaveTextContent("Sousse · Pantalon M");
    expect(rows[0]).toHaveTextContent("À demander");
    expect(rows[1]).toHaveTextContent("Chemise ×2");
    expect(rows[1]).toHaveTextContent("Demandé 14:20");
  });

  it("without the list where the day's tiles must lead (« Aujourd'hui »)", () => {
    payload = {
      sites: [
        site({
          parcels: [
            { orderId: "o1", tracking: "611791217700001", city: "Sousse", product: "Robe", quantity: 1, requested: false, requestedAt: null },
          ],
        }),
      ],
    };
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tunis">
        <XDeliveryPickupCard withParcels={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("xd-pickup-tunis")).toBeInTheDocument();
    expect(screen.queryByTestId("xd-pickup-parcel")).toBeNull();
  });

  it("keeps the list short on the bench", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      orderId: `o${i}`,
      tracking: `61179121770000${i}`,
      city: "Tunis",
      product: "Robe",
      quantity: 1,
      requested: false,
      requestedAt: null,
    }));
    payload = { sites: [site({ parcels: many, waiting: 7 })] };
    renderCard();
    expect(screen.getAllByTestId("xd-pickup-parcel")).toHaveLength(4);
    expect(screen.getByText("+ 3 autres")).toBeInTheDocument();
  });
});
