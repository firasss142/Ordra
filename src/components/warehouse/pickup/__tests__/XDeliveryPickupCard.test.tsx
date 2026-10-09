import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { XDeliveryPickupSite } from "@/lib/carriers/xdelivery/pickup-view";
import { XDeliveryPickupCard } from "../XDeliveryPickupCard";

/**
 * The minimal « Demande d'enlèvement » card (2026-10-08): pickup is a button now, not
 * an automatic request behind a switch. The full screens come from the UI session.
 */

let payload: { sites: XDeliveryPickupSite[] } | undefined;
const mutate = vi.fn();
vi.mock("swr", () => ({
  default: () => ({ data: payload, isLoading: false, mutate }),
}));

const parcel = (orderId: string) => ({ orderId, tracking: "611791217700001", city: "Sousse", product: "Pantalon", quantity: 1 });

function site(over: Partial<XDeliveryPickupSite> = {}): XDeliveryPickupSite {
  return {
    warehouseId: "w-tunis",
    code: "tunis",
    name: "Tunis",
    carrierId: "xd-1",
    canManage: true,
    hasPortalLogin: true,
    awaiting: [parcel("o1"), parcel("o2"), parcel("o3")],
    lists: [],
    undone: [],
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
  it("renders nothing where no building ships X-Delivery", () => {
    payload = { sites: [] };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many scanned parcels wait, and the button sends them all as one list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requested: [], skipped: [], manifestId: "row-1" })));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();
    const card = screen.getByTestId("xd-pickup-tunis");
    expect(within(card).getByText("3 colis scannés attendent l'enlèvement")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Demande d'enlèvement · 3 colis" }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/warehouse/xdelivery-pickup");
    expect(JSON.parse(init.body)).toEqual({ warehouse_id: "w-tunis", order_ids: ["o1", "o2", "o3"] });
  });

  it("nothing waiting: the button cannot be pressed", () => {
    payload = { sites: [site({ awaiting: [] })] };
    renderCard();
    expect(screen.getByRole("button", { name: "Demande d'enlèvement · 0 colis" })).toBeDisabled();
  });

  it("an agent of another building sees the count but cannot send", () => {
    payload = { sites: [site({ canManage: false })] };
    renderCard();
    expect(screen.getByRole("button", { name: /Demande d'enlèvement/ })).toBeDisabled();
  });

  it("without the portal login, says where to enter it instead of a dead button", () => {
    payload = { sites: [site({ hasPortalLogin: false })] };
    renderCard();
    expect(screen.queryByRole("button", { name: /Demande d'enlèvement/ })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Connexions › Transporteurs");
  });

  it("the last list sent says when, in Tunis time", () => {
    payload = {
      sites: [
        site({
          lists: [
            { id: "row-1", createdAt: "2026-10-08T09:05:00Z", requestedFromOrdra: true, collected: false, carrierStatus: "PENDING", open: 5, lines: [] },
          ],
        }),
      ],
    };
    renderCard();
    expect(screen.getByTestId("xd-pickup-last")).toHaveTextContent("Liste envoyée 10:05 · 5 colis");
  });

  it("a refused portal login is named, other failures say to retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_code: "PORTAL_LOGIN_REFUSED" }), { status: 502 })),
    );
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Demande d'enlèvement/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connexion au portail X-Delivery refusée");
  });

  it("lists the waiting parcels by their X-Delivery number", () => {
    renderCard();
    expect(screen.getAllByTestId("xd-pickup-parcel")).toHaveLength(3);
    expect(screen.getAllByText("Colis 6117 9121 7700 001")).toHaveLength(3);
  });
});
