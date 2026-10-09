import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import type { AuthUser } from "@/types";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: toast }) }));
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));
vi.mock("@/lib/client/image", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/image")>()),
  decodeImageFile: async () => ({ ok: true, dataUrl: "data:image/png;base64,AAA" }),
}));
vi.mock("@/lib/storefronts/secret-gen", () => ({ generateSecret: () => "a".repeat(48) }));

import { ShopsTopic } from "../ShopsTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const manager: AuthUser = { ...admin, id: "m", role: "market_manager", market_id: LY };
const shop = (id: string, name: string, platform: string, is_active = true, auth_mode = "hmac") => ({ id, market_id: LY, name, platform, is_active, auth_mode, config: {}, webhook_secret: "••••••••" });

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T14:00:00Z"));
  intl.messages = frMessages as Record<string, unknown>;
  // Libya, production 2026-10-02 (a subset).
  swr.byKey = {
    [`/api/storefronts?market_id=${LY}`]: {
      data: [
        shop("s1", "Converty Libya (Sheets)", "google_sheets"),
        shop("s3", "EasyOrdersLY - Quran", "easy_orders"),
        { ...shop("s5", "bard", "shopify"), logo_url: "https://cdn/logos/storefronts/s5/logo.png?v=1" },
        shop("s8", "Easy Orders LY", "easy_orders", false),
      ],
    },
    [`/api/storefronts/activity?market_id=${LY}`]: {
      data: [
        { storefront_id: "s1", orders_30d: 1656, last_order_at: "2026-09-29T15:30:00Z" },
        { storefront_id: "s3", orders_30d: 5, last_order_at: "2026-09-07T16:06:00Z" },
        { storefront_id: "s5", orders_30d: 0, last_order_at: null },
        { storefront_id: "s8", orders_30d: 0, last_order_at: null },
      ],
    },
    [`/api/mappings/unmatched?type=products&market_id=${LY}`]: {
      data: [
        { id: "o1", created_at: "2026-09-30T09:00:00Z", storefront_id: "s1", product_name: "Crème Biovera 50 ml", external_variant_id: "4471", external_product_id: "p9", customer_city: null },
        { id: "o2", created_at: "2026-10-01T09:00:00Z", storefront_id: "s1", product_name: "Crème Biovera 50 ml", external_variant_id: "4471", external_product_id: "p9", customer_city: null },
      ],
    },
    [`/api/mappings/unmatched?type=cities&market_id=${LY}`]: { data: [] },
    [`/api/products?market_id=${LY}`]: { data: [{ id: "prod-1", name: "Crème Biovera — 50 ml", sku: "BIO-50", image_url: "https://cdn/products/prod-1.jpg" }, { id: "prod-2", name: "Sérum Vitamine C", sku: "SER-C" }] },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { id: "new-shop" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.useRealTimers());

const mount = (user: AuthUser) => render(<ShopsTopic user={user} marketId={LY} marketCode="ly" />);
const shopsCard = () => screen.getByRole("heading", { name: "Boutiques" }).closest("section") as HTMLElement;
const matchCard = () => screen.getByRole("region", { name: "Produits et villes à associer" });

describe("Réglages › Boutiques", () => {
  it("opens on the active shops; « Toutes » brings back the disabled one", async () => {
    mount(admin);
    const names = () => within(shopsCard()).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(within(shopsCard()).getByRole("button", { name: /Actives/ })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toHaveLength(3);
    expect(names().join()).not.toContain("Easy Orders LY");
    await userEvent.click(within(shopsCard()).getByRole("button", { name: /Toutes/ }));
    expect(names()).toHaveLength(4);
  });

  it("dates each shop from its orders and says which ones fell silent", async () => {
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: /Toutes/ }));
    const rows = within(shopsCard()).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Converty Libya (Sheets)");
    expect(rows[0]).toHaveTextContent("1 656");
    expect(rows[0]).toHaveTextContent("Reçoit des commandes");
    expect(rows[1]).toHaveTextContent("Silencieuse depuis 24 j");
    expect(rows[2]).toHaveTextContent("Jamais reçu de commande");
    expect(rows[3]).toHaveTextContent("Désactivée");
  });

  it("filters the silent shops", async () => {
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: /Silencieuses/ }));
    const rows = within(shopsCard()).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("EasyOrdersLY - Quran"), expect.stringContaining("bard")]);
  });

  it("a manager reads the shops but matches products", () => {
    mount(manager);
    expect(within(shopsCard()).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(shopsCard()).queryByRole("button", { name: "Ajouter une boutique" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Associer" })).toBeInTheDocument();
  });

  it("creates a shop and shows its reception link and secret once", async () => {
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ajouter une boutique" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Nom"), "Biovera Libye");
    await userEvent.click(within(panel).getByRole("radio", { name: /Shopify/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Créer la boutique" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/storefronts", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ market_id: LY, name: "Biovera Libye", platform: "shopify", webhook_secret: "a".repeat(48) });
    const done = await screen.findByRole("dialog");
    expect(done).toHaveTextContent("/api/webhooks/new-shop");
    expect(done).toHaveTextContent("a".repeat(48));
  });

  it("connects a second Converty account from its Google Sheet, new orders only by default", async () => {
    swr.byKey["/api/storefronts/sheets-service-account"] = { email: "ordra@x.iam.gserviceaccount.com" };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-sheet", name: "Converty — compte 2" }, rows_existing: 5422 }), { status: 201 }),
    );
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ajouter une boutique" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Nom"), "Converty — compte 2");
    await userEvent.click(within(panel).getByRole("radio", { name: /Google Sheets/ }));
    // The address to share the sheet with, before anything is created.
    expect(panel).toHaveTextContent("ordra@x.iam.gserviceaccount.com");
    expect(within(panel).getByRole("radio", { name: /Nouvelles commandes seulement/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.type(within(panel).getByLabelText("Lien de la feuille"), "https://docs.google.com/spreadsheets/d/abc/edit");
    await userEvent.type(within(panel).getByLabelText("Onglet"), "Orders");
    await userEvent.click(within(panel).getByRole("button", { name: "Créer la boutique" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/storefronts", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      market_id: LY,
      name: "Converty — compte 2",
      platform: "google_sheets",
      config: { spreadsheet: "https://docs.google.com/spreadsheets/d/abc/edit", sheet_name: "Orders", import_from: "now" },
    });
    const done = await screen.findByRole("dialog");
    expect(done).toHaveTextContent("5 422");
    expect(done).not.toHaveTextContent("/api/webhooks/");
  });

  it("says what to fix when the sheet cannot be connected", async () => {
    swr.byKey["/api/storefronts/sheets-service-account"] = { email: "ordra@x.iam.gserviceaccount.com" };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "missing_columns", columns: ["QR Code", "Total Price"], found: ["Order", "Phone"] }), { status: 422 }),
    );
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ajouter une boutique" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Nom"), "X");
    await userEvent.click(within(panel).getByRole("radio", { name: /Google Sheets/ }));
    await userEvent.type(within(panel).getByLabelText("Lien de la feuille"), "abc");
    await userEvent.type(within(panel).getByLabelText("Onglet"), "Orders");
    await userEvent.click(within(panel).getByRole("button", { name: "Créer la boutique" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("QR Code, Total Price");
    expect(within(panel).getByRole("alert")).toHaveTextContent("Order, Phone");
  });

  it("shows which sheet and tab a sheet shop reads", async () => {
    swr.byKey[`/api/storefronts?market_id=${LY}`] = {
      data: [{ ...shop("s1", "Converty Libya (Sheets)", "google_sheets"), config: { spreadsheet_id: "1RT7e_Tmmz3krH3quHNQ6Hmv", sheet_name: "converty-orders-bachir" } }],
    };
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ouvrir Converty Libya (Sheets)" }));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent("converty-orders-bachir");
    expect(within(panel).getByRole("link", { name: /Ouvrir la feuille/ })).toHaveAttribute(
      "href",
      "https://docs.google.com/spreadsheets/d/1RT7e_Tmmz3krH3quHNQ6Hmv",
    );
  });

  it("tells, per sheet shop, whether its import works and which rows did not import", async () => {
    swr.byKey[`/api/google-sheets/sync-status?market_id=${LY}`] = {
      configs_count: 2,
      sources: [
        {
          storefront_id: "s1",
          platform: "converty",
          is_active: true,
          last_row: 5422,
          last_run: { status: "failed", started_at: "2026-10-02T13:45:00Z", finished_at: "2026-10-02T13:45:05Z", error: "Unable to parse range: 'Orders'!A1:Z" },
          last_success: { status: "succeeded", started_at: "2026-10-02T12:00:00Z", finished_at: "2026-10-02T12:00:09Z" },
          open_failures: 1,
        },
        { storefront_id: "other", platform: "converty", is_active: true, last_row: 9, last_run: null, last_success: null, open_failures: 3 },
      ],
      failures: [
        { id: "f1", storefront_id: "s1", row_index: 5400, message: "Missing customer phone", raw_row: {}, created_at: "2026-10-02T12:00:00Z" },
        { id: "f2", storefront_id: "other", row_index: 3, message: "Missing QR Code", raw_row: {}, created_at: "2026-10-02T12:00:00Z" },
      ],
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, results: [] }), { status: 200 }));
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ouvrir Converty Libya (Sheets)" }));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent("En panne");
    expect(panel).toHaveTextContent("Unable to parse range");
    expect(panel).toHaveTextContent("5 422");
    expect(panel).toHaveTextContent("Ligne 5400");
    expect(panel).toHaveTextContent("Missing customer phone");
    // Another account's failures are not this shop's.
    expect(panel).not.toHaveTextContent("Missing QR Code");
    await userEvent.click(within(panel).getByRole("button", { name: "Lire maintenant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/google-sheets/sync", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ market_id: LY });
  });

  it("regenerates a shop's secret and shows the new one once", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ouvrir bard" }));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent("/api/webhooks/s5");
    await userEvent.click(within(panel).getByRole("button", { name: "Régénérer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/storefronts/s5", expect.objectContaining({ method: "PATCH" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ webhook_secret: "a".repeat(48) });
    expect(await within(panel).findByText("a".repeat(48))).toBeInTheDocument();
  });

  it("lists the shops first and the names to match under them, Produits before Villes", () => {
    mount(admin);
    const cards = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(cards.indexOf("Boutiques")).toBeLessThan(cards.indexOf("Produits et villes à associer"));
    const tabs = within(screen.getByRole("tablist", { name: "Produits et villes à associer" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Produits1", "Villes0"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("proposes Ordra's product for an unknown one and associates it in one click", async () => {
    mount(manager);
    const card = matchCard();
    const row = within(card).getByText("Crème Biovera 50 ml").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Crème Biovera — 50 ml");
    expect(row).toHaveTextContent("Nom identique");
    expect(row.querySelector('img[src="https://cdn/products/prod-1.jpg"]')).not.toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Associer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mappings/products", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ storefront_id: "s1", external_variant_id: "4471", external_product_id: "p9", product_id: "prod-1" });
  });

  it("« Choisir… » opens the picker on the proposal, and another product can be chosen", async () => {
    mount(manager);
    await userEvent.click(within(matchCard()).getByRole("button", { name: "Choisir…" }));
    const panel = screen.getByRole("dialog");
    const proposed = within(panel).getByRole("radio", { name: /Crème Biovera — 50 ml/ });
    expect(proposed).toHaveAttribute("aria-checked", "true");
    expect(proposed.querySelector("img")).toHaveAttribute("src", "https://cdn/products/prod-1.jpg");
    await userEvent.click(within(panel).getByRole("radio", { name: /Sérum Vitamine C/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Associer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mappings/products", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).product_id).toBe("prod-2");
  });

  it("binds every waiting order of every identical city in one click", async () => {
    swr.byKey[`/api/mappings/unmatched?type=products&market_id=${LY}`] = { data: [] };
    swr.byKey[`/api/mappings/unmatched?type=cities&market_id=${LY}`] = {
      data: [
        ...["c1", "c2", "c3"].map((id) => ({ id, created_at: "2026-03-10T09:00:00Z", storefront_id: "s1", product_name: "x", external_variant_id: null, external_product_id: null, customer_city: "Misrata" })),
        { id: "c4", created_at: "2026-09-30T09:00:00Z", storefront_id: "s1", product_name: "x", external_variant_id: null, external_product_id: null, customer_city: "Zliten" },
        { id: "c5", created_at: "2026-09-30T09:00:00Z", storefront_id: "s1", product_name: "x", external_variant_id: null, external_product_id: null, customer_city: "Nowhere" },
      ],
    };
    swr.byKey[`/api/mappings/cities?market_id=${LY}`] = { data: [{ id: 12, city: "Misrata" }, { id: 13, city: "Zliten" }, { id: 14, city: "Tripoli" }] };
    mount(admin);
    const card = matchCard();
    expect(within(card).getByRole("tab", { name: /Villes/ })).toHaveAttribute("aria-selected", "true");
    expect(within(card).getByText("Nowhere").closest("tr")).toHaveTextContent("Aucune proposition");
    await userEvent.click(within(card).getByRole("button", { name: /noms identiques/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body)).sort((a, b) => a.order_id.localeCompare(b.order_id));
    expect(bodies).toEqual([
      { order_id: "c1", darb_destination_id: 12 },
      { order_id: "c2", darb_destination_id: 12 },
      { order_id: "c3", darb_destination_id: 12 },
      { order_id: "c4", darb_destination_id: 13 },
    ]);
    expect(fetchMock.mock.calls.every((c) => c[0] === "/api/mappings/cities")).toBe(true);
  });

  it("says so in one line when nothing waits", () => {
    swr.byKey[`/api/mappings/unmatched?type=products&market_id=${LY}`] = { data: [] };
    mount(admin);
    expect(screen.getByText("Tout est associé")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("Réglages › Boutiques — the shop's logo", () => {
  it("shows an uploaded logo in place of the platform letters", () => {
    const { container } = mount(admin);
    expect(container.querySelector('img[src="https://cdn/logos/storefronts/s5/logo.png?v=1"]')).not.toBeNull();
  });

  it("is uploaded from the shop's drawer and the list refreshes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ logo_url: "https://cdn/l.png?v=2" }), { status: 200 }));
    mount(admin);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ouvrir EasyOrdersLY - Quran" }));
    const panel = screen.getByRole("dialog");
    await userEvent.upload(within(panel).getByTestId("photo-input"), new File(["x"], "l.png", { type: "image/png" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/storefronts/s3/logo", expect.objectContaining({ method: "PUT", body: JSON.stringify({ logo: "data:image/png;base64,AAA" }) })),
    );
    await waitFor(() => expect(panel.querySelector('img[src="https://cdn/l.png?v=2"]')).not.toBeNull());
    expect(swr.mutate).toHaveBeenCalled();
  });

  it("a manager sees the logo but cannot change it", async () => {
    mount(manager);
    await userEvent.click(within(shopsCard()).getByRole("button", { name: "Ouvrir bard" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).queryByTestId("photo-input")).toBeNull();
    expect(panel.querySelector('img[src="https://cdn/logos/storefronts/s5/logo.png?v=1"]')).not.toBeNull();
  });
});
