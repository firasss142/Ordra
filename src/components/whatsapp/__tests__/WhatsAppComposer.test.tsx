import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppComposer } from "../WhatsAppComposer";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import type { TemplateRow } from "@/components/whatsapp/TemplatesTable";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

/**
 * Prototype: whatsapp-agent-v1.html — screens `panel` (window open) and
 * `panel-closed`, states `failed`, `optedout`, `noconfig`.
 */
const tpl = (over: Partial<TemplateRow>): TemplateRow =>
  ({
    id: "t", market_id: "tn", name: "ordra_x_v1", language: "fr", category: "UTILITY", status: "APPROVED", rejected_reason: null, components: [], body_text: "", header_format: null,
    footer_text: null, variables: [], event_key: null, catalogue_key: null, source: "catalogue", campaign_id: null, synced_at: null, ...over,
  }) as TemplateRow;

const TEMPLATES: TemplateRow[] = [
  tpl({ id: "bd-fr", name: "ordra_before_delivery_v1", catalogue_key: "before_delivery", body_text: "Bonjour {{1}}, votre colis est en route avec {{2}}.\nMontant à préparer : {{3}}.", variables: ["name", "carrier", "amount"] }),
  tpl({ id: "bd-ar", name: "ordra_before_delivery_v1", language: "ar", catalogue_key: "before_delivery", body_text: "مرحباً {{1}}، طلبك مع {{2}} في طريقه إليك.", variables: ["name", "carrier"] }),
  tpl({ id: "cn-fr", name: "ordra_courier_no_answer_v1", catalogue_key: "courier_no_answer", body_text: "Bonjour {{1}}, le livreur {{2}}…", variables: ["name", "courier"] }),
  tpl({ id: "shipped-fr", name: "ordra_shipped_v1", catalogue_key: "shipped", event_key: "shipped", body_text: "x {{1}}", variables: ["name"] }),
  tpl({ id: "pending-fr", name: "ordra_address_check_v1", catalogue_key: "address_check", status: "PENDING", body_text: "y {{1}} {{2}}", variables: ["name", "address"] }),
  tpl({ id: "fu-fr", name: "ordra_prospect_follow_up_v1", catalogue_key: "prospect_follow_up", category: "MARKETING", body_text: "Relance {{1}}", variables: ["name"] }),
];

const VARS = { name: "Amel", carrier: "Navex", amount: "89 TND", courier: "Karim" };
const CONV = { id: "conv-1", phone_e164: "21698765432", customer_id: "c", current_order_id: "o-1", current_lead_id: null, profile_name: "Amel", last_inbound_at: null, last_outbound_at: null, unread_count: 0, opted_out_at: null, opt_out_text: null, undeliverable_at: null };

const thread = (over: Partial<ThreadPayload> = {}): ThreadPayload => ({
  conversation: CONV,
  messages: [],
  phone_e164: "21698765432",
  customer_language: null,
  window_open: false,
  window_closes_at: null,
  config_active: true,
  config_status: "active",
  ...over,
});

function mount(over: Partial<React.ComponentProps<typeof WhatsAppComposer>> = {}) {
  return render(
    <WhatsAppComposer target={{ order_id: "o-1" }} thread={thread()} templates={TEMPLATES} variables={VARS} defaultLanguage="fr" templateSet="agent" {...over} />,
  );
}

beforeEach(() => {
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "m-1", status: "sent" } }), { status: 201 }));
});

