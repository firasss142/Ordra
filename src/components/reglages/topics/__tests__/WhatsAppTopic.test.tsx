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
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { WhatsAppTopic } from "../WhatsAppTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const manager: AuthUser = { ...admin, id: "m", role: "market_manager", market_id: LY };
const tpl = (event: string, language: string, status: string) => ({ id: `${event}-${language}`, event_key: event, language, status });
const CONNECTED = {
  id: "cfg", market_id: LY, waba_id: "1", phone_number_id: "2", app_id: "3", graph_version: "v26.0", display_phone: "+218 91 000 0000", verified_name: "Totella",
  quality_rating: "GREEN", messaging_limit_tier: "TIER_250", status: "active", last_webhook_at: null, templates: { approved: 3, pending: 1, rejected: 0 },
};

const fetchMock = vi.fn();
function setup(configs: unknown[], settings: unknown[] = []) {
  swr.byKey = {
    [`/api/settings/${LY}`]: { data: settings },
    "/api/whatsapp/config": { data: configs },
    [`/api/whatsapp/templates?market_id=${LY}`]: { data: [tpl("shipped", "fr", "APPROVED"), tpl("shipped", "ar", "PENDING")] },
  };
}
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  // Production, 2026-10-02: no market has WhatsApp connected.
  setup([]);
  swr.mutate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

const mount = (user: AuthUser) =>
  render(
    <ReglagesFormProvider>
      <SaveBar />
      <WhatsAppTopic user={user} marketId={LY} marketCode="ly" />
    </ReglagesFormProvider>,
  );

describe("Réglages › WhatsApp", () => {
  it("says the number is not connected, and the automatic messages wait for it", () => {
    mount(admin);
    expect(screen.getByText("WhatsApp n’est pas connecté pour la Libye")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connecter le numéro" })).toBeInTheDocument();
    expect(screen.getByText("Disponible une fois le numéro connecté.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("tells a manager an administrator connects it", () => {
    mount(manager);
    expect(screen.getByText("Un administrateur doit connecter le numéro.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connecter le numéro" })).not.toBeInTheDocument();
  });

  it("connected: the number, its quality and limit, and each event's template", () => {
    setup([CONNECTED], [{ key: "whatsapp_lifecycle_enabled", value: { value: true } }, { key: "whatsapp_event_shipped", value: { value: true } }]);
    mount(admin);
    expect(screen.getByText("+218 91 000 0000")).toBeInTheDocument();
    expect(screen.getByText("Bonne")).toBeInTheDocument();
    expect(screen.getByText("250 clients par 24 h — entreprise pas encore vérifiée")).toBeInTheDocument();
    const shipped = screen.getByText("Expédié").closest("[data-testid='setting-row']") as HTMLElement;
    expect(within(shipped).getByText("FR · modèle approuvé")).toBeInTheDocument();
    expect(within(shipped).getByText("AR · en attente d’approbation")).toBeInTheDocument();
  });

  it("the master switch goes through the save bar", async () => {
    setup([CONNECTED], [{ key: "whatsapp_lifecycle_enabled", value: { value: true } }]);
    mount(admin);
    await userEvent.click(screen.getByRole("switch", { name: "Envoyer les messages automatiques" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ whatsapp_lifecycle_enabled: false });
  });

  it("changes the sending hours", async () => {
    setup([CONNECTED], [{ key: "whatsapp_send_window", value: { value: "10-20" } }]);
    mount(admin);
    const end = screen.getByRole("spinbutton", { name: "Fin (heure)" });
    expect(end).toHaveValue(20);
    await userEvent.clear(end);
    await userEvent.type(end, "21");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ whatsapp_send_window: "10-21" });
  });

  it("pauses the number", async () => {
    setup([CONNECTED]);
    mount(admin);
    await userEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/whatsapp/config/${LY}`, expect.objectContaining({ method: "PATCH" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "paused" });
  });

  it("a manager reads the connected number and the messages, and changes nothing", () => {
    setup([CONNECTED], [{ key: "whatsapp_lifecycle_enabled", value: { value: true } }]);
    mount(manager);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mettre en pause" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Modifiable par un administrateur").length).toBeGreaterThan(0);
  });
});
