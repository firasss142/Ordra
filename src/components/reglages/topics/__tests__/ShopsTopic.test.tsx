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
        shop("s5", "bard", "shopify"),
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
        { id: "o1", storefront_id: "s1", product_name: "Crème Biovera 50 ml", external_variant_id: "4471", external_product_id: "p9", customer_city: null },
        { id: "o2", storefront_id: "s1", product_name: "Crème Biovera 50 ml", external_variant_id: "4471", external_product_id: "p9", customer_city: null },
      ],
    },
    [`/api/mappings/unmatched?type=cities&market_id=${LY}`]: { data: [] },
    [`/api/products?market_id=${LY}`]: { data: [{ id: "prod-1", name: "Crème Biovera — 50 ml", sku: "BIO-50" }, { id: "prod-2", name: "Sérum Vitamine C", sku: "SER-C" }] },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { id: "new-shop" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.useRealTimers());

const mount = (user: AuthUser) => render(<ShopsTopic user={user} marketId={LY} marketCode="ly" />);
const shopsCard = () => screen.getByRole("heading", { name: "Boutiques" }).closest("section") as HTMLElement;

describe("Réglages › Boutiques", () => {
  it("dates each shop from its orders and says which ones fell silent", () => {
    mount(admin);
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
      new Response(JSON.stringify({ code: "missing_columns", columns: ["QR Code", "Total Price"] }), { status: 422 }),
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

  it("associates an unknown product: one row per shop and reference, with its waiting orders", async () => {
    mount(manager);
    expect(screen.getByText("Crème Biovera 50 ml")).toBeInTheDocument();
    expect(screen.getByText(/2 commandes en attente/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Associer" }));
    const panel = screen.getByRole("dialog");
    await userEvent.click(within(panel).getByRole("radio", { name: /Crème Biovera — 50 ml/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Associer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mappings/products", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ storefront_id: "s1", external_variant_id: "4471", external_product_id: "p9", product_id: "prod-1" });
  });
});
