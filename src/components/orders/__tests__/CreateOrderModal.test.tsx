import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { CreateOrderModal } from "../CreateOrderModal";

/** The sidebar scope switcher is the only source of the market now. */
const scopeState = { scope: "market" as "market" | "all", marketId: "m-ly" };
vi.mock("@/context/market-scope", () => ({
  useMarketScope: () => scopeState,
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    return Passthrough;
  },
}));

const MARKETS = [{ id: "m-ly", name: "Libya", code: "ly" }];
const PRODUCTS = [
  {
    id: "p1",
    name: "زيت زيتون بكر ممتاز",
    market_id: "m-ly",
    is_active: true,
    default_price: 25.5,
    image_url: null,
  },
  { id: "p2", name: "Biovera", market_id: "m-ly", is_active: true, default_price: 49, image_url: null },
];
const VARIANTS = [
  { id: "v1", product_id: "p1", label: "1 لتر", quantity: 1, display_price: 25.5, is_active: true },
  { id: "v2", product_id: "p1", label: "2 لتر", quantity: 2, display_price: 48, is_active: true },
];
const STATES = [
  { id: 80, name: "طرابلس" },
  { id: 81, name: "بنغازي" },
];

let customerLookup: unknown = null;
let postBody: Record<string, unknown> | null = null;

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST" && u === "/api/orders") {
      postBody = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ data: { id: "o-new" } }) } as Response;
    }
    if (u.startsWith("/api/markets")) return json({ data: MARKETS });
    if (u.startsWith("/api/products/search")) return json({ data: PRODUCTS });
    if (u.includes("/variants")) return json({ data: VARIANTS });
    if (u.startsWith("/api/dexpress/states")) return json({ states: STATES });
    if (u.startsWith("/api/customers/lookup")) return json({ data: customerLookup });
    return json({ data: [] });
  });
}

function json(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

function renderModal(props: Partial<React.ComponentProps<typeof CreateOrderModal>> = {}) {
  const onCreated = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CreateOrderModal
        isOpen
        onClose={vi.fn()}
        role="market_manager"
        userMarketId="m-ly"
        onCreated={onCreated}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onCreated };
}

describe("CreateOrderModal", () => {
  beforeEach(() => {
    scopeState.scope = "market";
    scopeState.marketId = "m-ly";
    customerLookup = null;
    postBody = null;
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("no longer asks for a market — the sidebar already answered that", async () => {
    renderModal();
    await screen.findByLabelText(/nom du client/i);
    // Two isolated markets and one scope switcher: a second control here could
    // only ever disagree with the page behind it.
    expect(screen.queryByLabelText(/^march/i)).toBeNull();
  });

  test("blocks creation when a super_admin is scoped to every market", async () => {
    scopeState.scope = "all";
    renderModal({ role: "super_admin" });

    expect(await screen.findByText(/choisissez un march/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /créer la commande/i })).toBeDisabled();
    // The form itself must not be reachable in that state.
    expect(screen.queryByLabelText(/nom du client/i)).toBeNull();
  });

  test("leads with the phone, prefixed by the market's dial code", async () => {
    renderModal();
    const phone = await screen.findByLabelText(/téléphone/i);
    expect(phone).toBeInTheDocument();
    expect(screen.getByText("+218")).toBeInTheDocument();
  });

  test("offers a known customer and fills the fields only when asked", async () => {
    const user = userEvent.setup();
    customerLookup = {
      phone: "915489053",
      name: "لطفي الصفح",
      city: "طرابلس",
      address: "شارع النصر",
      orderCount: 6,
      lastOrderAt: "2026-06-16T10:00:00Z",
    };
    renderModal();

    await user.type(await screen.findByLabelText(/téléphone/i), "915489053");

    const card = await screen.findByText(/client existant/i);
    expect(card).toHaveTextContent(/6 commandes/);

    // Nothing is written until the operator says so — on a live call, "is this
    // the same person" is their judgement.
    expect(screen.getByLabelText(/nom du client/i)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /utiliser ce client/i }));

    expect(screen.getByLabelText(/nom du client/i)).toHaveValue("لطفي الصفح");
    expect(screen.getByLabelText(/adresse/i)).toHaveValue("شارع النصر");
  });

  test("a variant sets the price but leaves the quantity alone", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole("button", { name: /choisir un produit/i }));
    await user.click(await screen.findByRole("option", { name: /زيت زيتون/ }));

    // Raise the quantity, then pick a variant: the quantity must survive it.
    await user.click(screen.getByRole("button", { name: /augmenter la quantité/i }));
    await user.click(screen.getByRole("button", { name: /augmenter la quantité/i }));
    expect(screen.getByRole("spinbutton", { name: /^quantité$/i })).toHaveValue(3);

    await user.click(await screen.findByRole("button", { name: "1 لتر" }));

    expect(screen.getByRole("spinbutton", { name: /^quantité$/i })).toHaveValue(3);
    // 3 × 25,500 — the figure the panel shows is the one that gets saved.
    expect(screen.getByText(/76[.,]500/)).toBeInTheDocument();
  });

  test("the total can be overridden, and says so", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole("button", { name: /choisir un produit/i }));
    await user.click(await screen.findByRole("option", { name: /Biovera/ }));

    await user.click(screen.getByRole("button", { name: /modifier le total/i }));
    const totalInput = screen.getByLabelText(/prix total/i);
    await user.clear(totalInput);
    await user.type(totalInput, "40");

    // A discount is stated on screen rather than left for someone to spot in
    // the numbers later.
    expect(screen.getByText(/total modifié/i)).toBeInTheDocument();
  });

  test("sends the typed quantity and only sends a total when it was overridden", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(await screen.findByLabelText(/téléphone/i), "915489053");
    await user.type(screen.getByLabelText(/nom du client/i), "لطفي");

    await user.click(screen.getByRole("button", { name: /rechercher une ville/i }));
    await user.click(await screen.findByRole("option", { name: /طرابلس/ }));

    await user.type(screen.getByLabelText(/adresse/i), "شارع النصر");

    await user.click(screen.getByRole("button", { name: /choisir un produit/i }));
    await user.click(await screen.findByRole("option", { name: /Biovera/ }));
    await user.click(screen.getByRole("button", { name: /augmenter la quantité/i }));

    await user.click(screen.getByRole("button", { name: /créer la commande/i }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      market_id: "m-ly",
      quantity: 2,
      customer_city: "طرابلس",
      dexpress_state_id: 80,
      customer_phone: "915489053",
    });
    // No override happened, so the server is left to compute the total.
    expect(postBody).not.toHaveProperty("total_price");
  });

  test("refuses to submit without a city", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(await screen.findByLabelText(/téléphone/i), "915489053");
    await user.type(screen.getByLabelText(/nom du client/i), "لطفي");
    await user.type(screen.getByLabelText(/adresse/i), "شارع النصر");
    await user.click(screen.getByRole("button", { name: /choisir un produit/i }));
    await user.click(await screen.findByRole("option", { name: /Biovera/ }));

    await user.click(screen.getByRole("button", { name: /créer la commande/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ville/i);
    expect(postBody).toBeNull();
  });

  test("the city list is searchable rather than a wall of 119 destinations", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole("button", { name: /rechercher une ville/i }));
    const search = screen.getByPlaceholderText(/rechercher une ville/i);
    await user.type(search, "بنغ");

    const list = screen.getByRole("listbox");
    expect(within(list).getByRole("option", { name: /بنغازي/ })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: /طرابلس/ })).toBeNull();
  });
});
