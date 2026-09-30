import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ConsoleView, type ConsoleViewProps } from "../ConsoleView";
import type { CampaignResult, CampaignWhatsApp, ConsoleMetrics } from "@/lib/prospects/console";
import type { AudiencePreview } from "@/lib/prospects/audience";

/**
 * The business-number campaign, end to end on the console: submit → the sheet
 * stays and shows what happens next; approval or refusal while the page is
 * open is announced; « Modifier et resoumettre » reopens the sheet on Canal;
 * « Lancer » shows the plan before sending.
 * Prototype: whatsapp-manager-v1.html?screen=campagne&tstatus=pending|approved|rejected.
 */
const NOW = Date.parse("2026-09-25T06:00:00Z"); // 08:00 in Tripoli
const METRICS: ConsoleMetrics = {
  new_7d: 0, new_prev_7d: 0, hot_waiting: 0, oldest_hot_minutes: null, median_first_contact_minutes: null, median_first_contact_prev: null,
  converted_30d: 0, delivered_30d: 0, delivered_revenue_30d: 0, pool: 0, pool_campaigns: 0, pool_oldest_days: null, never_called: 0,
  total: 0, late_callbacks: 0, lost_30d: 0, calls_today: 0, reached_today: 0, oldest_hot_agent: null,
};
const PREVIEW: AudiencePreview = { matched: 420, excluded: { openLead: 8, recentlyOrdered: 0, recentCampaign: 0, lostNotInterested: 0 }, net: 412, sample: [] };

const camp = (w: Partial<CampaignWhatsApp>): CampaignResult => ({
  id: "c1", name: "Sérum", offer: "−15 %", audience: 0, called: 0, converted: 0, revenue: 0, created_at: "2026-09-25T05:00:00Z", channel: "wa", pool: 0,
  whatsapp: {
    launch_status: "pending_template", language: "fr", template_status: "PENDING", template_name: "ordra_camp_serum_260925", template_rejected_reason: null,
    queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0, rate: 60, window: "10-20",
    status_at: new Date(NOW - 5 * 60_000).toISOString(), message: "Bonjour {nom}, votre {produit} vous attend.", image_url: null,
    filter: { order_statuses: ["delivered"], period_mode: "preset", period_days: 90 }, ...w,
  },
});

function props(over: Partial<ConsoleViewProps> = {}): ConsoleViewProps {
  return {
    metrics: METRICS, funnel: { created: 0, pool: 0, assigned: 0, called: 0, reached: 0, conv: 0, deliv: 0 }, loss: {}, campaigns: [],
    agents: [{ id: "a1", name: "Tasnim", open_leads: 3, hot_waiting: 0, calls_today: 0, converted_today: 0, rate: null }],
    rows: [], total: 0, truncated: false, isLoading: false, error: false, onRetry: vi.fn(),
    filter: "all", onFilter: vi.fn(), agentId: null, onAgentFilter: vi.fn(), campaignId: null, onCampaignFilter: vi.fn(), query: "", onQuery: vi.fn(),
    products: [], cities: [], cap: 20,
    onPreviewDistribution: vi.fn().mockResolvedValue({ assignments: [], unassigned: 0 }), onDistribute: vi.fn(), onAssign: vi.fn(), onCloseLeads: vi.fn(),
    onReopen: vi.fn(), onSaveLead: vi.fn(), onPreviewAudience: vi.fn().mockResolvedValue(PREVIEW), onCreateCampaign: vi.fn(), onImportCsv: vi.fn(),
    whatsappActive: true, onLaunchCampaign: vi.fn(), onCheckCampaignStatus: vi.fn(), onResubmitCampaign: vi.fn(),
    marketCode: "ly", tz: "Africa/Tripoli", locale: "fr", now: NOW,
    ...over,
  };
}

const wrap = (p: ConsoleViewProps) => (
  <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli"><ConsoleView {...p} /></NextIntlClientProvider>
);

async function openCampaignsTab() {
  await userEvent.click(screen.getByRole("tab", { name: /Campagnes/ }));
}

