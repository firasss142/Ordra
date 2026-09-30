import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { CampaignSheet, type CampaignDraft } from "../CampaignSheet";
import { conditionsOf } from "@/lib/prospects/audience";
import type { CampaignResult, CampaignWhatsApp } from "@/lib/prospects/console";

/** Prototype: whatsapp-manager-v1.html?screen=campagne&tstatus=pending|approved|rejected (the sheet at step Canal). */
const NOW = Date.parse("2026-09-25T06:00:00Z"); // 08:00 in Tripoli, before a 10-20 window
const draft = (over: Partial<CampaignDraft> = {}): CampaignDraft => ({
  step: 2, template: "rebuy", conditions: conditionsOf("rebuy", NOW), name: "Sérum · clients 60–120 j", offer: "−15 %",
  channel: "wa", waMessage: "Bonjour {nom}, {produit} à {remise} aujourd'hui.", waImage: false, waSender: "api", waLanguage: "fr", waImageUrl: "",
  waWindow: "10-20", waRate: 60, waFollowUpHours: 24, scriptFr: "", scriptAr: "", agentIds: [], cap: 20, ...over,
});
const SERUM = { id: "p-serum", name: "Sérum vitamine C — 50 ml", image_url: "https://cdn.example/serum.jpg" };
const WATCH = { id: "p-watch", name: "Montre X2", image_url: "https://cdn.example/x2.jpg" };

const followed = (w: Partial<CampaignWhatsApp>): CampaignResult => ({
  id: "c1", name: "Sérum · clients 60–120 j", offer: "−15 %", audience: 0, called: 0, converted: 0, revenue: 0, created_at: "2026-09-25T05:00:00Z", channel: "wa", pool: 0,
  whatsapp: {
    launch_status: "pending_template", language: "fr", template_status: "PENDING", template_name: "ordra_camp_serum_260925", template_rejected_reason: null,
    queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0, rate: 60, window: "10-20",
    status_at: new Date(NOW - 12 * 60_000).toISOString(), ...w,
  },
});

type Props = Parameters<typeof CampaignSheet>[0];
function mount(d: CampaignDraft, over: Partial<Props> = {}, lang: "fr" | "ar" = "fr") {
  const onDraft = vi.fn();
  render(
    <NextIntlClientProvider locale={lang} messages={lang === "fr" ? fr : ar}>
      <CampaignSheet
        draft={d} onDraft={onDraft} preview={{ matched: 420, excluded: { openLead: 8, recentlyOrdered: 0, recentCampaign: 0, lostNotInterested: 0 }, net: 412, sample: [] }}
        previewing={false} errors={[]} agents={[{ id: "a1", name: "Tasnim", open_leads: 3 }]} products={[]} cities={[]} busy={false} error={null}
        onConfirm={vi.fn()} onClose={vi.fn()} locale={lang} now={NOW} whatsappActive marketCode="ly" tz="Africa/Tripoli" {...over}
      />
    </NextIntlClientProvider>,
  );
  return { onDraft };
}