describe("WhatsAppComposer", () => {
  it("offers only the approved agent-set chips in the chosen language, and renders the preview with highlighted variables", () => {
    mount();
    const tabs = screen.getAllByRole("tab").map((b) => b.textContent);
    expect(tabs).toEqual(["Avant livraison", "Livreur n'a pas pu joindre"]);
    const preview = screen.getByTestId("whatsapp-preview");
    expect(preview).toHaveTextContent("Bonjour Amel, votre colis est en route avec Navex.");
    const marks = within(preview).getAllByText((_, el) => el?.tagName === "MARK");
    expect(marks.map((m) => m.textContent)).toEqual(["Amel", "Navex", "89 TND"]);
    // No inbound ever: the chip says so rather than "closed".
    expect(screen.getByText("Le client n'a jamais écrit · modèles uniquement")).toBeInTheDocument();
  });

  it("starts on the customer's remembered language and re-filters when switched", () => {
    mount({ thread: thread({ customer_language: "ar" }) });
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Avant livraison"]);
    expect(screen.getByTestId("whatsapp-preview")).toHaveAttribute("dir", "rtl");
  });

  it("window closed: no free-text chip; window open: free text with a counter", async () => {
    const { rerender } = mount();
    expect(screen.queryByRole("tab", { name: /Texte libre/ })).not.toBeInTheDocument();
    rerender(
      <WhatsAppComposer target={{ order_id: "o-1" }} thread={thread({ window_open: true, window_closes_at: "2026-09-25T18:19:00Z", conversation: { ...CONV, last_inbound_at: "2026-09-24T18:19:00Z" } })} templates={TEMPLATES} variables={VARS} defaultLanguage="fr" templateSet="agent" />,
    );
    expect(screen.getByText(/Fenêtre ouverte jusqu'à/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Texte libre/ }));
    const ta = screen.getByRole("textbox", { name: "Texte libre" });
    await userEvent.type(ta, "Je vous rappelle à 14h.");
    expect(screen.getByText("23 / 1000")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/whatsapp/send");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ target: { order_id: "o-1" }, language: "fr", mode: "text", text: "Je vous rappelle à 14h." });
  });

  it("sends the selected template with the log flag and reports success", async () => {
    const onSent = vi.fn();
    mount({ onSent, logDeliveryAction: true, defaultCatalogueKey: "courier_no_answer" });
    expect(screen.getByRole("tab", { name: "Livreur n'a pas pu joindre" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ target: { order_id: "o-1" }, language: "fr", mode: "template", template_id: "cn-fr", log_delivery_action: true });
    await waitFor(() => expect(onSent).toHaveBeenCalledWith({ id: "m-1", status: "sent" }));
    expect(screen.getByRole("button", { name: "Envoyé" })).toBeInTheDocument();
  });

  it("shows Meta's refusal in the agent's words and lets them retry", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ error: "graph_failed", code: 131026, kind: "undeliverable" }), { status: 502 }));
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("L'envoi a échoué · Meta 131026 · ce numéro n'est pas sur WhatsApp");
    expect(within(alert).getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("a 409 from the gate is explained too", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ error: "window_closed" }), { status: 409 }));
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/fenêtre de 24 h est fermée/);
  });

  it("replaces the composer with a banner when the customer opted out, and offers the call", async () => {
    const onCall = vi.fn();
    mount({ thread: thread({ conversation: { ...CONV, opted_out_at: "2026-09-25T09:00:00Z", opt_out_text: "توقف" } }), onCall });
    expect(screen.getByText("Ce client a demandé à ne plus recevoir de messages")).toBeInTheDocument();
    expect(screen.getByText(/توقف/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Envoyer" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Appeler" }));
    expect(onCall).toHaveBeenCalled();
  });

  it("says so when the market is not connected, and when no template is approved in the language", () => {
    const { unmount } = mount({ thread: thread({ config_active: false, config_status: null }) });
    expect(screen.getByText("WhatsApp n'est pas connecté pour ce marché")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    unmount();
    mount({ templates: [], });
    expect(screen.getByRole("status")).toHaveTextContent(/Aucun modèle approuvé/);
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  });

  it("prospect set: the follow-up chip plus the lead's campaign template", () => {
    const camp = tpl({ id: "camp", name: "ordra_camp_serum_260925", source: "campaign", campaign_id: "camp-1", category: "MARKETING", body_text: "Promo {{1}}", variables: ["name"] });
    mount({ templateSet: "prospect", templates: [...TEMPLATES, camp], campaignId: "camp-1", target: { lead_id: "l-1" } });
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["ordra_camp_serum_260925", "Relance"]);
  });
});