describe("ConsoleView — a new campaign from the business number", () => {
  it("in Libya the template is written in Arabic by default", async () => {
    render(wrap(props()));
    await userEvent.click(screen.getByRole("button", { name: /Nouvelle campagne/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuer" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Continuer" }));
    await userEvent.click(screen.getByRole("radio", { name: /Depuis le numéro Ordra/ }));
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
  });

  it("in Tunisia, in French", async () => {
    render(wrap(props({ marketCode: "tn", tz: "Africa/Tunis" })));
    await userEvent.click(screen.getByRole("button", { name: /Nouvelle campagne/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuer" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Continuer" }));
    await userEvent.click(screen.getByRole("radio", { name: /Depuis le numéro Ordra/ }));
    expect(screen.getByRole("button", { name: "Français" })).toHaveAttribute("aria-pressed", "true");
  });

  it("« Soumettre le modèle à Meta » keeps the sheet open on Canal, showing the pending banner; « Vérifier le statut » answers in words", async () => {
    const onCreateCampaign = vi.fn().mockResolvedValue({ id: "c-new", inserted: 0, wa_launch_status: "pending_template", template_name: "ordra_camp_serum_260925", template_status: "PENDING" });
    const onCheckCampaignStatus = vi.fn().mockResolvedValue({ template_status: "PENDING" });
    render(wrap(props({ onCreateCampaign, onCheckCampaignStatus })));
    await userEvent.click(screen.getByRole("button", { name: /Nouvelle campagne/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuer" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Continuer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nom de la campagne" }), { target: { value: "Sérum" } });
    await userEvent.click(screen.getByRole("radio", { name: /Depuis le numéro Ordra/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Corps du message (modèle marketing)" }), { target: { value: "مرحباً {nom}، {produit} اليوم." } });
    await userEvent.click(screen.getByRole("button", { name: "Continuer" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Tasnim/ }));
    await userEvent.click(screen.getByRole("button", { name: "Soumettre le modèle à Meta" }));

    const banner = await screen.findByTestId("wa-template-banner");
    expect(onCreateCampaign).toHaveBeenCalledWith(expect.objectContaining({ waSender: "api", waLanguage: "ar" }));
    expect(banner).toHaveTextContent("En attente d'approbation Meta");
    expect(banner).toHaveTextContent("ordra_camp_serum_260925");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lancer la campagne/ })).toBeDisabled();

    await userEvent.click(within(banner).getByRole("button", { name: /Vérifier le statut/ }));
    expect(onCheckCampaignStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "c-new" }));
    expect(await screen.findByText("Toujours en attente chez Meta")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ConsoleView — Meta answers while the page is open", () => {
  it("an approval is announced, once, and the first load announces nothing", () => {
    const { rerender } = render(wrap(props({ campaigns: [camp({})] })));
    expect(screen.queryByText(/modèle approuvé/)).not.toBeInTheDocument();
    rerender(wrap(props({ campaigns: [camp({ launch_status: "ready", template_status: "APPROVED" })] })));
    expect(screen.getByText("« Sérum » : modèle approuvé, la campagne peut partir")).toBeInTheDocument();
  });

  it("a refusal too", () => {
    const { rerender } = render(wrap(props({ campaigns: [camp({})] })));
    rerender(wrap(props({ campaigns: [camp({ launch_status: "rejected", template_status: "REJECTED", template_rejected_reason: "INVALID_FORMAT" })] })));
    expect(screen.getByText("« Sérum » : modèle refusé par Meta")).toBeInTheDocument();
  });

  it("the open sheet follows the campaign: pending turns into approved with its plan", async () => {
    const onCreateCampaign = vi.fn().mockResolvedValue({ id: "c1", inserted: 0, wa_launch_status: "pending_template", template_name: "ordra_camp_serum_260925", template_status: "PENDING" });
    const { rerender } = render(wrap(props({ onCreateCampaign, campaigns: [camp({ launch_status: "rejected", template_status: "REJECTED" })] })));
    await openCampaignsTab();
    await userEvent.click(screen.getByRole("button", { name: /Modifier et resoumettre/ }));
    rerender(wrap(props({ onCreateCampaign, campaigns: [camp({ launch_status: "ready", template_status: "APPROVED", status_at: new Date(NOW - 60_000).toISOString() })] })));
    await waitFor(() => expect(screen.getByTestId("wa-template-banner")).toHaveTextContent("Modèle approuvé il y a 1 min"));
    await waitFor(() => expect(screen.getByTestId("wa-campaign-summary")).toHaveTextContent("412"));
  });
});

describe("ConsoleView — « Modifier et resoumettre »", () => {
  it("reopens the sheet on Canal with the stored text; resubmitting sends the correction and stays on the pending banner", async () => {
    const rejected = camp({ launch_status: "rejected", template_status: "REJECTED", template_rejected_reason: "INVALID_FORMAT — le corps se termine par une variable.", message: "Bonjour, voici {produit}" });
    const onResubmitCampaign = vi.fn().mockResolvedValue({ template_name: "ordra_camp_serum_260925_v2" });
    render(wrap(props({ campaigns: [rejected], onResubmitCampaign })));
    await openCampaignsTab();
    await userEvent.click(screen.getByRole("button", { name: /Modifier et resoumettre/ }));

    const dialog = screen.getByRole("dialog");
    const body = within(dialog).getByRole("textbox", { name: "Corps du message (modèle marketing)" });
    expect(body).toHaveValue("Bonjour, voici {produit}");
    expect(within(dialog).getByTestId("wa-template-banner")).toHaveTextContent("INVALID_FORMAT");
    expect(within(dialog).getByRole("button", { name: /Modifier et resoumettre/ })).toBeDisabled();

    fireEvent.change(body, { target: { value: "Bonjour {nom}, voici {produit} à prix doux." } });
    await userEvent.click(within(dialog).getByRole("button", { name: /Modifier et resoumettre/ }));

    expect(onResubmitCampaign).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), {
      wa_message: "Bonjour {nom}, voici {produit} à prix doux.", wa_language: "fr", wa_image_url: null, wa_window: "10-20", wa_rate: 60,
    });
    await waitFor(() => expect(within(dialog).getByTestId("wa-template-banner")).toHaveTextContent("En attente d'approbation Meta"));
    expect(within(dialog).getByTestId("wa-template-banner")).toHaveTextContent("ordra_camp_serum_260925_v2");
  });
});

describe("ConsoleView — « Lancer la campagne »", () => {
  it("from a ready card, the sheet shows the plan first; launching closes it with the count queued", async () => {
    const onLaunchCampaign = vi.fn().mockResolvedValue({ queued: 400 });
    render(wrap(props({ campaigns: [camp({ launch_status: "ready", template_status: "APPROVED" })], onLaunchCampaign })));
    await openCampaignsTab();
    await userEvent.click(screen.getByRole("button", { name: /Lancer la campagne/ }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByTestId("wa-campaign-summary")).toHaveTextContent("412"));
    expect(onLaunchCampaign).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: /Lancer la campagne/ }));
    expect(onLaunchCampaign).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Campagne lancée · 400 messages en file")).toBeInTheDocument();
  });
});