describe("CampaignSheet — the Canal step reads like the prototype", () => {
  it("each channel is its own button, named by its own words", () => {
    mount(draft());
    const group = screen.getByRole("group", { name: "Comment on les contacte" });
    expect(within(group).getByRole("button", { name: /^Appel/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: /^Message WhatsApp/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("steps are « Audience · Canal · Distribution »", () => {
    mount(draft());
    const dialog = screen.getByRole("dialog");
    for (const s of ["Audience", "Canal", "Distribution"]) expect(within(dialog).getByText(s)).toBeInTheDocument();
  });

  it("« Qui envoie » comes before the message body, with the prototype's two senders", () => {
    mount(draft());
    const who = screen.getByRole("radiogroup", { name: "Qui envoie" });
    const body = screen.getByRole("textbox", { name: "Corps du message (modèle marketing)" });
    expect(who.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(who).getByRole("radio", { name: /Depuis le téléphone de l'agent/ })).toBeInTheDocument();
    const api = within(who).getByRole("radio", { name: /Depuis le numéro Ordra/ });
    expect(api).toBeChecked();
    expect(api.closest("label")).toHaveTextContent("Connecté");
    expect(api.closest("label")).toHaveTextContent("Le message doit être un modèle approuvé par Meta.");
  });

  it("the prototype's field labels: Plage d'envoi, Cadence, Langue, and « Appeler si pas de réponse après … heures »", () => {
    mount(draft({ channel: "wa_call" }));
    expect(screen.getByRole("combobox", { name: "Plage d'envoi" })).toHaveValue("10-20");
    expect(screen.getByRole("spinbutton", { name: "Cadence" })).toHaveValue(60);
    expect(screen.getByRole("group", { name: "Langue" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Appeler si pas de réponse après" })).toHaveValue(24);
    expect(screen.getByText("heures")).toBeInTheDocument();
  });

  it("« Ce que le client verra »: sent by « Ordra Libye », sample values, the STOP footer, the « Oui » reply", () => {
    mount(draft());
    expect(screen.getByText("Ce que le client verra")).toBeInTheDocument();
    const preview = screen.getByTestId("wa-campaign-preview");
    expect(preview).toHaveTextContent("Bonjour Amel, Sérum vitamine C à -20 % aujourd'hui.");
    expect(preview).toHaveTextContent("Répondez STOP pour ne plus recevoir nos messages.");
    expect(screen.getByText("Ordra Libye")).toBeInTheDocument();
    expect(screen.getByText("Oui")).toBeInTheDocument();
    expect(screen.getByText("Une réponse ouvre la fenêtre de 24 h : l'agent peut alors écrire librement.")).toBeInTheDocument();
  });

  it("the sender shown is the number's own display name when Meta gave one", () => {
    mount(draft(), { whatsappName: "Ordra Libya" });
    expect(screen.getByText("Ordra Libya")).toBeInTheDocument();
  });

  it("an Arabic template gets the Arabic footer Meta will receive, whatever the screen language", () => {
    mount(draft({ waLanguage: "ar", waMessage: "مرحباً {nom}، {produit} اليوم." }));
    expect(screen.getByTestId("wa-campaign-preview")).toHaveTextContent("أرسل توقف لإيقاف رسائلنا.");
  });

  it("language toggle, the four variable chips, the counter", async () => {
    const { onDraft } = mount(draft());
    expect(screen.getByRole("button", { name: "Français" })).toHaveAttribute("aria-pressed", "true");
    for (const v of ["{nom}", "{produit}", "{ville}", "{remise}"]) expect(screen.getByRole("button", { name: v })).toBeInTheDocument();
    expect(screen.getByText(`${draft().waMessage.length} / 1024`)).toBeInTheDocument();
    await userEvent.click(screen.getByText("العربية", { selector: "button" }));
    expect(onDraft).toHaveBeenCalledWith({ waLanguage: "ar" });
  });

  it("warns live when the body ends with a variable, and blocks « Continuer »", () => {
    mount(draft({ waMessage: "Bonjour, voici {produit}" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Meta va refuser/);
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
  });

  it("the last step's button submits the template instead of creating and distributing", () => {
    mount(draft({ step: 3, agentIds: ["a1"] }));
    expect(screen.getByRole("button", { name: "Soumettre le modèle à Meta" })).toBeEnabled();
  });
});

describe("CampaignSheet — when the market is not connected", () => {
  it("the « numéro Ordra » option stays visible, disabled, and says why", () => {
    mount(draft({ waSender: "agent" }), { whatsappActive: false });
    const api = screen.getByRole("radio", { name: /Depuis le numéro Ordra/ });
    expect(api).toBeDisabled();
    expect(api.closest("label")).toHaveTextContent("Non connecté");
    expect(api.closest("label")).toHaveTextContent("WhatsApp n'est pas connecté pour ce marché.");
    expect(screen.queryByRole("link", { name: /Système › Connexions/ })).not.toBeInTheDocument();
  });

  it("a super_admin is pointed at Système › Connexions", () => {
    mount(draft({ waSender: "agent" }), { whatsappActive: false, canConnectWhatsApp: true });
    expect(screen.getByRole("link", { name: /Système › Connexions/ })).toHaveAttribute("href", "/fr/system/connections?tab=services");
  });
});

describe("CampaignSheet — « Image en en-tête »", () => {
  it("choosing the Ordra number preselects the campaign product's photo", async () => {
    const conditions = [...conditionsOf("rebuy", NOW), { kind: "product" as const, productIds: [SERUM.id] }];
    const { onDraft } = mount(draft({ waSender: "agent", waImage: true, conditions }), { products: [WATCH, SERUM] });
    await userEvent.click(screen.getByRole("radio", { name: /Depuis le numéro Ordra/ }));
    expect(onDraft).toHaveBeenCalledWith({ waSender: "api", waImageUrl: SERUM.image_url });
  });

  it("the picker shows the chosen product's photo, its name and « Changer »", async () => {
    const { onDraft } = mount(draft({ waImage: true, waImageUrl: SERUM.image_url }), { products: [SERUM, WATCH] });
    expect(screen.getByRole("switch", { name: /Image en en-tête/ })).toHaveAttribute("aria-checked", "true");
    const pick = screen.getByTestId("wa-image-pick");
    expect(within(pick).getByText(SERUM.name)).toBeInTheDocument();
    expect(pick.querySelector("img")).toHaveAttribute("src", SERUM.image_url);
    expect(screen.queryByRole("textbox", { name: /URL publique/ })).not.toBeInTheDocument();
    await userEvent.click(within(pick).getByRole("button", { name: "Changer" }));
    await userEvent.click(screen.getByRole("button", { name: WATCH.name }));
    expect(onDraft).toHaveBeenCalledWith({ waImageUrl: WATCH.image_url });
  });

  it("the header image appears in the preview", () => {
    mount(draft({ waImage: true, waImageUrl: SERUM.image_url }), { products: [SERUM] });
    expect(screen.getByTestId("wa-campaign-preview-image")).toHaveAttribute("src", SERUM.image_url);
  });

  it("turning the switch off removes the header", async () => {
    const { onDraft } = mount(draft({ waImage: true, waImageUrl: SERUM.image_url }), { products: [SERUM] });
    await userEvent.click(screen.getByRole("switch", { name: /Image en en-tête/ }));
    expect(onDraft).toHaveBeenCalledWith({ waImage: false });
  });

  it("with no product photo in the market, a public link is the fallback", () => {
    mount(draft({ waImage: true }), { products: [{ id: "p", name: "Sans photo", image_url: null }] });
    expect(screen.getByRole("textbox", { name: /URL publique de l'image/ })).toBeInTheDocument();
    expect(screen.getByText("Aucun produit de ce marché n'a de photo : collez un lien public.")).toBeInTheDocument();
  });
});

describe("CampaignSheet — following the template at Meta", () => {
  it("pending: « En attente d'approbation Meta », since when, a status check, launch not yet possible, nothing editable", async () => {
    const onCheckStatus = vi.fn();
    mount(draft(), { campaign: followed({}), onCheckStatus });
    expect(screen.getByRole("dialog", { name: "Sérum · clients 60–120 j" })).toBeInTheDocument();
    const banner = screen.getByTestId("wa-template-banner");
    expect(banner).toHaveTextContent("En attente d'approbation Meta");
    expect(banner).toHaveTextContent("Modèle « ordra_camp_serum_260925 » soumis il y a 12 min.");
    expect(banner).toHaveTextContent("vous serez prévenu ici");
    await userEvent.click(within(banner).getByRole("button", { name: /Vérifier le statut/ }));
    expect(onCheckStatus).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Lancer la campagne/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Corps du message (modèle marketing)" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Continuer" })).not.toBeInTheDocument();
  });

  it("approved: since when, the plan in words, the four-cell summary with the estimated end, and « Lancer »", async () => {
    const onLaunch = vi.fn();
    mount(draft(), { campaign: followed({ launch_status: "ready", template_status: "APPROVED", status_at: new Date(NOW - 3 * 60_000).toISOString() }), onLaunch });
    const banner = screen.getByTestId("wa-template-banner");
    expect(banner).toHaveTextContent("Modèle approuvé il y a 3 min");
    expect(banner).toHaveTextContent("La campagne peut partir. 412 prospects, 60 messages par heure entre 10 h et 20 h : dernier envoi vers 16:51 aujourd'hui.");
    const summary = screen.getByTestId("wa-campaign-summary");
    for (const [label, value] of [["Audience", "412"], ["Cadence", "60 / h"], ["Plage", "10 – 20 h"], ["Fin estimée", "16:51"]]) {
      expect(within(summary).getByText(label).parentElement).toHaveTextContent(value);
    }
    await userEvent.click(screen.getByRole("button", { name: /Lancer la campagne/ }));
    expect(onLaunch).toHaveBeenCalled();
  });

  it("rejected: Meta's reason, the next version, the body editable, the channel locked, « Modifier et resoumettre »", async () => {
    const onResubmit = vi.fn();
    const { onDraft } = mount(draft(), {
      campaign: followed({ launch_status: "rejected", template_status: "REJECTED", template_rejected_reason: "INVALID_FORMAT — le corps se termine par une variable." }),
      onResubmit,
    });
    const banner = screen.getByTestId("wa-template-banner");
    expect(banner).toHaveTextContent("Modèle refusé par Meta");
    expect(banner).toHaveTextContent("INVALID_FORMAT — le corps se termine par une variable. — corrigez le texte : une nouvelle version (v2) sera soumise.");
    const body = screen.getByRole("textbox", { name: "Corps du message (modèle marketing)" });
    expect(body).toBeEnabled();
    await userEvent.type(body, "!");
    expect(onDraft).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Message WhatsApp/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Depuis le téléphone de l'agent/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Modifier et resoumettre/ }));
    expect(onResubmit).toHaveBeenCalled();
  });

  it("a third attempt says v3", () => {
    mount(draft(), { campaign: followed({ launch_status: "rejected", template_status: "REJECTED", template_name: "ordra_camp_serum_260925_v2", template_rejected_reason: null }) });
    expect(screen.getByTestId("wa-template-banner")).toHaveTextContent("Meta n'a pas donné de motif — corrigez le texte : une nouvelle version (v3) sera soumise.");
  });

  it("resubmitting a body Meta would refuse again is not offered", () => {
    mount(draft({ waMessage: "Bonjour, voici {produit}" }), { campaign: followed({ launch_status: "rejected", template_status: "REJECTED" }), onResubmit: vi.fn() });
    expect(screen.getByRole("button", { name: /Modifier et resoumettre/ })).toBeDisabled();
  });

  it("Arabic: the banner and the summary are translated", () => {
    mount(draft({ waLanguage: "ar", waMessage: "مرحباً {nom}، {produit} اليوم." }), {
      campaign: followed({ launch_status: "ready", template_status: "APPROVED", status_at: new Date(NOW - 3 * 60_000).toISOString() }),
    }, "ar");
    expect(screen.getByTestId("wa-template-banner")).toHaveTextContent("اعتُمد القالب منذ 3 د");
    expect(within(screen.getByTestId("wa-campaign-summary")).getByText("الانتهاء المقدّر")).toBeInTheDocument();
  });
});
