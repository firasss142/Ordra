import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { DeliveryTopic } from "../DeliveryTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const manager: AuthUser = { ...admin, id: "m", role: "market_manager", market_id: LY };

const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  // Libya, production 2026-10-02.
  swr.byKey = {
    [`/api/settings/${LY}`]: { data: [] },
    [`/api/carriers?market_id=${LY}`]: {
      data: [
        { id: "c1", market_id: LY, name: "Darb Assabil - Tripoli", code: "darb_assabil", delivery_fee: 10, return_fee: 5, is_active: true, warehouse_id: "w1" },
        { id: "c2", market_id: LY, name: "Darb Assabil — Benghazi", code: "darb_assabil", delivery_fee: 10, return_fee: 5, is_active: false, warehouse_id: "w2" },
        { id: "c3", market_id: LY, name: "Essai", code: "darb_assabil", delivery_fee: 0, return_fee: 0, is_active: true, warehouse_id: null },
      ],
    },
    [`/api/carriers/performance?market_id=${LY}`]: { data: [{ carrier_id: "c1", delivered: 174, returned: 2, delivery_rate_30d: 0.98, median_transit_hours: null, sample_size: 176 }] },
    [`/api/admin/warehouse-sites?market_id=${LY}`]: {
      data: [
        { id: "w1", nameFr: "Tripoli", nameAr: "طرابلس", isDefault: true, isActive: true, assignedAgents: [], stockUnits: 0 },
        { id: "w2", nameFr: "Benghazi", nameAr: "بنغازي", isDefault: false, isActive: true, assignedAgents: [], stockUnits: 0 },
      ],
    },
    [`/api/carriers/adapters?market_id=${LY}`]: {
      data: [
        { code: "darb_assabil", label: "Darb Assabil", description: "", defaultEndpoint: "https://v2.sabil.ly", markets: ["ly"], credentialFields: [{ key: "api_key", label: "Clé API", secret: true }, { key: "account_id", label: "ID", secret: false }] },
        { code: "dexpress", label: "Dexpress", description: "", defaultEndpoint: "https://portal.dexpress.ly", markets: ["ly"], credentialFields: [{ key: "email", label: "Email", secret: false }, { key: "password", label: "Mot de passe", secret: true }] },
      ],
    },
    "/api/carriers/c1": { data: { id: "c1", name: "Darb Assabil - Tripoli", code: "darb_assabil", delivery_fee: 10, return_fee: 5, is_active: true, credentials: { account_id: "692637b42f63874515cebd63" } } },
    "/api/carriers/c1/order-preferences": {
      data: {
        is_pickup: { value: true, canOverride: true }, allow_inspection: { value: false, canOverride: true }, is_fragile: { value: false, canOverride: true },
        allow_card_payment: { value: false, canOverride: true }, allow_testing: { value: false, canOverride: true }, is_replacement: { value: false, canOverride: true },
      },
      fulfilmentModes: { home: true, carrier: false },
    },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { id: "new" }, reachable: true, status: 200 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

const mount = (user: AuthUser) =>
  render(
    <ReglagesFormProvider>
      <SaveBar />
      <DeliveryTopic user={user} marketId={LY} marketCode="ly" />
    </ReglagesFormProvider>,
  );
const carriersCard = () => screen.getByRole("heading", { name: "Transporteurs" }).closest("section") as HTMLElement;

describe("Réglages › Livraison", () => {
  it("lists each carrier with its site, its fees and what it delivered in 30 days", () => {
    mount(admin);
    const rows = within(carriersCard()).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Darb Assabil - Tripoli");
    expect(rows[0]).toHaveTextContent("Tripoli");
    expect(rows[0]).toHaveTextContent("10 · 5");
    expect(rows[0]).toHaveTextContent(/174\s?sur 176/);
    expect(rows[2]).toHaveTextContent("non renseignés");
  });

  it("switches a carrier off from the list", async () => {
    mount(admin);
    await userEvent.click(within(carriersCard()).getByRole("switch", { name: "Darb Assabil - Tripoli" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/carriers/c1", expect.objectContaining({ method: "PATCH" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ is_active: false });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Darb Assabil - Tripoli désactivé" }));
  });

  it("a manager reads the carriers but sets the risk thresholds", () => {
    mount(manager);
    expect(within(carriersCard()).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(carriersCard()).queryByRole("button", { name: "Ajouter un transporteur" })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Montant élevé" })).toBeInTheDocument();
    expect(screen.getByText("Désactivé : le montant ne rend jamais un colis à risque. Saisissez un montant pour l’activer.")).toBeInTheDocument();
  });

  it("changes a carrier's fee from its panel", async () => {
    mount(admin);
    await userEvent.click(within(carriersCard()).getByRole("button", { name: "Ouvrir Darb Assabil - Tripoli" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByDisplayValue("692637b42f63874515cebd63")).toBeInTheDocument();
    const fee = within(panel).getByRole("spinbutton", { name: "Livraison" });
    await userEvent.clear(fee);
    await userEvent.type(fee, "12");
    await userEvent.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/carriers/c1", expect.objectContaining({ method: "PATCH" })));
    const patch = fetchMock.mock.calls.find(([u, i]) => u === "/api/carriers/c1" && i.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({ delivery_fee: 12 });
  });

  it("adds a carrier attached to its site — the button works again", async () => {
    mount(admin);
    await userEvent.click(within(carriersCard()).getByRole("button", { name: "Ajouter un transporteur" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Nom affiché"), "Darb Assabil - Misrata");
    await userEvent.selectOptions(within(panel).getByLabelText("Site d’où partent ses colis"), "w2");
    await userEvent.type(within(panel).getByLabelText("Clé API"), "secret-key");
    await userEvent.type(within(panel).getByLabelText("Identifiant de compte"), "acc-1");
    await userEvent.click(within(panel).getByRole("button", { name: "Créer le transporteur" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/carriers", expect.objectContaining({ method: "POST" })));
    const post = fetchMock.mock.calls.find(([u]) => u === "/api/carriers");
    expect(JSON.parse(post![1].body)).toEqual({
      market_id: LY, name: "Darb Assabil - Misrata", code: "darb_assabil", api_endpoint: "https://v2.sabil.ly",
      credentials: { api_key: "secret-key", account_id: "acc-1" }, delivery_fee: 0, return_fee: 0, warehouse_id: "w2",
    });
  });
});