describe("WhatsAppComposer — prototype fidelity (whatsapp-agent-v1.html)", () => {
  const OPEN = (closes: string) =>
    thread({ window_open: true, window_closes_at: closes, conversation: { ...CONV, last_inbound_at: new Date(new Date(closes).getTime() - 86_400_000).toISOString() } });

  it("says « demain » when the window closes on another day than today", () => {
    const now = new Date(2026, 8, 25, 10, 30);
    const closes = new Date(2026, 8, 26, 10, 12).toISOString();
    mount({ thread: OPEN(closes), now });
    expect(screen.getByText("Fenêtre ouverte jusqu'à demain 10:12")).toBeInTheDocument();
  });

  it("keeps « Envoyé » after a send until the agent changes something", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
      expect(await screen.findByRole("button", { name: "Envoyé" })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(5000);
      expect(screen.getByRole("button", { name: "Envoyé" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: "Livreur n'a pas pu joindre" }));
      expect(screen.getByRole("button", { name: "Envoyer" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preferFreeText: opens straight on the text area while the window is open", () => {
    mount({ thread: OPEN("2026-09-26T10:12:00Z"), preferFreeText: true, placeholder: "Répondre au client…" });
    expect(screen.getByPlaceholderText("Répondre au client…")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Texte libre/ })).toHaveAttribute("aria-selected", "true");
  });

  it("not connected: explains the wa.me fallback and links to it when a link is given", () => {
    mount({ thread: thread({ config_active: false, config_status: null }), fallbackHref: "https://wa.me/21698765432?text=x" });
    expect(screen.getByText(/En attendant, le lien wa\.me ouvre WhatsApp sur votre téléphone/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir WhatsApp/ })).toHaveAttribute("href", "https://wa.me/21698765432?text=x");
  });

  it("a thread that failed to load says so instead of spinning forever", () => {
    mount({ thread: null, loadError: true });
    expect(screen.getByText("Impossible de charger les messages WhatsApp.")).toBeInTheDocument();
  });

  it("names a campaign chip by its campaign, not by Meta's template id", () => {
    const camp = tpl({ id: "camp", name: "ordra_camp_serum_260925", source: "campaign", campaign_id: "camp-1", category: "MARKETING", body_text: "Promo {{1}}", variables: ["name"] });
    mount({ templateSet: "prospect", templates: [...TEMPLATES, camp], campaignId: "camp-1", campaignLabel: "Sérum · clients 60–120 j", target: { lead_id: "l-1" } });
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Sérum · clients 60–120 j", "Relance"]);
  });

  it("previews the opt-out footer a marketing template carries", () => {
    const fu = tpl({ id: "fu", name: "ordra_prospect_follow_up_v1", catalogue_key: "prospect_follow_up", category: "MARKETING", body_text: "Relance {{1}}", variables: ["name"], footer_text: "Répondez STOP pour ne plus recevoir nos messages" });
    mount({ templateSet: "prospect", templates: [fu], target: { lead_id: "l-1" } });
    expect(screen.getByTestId("whatsapp-preview")).toHaveTextContent("Relance Amel Répondez STOP pour ne plus recevoir nos messages");
  });

  describe("sheet variant (the /delivery and prospects sheet)", () => {
    it("labels the two blocks, counts the rendered text, and sends with a full-width button", async () => {
      const onClose = vi.fn();
      mount({ variant: "sheet", logDeliveryAction: true, onClose });
      expect(screen.getByText("Choisir le modèle")).toBeInTheDocument();
      expect(screen.getByText("Texte du message")).toBeInTheDocument();
      const rendered = screen.getByTestId("whatsapp-preview").textContent ?? "";
      expect(screen.getByText(`${rendered.length} / 1000`)).toBeInTheDocument();
      // Nothing claims to be recorded before anything was sent.
      expect(screen.queryByText("Consigné dans la fiche · statut mis à jour en direct")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
      expect(await screen.findByText("Consigné dans la fiche · statut mis à jour en direct")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
      expect(onClose).toHaveBeenCalled();
    });

    it("not connected: a full-width « Ouvrir WhatsApp » link under the banner", () => {
      mount({ variant: "sheet", thread: thread({ config_active: false, config_status: null }), fallbackHref: "https://wa.me/21698765432" });
      const link = screen.getByRole("link", { name: /Ouvrir WhatsApp/ });
      expect(link).toHaveAttribute("href", "https://wa.me/21698765432");
      expect(link).toHaveAttribute("target", "_blank");
    });
  });
});
