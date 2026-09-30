import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import { DEFAULT_MARKET_SETTINGS, type MarketSettings } from "@/types/settings";

const availability = vi.fn();
const templates = vi.fn();
vi.mock("@/hooks/useWhatsAppAvailability", () => ({ useWhatsAppAvailability: () => ({ availability: availability(), active: true, isLoading: false }) }));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({ useWhatsAppTemplates: () => ({ templates: templates(), isLoading: false, mutate: vi.fn() }) }));
vi.mock("swr", () => ({ default: () => ({ data: undefined, mutate: vi.fn() }) }));

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import { WhatsAppSection } from "../WhatsAppSection";

/**
 * Paramètres › WhatsApp — prototypes/whatsapp-manager-v1.html?screen=parametres.
 * A super_admin sets it; a market_manager reads it (owner's decision): every
 * control disabled, no save, and the read-only note that says who can.
 */
const LY = "00000000-0000-0000-0000-000000000002";
const tpl = (event: string, language: string, status: string) => ({ id: `${event}-${language}`, market_id: LY, name: `ordra_${event}_v1`, language, category: "UTILITY", status, rejected_reason: null, components: [], body_text: "", header_format: null, footer_text: null, variables: [], event_key: event, catalogue_key: event, source: "catalogue", campaign_id: null, synced_at: null });

function mount(values: Partial<MarketSettings> = {}, readOnly = false) {
  const set = vi.fn();
  const onSave = vi.fn();
  const onReset = vi.fn();
  render(
    <WhatsAppSection values={{ ...DEFAULT_MARKET_SETTINGS, ...values }} marketId={LY} set={set} onSave={onSave} onReset={onReset} saving={false} successMsg="" errorMsg="" readOnly={readOnly} />,
  );
  return { set, onSave, onReset };
}

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  availability.mockReturnValue({ market_id: LY, connected: true, active: true, status: "active", display_phone: "+218", verified_name: "Ordra", messaging_limit_tier: "TIER_250", quality_rating: "GREEN" });
  templates.mockReturnValue([tpl("shipped", "fr", "APPROVED"), tpl("shipped", "ar", "APPROVED"), tpl("could_not_reach", "fr", "APPROVED"), tpl("could_not_reach", "ar", "PENDING"), tpl("delivered", "fr", "APPROVED")]);
});

describe("WhatsAppSection (Paramètres › WhatsApp)", () => {
  it("shows the master switch, five events with their template state per language, disabled while the master is off", async () => {
    const { set } = mount();
    expect(screen.getByRole("switch", { name: "Notifications automatiques" })).toHaveAttribute("aria-checked", "false");
    const shipped = screen.getByTestId("wa-event-shipped");
    expect(within(shipped).getByText("fr · modèle approuvé")).toBeInTheDocument();
    expect(within(shipped).getByText("ar · modèle approuvé")).toBeInTheDocument();
    expect(within(shipped).getByRole("switch")).toBeDisabled();
    const reach = screen.getByTestId("wa-event-could_not_reach");
    expect(within(reach).getByText("ar · en attente d'approbation")).toBeInTheDocument();
    const delivered = screen.getByTestId("wa-event-delivered");
    expect(within(delivered).getByText("ar · aucun modèle approuvé")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Notifications automatiques" }));
    expect(set).toHaveBeenCalledWith("whatsapp_lifecycle_enabled", true);
  });

  it("the card title carries the lightning icon and its sub-line", () => {
    mount();
    const title = screen.getByRole("heading", { name: "Notifications WhatsApp automatiques" });
    expect(title.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/Chaque événement se coupe indépendamment/)).toBeInTheDocument();
  });

  it("enables an event once the master is on and reports it through set()", async () => {
    const { set } = mount({ whatsapp_lifecycle_enabled: true });
    const sw = within(screen.getByTestId("wa-event-shipped")).getByRole("switch");
    expect(sw).toBeEnabled();
    await userEvent.click(sw);
    expect(set).toHaveBeenCalledWith("whatsapp_event_shipped", true);
  });

  it("warns about the unverified tier, and names each gap: the language and the event", () => {
    mount({ whatsapp_lifecycle_enabled: true, whatsapp_event_delivered: true, whatsapp_event_could_not_reach: true });
    expect(screen.getByText(/250 destinataires par 24 h/)).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Aucun modèle approuvé en arabe pour « Livré ».");
    expect(alert).toHaveTextContent("Aucun modèle approuvé en arabe pour « Injoignable ».");
    expect(alert).not.toHaveTextContent("en français pour « Livré »");
  });

  it("points to Connexions when the market has no number", () => {
    availability.mockReturnValue({ market_id: LY, connected: false, active: false, status: null, display_phone: null, verified_name: null, messaging_limit_tier: null, quality_rating: null });
    mount();
    expect(screen.getByText("WhatsApp n'est pas connecté pour ce marché")).toBeInTheDocument();
  });

  it("Langue par défaut and Plage d'envoi are two cards side by side; both write through set(); a bad window is refused inline", async () => {
    const { set } = mount();
    expect(screen.getByRole("heading", { name: "Langue par défaut" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plage d'envoi" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "العربية" }));
    expect(set).toHaveBeenCalledWith("whatsapp_default_language", "ar");
    const input = screen.getByRole("textbox", { name: "Plage d'envoi" });
    await userEvent.type(input, "10-20");
    expect(set).toHaveBeenLastCalledWith("whatsapp_send_window", "10-20");
    await userEvent.clear(input);
    await userEvent.type(input, "20-10");
    expect(screen.getByRole("alert")).toHaveTextContent(/HH-HH/);
    expect(set).not.toHaveBeenCalledWith("whatsapp_send_window", "20-10");
    expect(screen.getByText(/h · Africa\/Tripoli/)).toBeInTheDocument();
  });

  it("saves and resets the group", async () => {
    const { onSave, onReset } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSave).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Réinitialiser ce groupe" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("read-only (market_manager): every control disabled, no save, no reset, and the note that says who can", () => {
    mount({ whatsapp_lifecycle_enabled: true }, true);
    for (const sw of screen.getAllByRole("switch")) expect(sw).toBeDisabled();
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Plage d'envoi" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réinitialiser ce groupe" })).not.toBeInTheDocument();
    expect(screen.getByText("Lecture seule — les identifiants et les réglages sont modifiés par un super_admin.")).toBeInTheDocument();
  });

  it("speaks Arabic", () => {
    intl.messages = arMessages as Record<string, unknown>;
    mount({ whatsapp_lifecycle_enabled: true, whatsapp_event_delivered: true });
    expect(screen.getByRole("heading", { name: "إشعارات واتساب التلقائية" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "الإشعارات التلقائية" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("لا قالب معتمد بالعربية لـ«تم التسليم».");
    expect(screen.getByRole("button", { name: "حفظ" })).toBeInTheDocument();
  });
});
