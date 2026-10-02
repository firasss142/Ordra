import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown>, locale: "fr" }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => intl.locale,
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { TemplatesTable } from "../TemplatesTable";

/**
 * Modèles — prototypes/whatsapp-manager-v1.html?screen=modeles. What a
 * super_admin must be able to do: see what Meta approved, map an event, read a
 * rejection reason and the exact JSON that was sent, resubmit, delete. A
 * market_manager reads all of it and changes none of it.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const MARKETS = [
  { id: TN, name: "Tunisie", code: "tn" },
  { id: LY, name: "Libye", code: "ly" },
];

const ROWS = [
  { id: "t1", market_id: TN, name: "ordra_shipped_v1", language: "fr", category: "UTILITY", status: "APPROVED", rejected_reason: null, components: [{ type: "BODY", text: "Bonjour {{1}}, colis avec {{2}}. Suivi {{3}}. Montant {{4}}." }], body_text: "Bonjour {{1}}, colis avec {{2}}. Suivi {{3}}. Montant {{4}}.", header_format: null, footer_text: null, variables: ["name", "carrier", "tracking", "amount"], event_key: "shipped", catalogue_key: "shipped", source: "catalogue", campaign_id: null, campaign_name: null, synced_at: new Date(Date.now() - 4 * 60_000).toISOString() },
  { id: "t2", market_id: TN, name: "ordra_delivered_v1", language: "ar", category: "UTILITY", status: "REJECTED", rejected_reason: "INVALID_FORMAT", components: [{ type: "BODY", text: "مرحباً {{1}}، تم تسليم طلبك." }], body_text: "مرحباً {{1}}، تم تسليم طلبك.", header_format: null, footer_text: null, variables: ["name"], event_key: null, catalogue_key: "delivered", source: "catalogue", campaign_id: null, campaign_name: null, synced_at: null },
  { id: "t3", market_id: TN, name: "ordra_product_share_v1", language: "fr", category: "MARKETING", status: "PENDING", rejected_reason: null, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Bonjour {{1}}, voici {{2}} à {{3}}." }, { type: "FOOTER", text: "Répondez STOP pour ne plus recevoir nos messages." }], body_text: "Bonjour {{1}}, voici {{2}} à {{3}}.", header_format: "IMAGE", footer_text: "Répondez STOP pour ne plus recevoir nos messages.", variables: ["name", "product", "amount"], event_key: null, catalogue_key: "product_share", source: "catalogue", campaign_id: null, campaign_name: null, synced_at: null },
  { id: "t4", market_id: TN, name: "ordra_camp_serum_260925", language: "ar", category: "MARKETING", status: "PENDING", rejected_reason: null, components: [], body_text: "x {{1}}", header_format: null, footer_text: null, variables: ["name"], event_key: null, catalogue_key: null, source: "campaign", campaign_id: "camp-1", campaign_name: "Sérum · clients 60–120 j", synced_at: null },
];
const LY_ROWS = [{ ...ROWS[0], id: "l1", market_id: LY, name: "ordra_last_chance_v1", language: "ar" }];

const mutate = vi.fn();
let connected: Record<string, boolean | undefined> = {};
function mockRows(byMarket: Record<string, unknown[]>) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
    if (key && key.startsWith("/api/whatsapp/templates?market_id=")) {
      const id = key.split("=")[1];
      return { data: { data: byMarket[id] ?? [] }, mutate, isLoading: false };
    }
    if (key && key.startsWith("/api/whatsapp/availability?market_id=")) {
      const id = key.split("=")[1];
      if (connected[id] === undefined) return { data: undefined, isLoading: true };
      return { data: { data: { market_id: id, connected: connected[id], active: connected[id], status: connected[id] ? "active" : null, display_phone: null, verified_name: connected[id] ? "Ordra Tunisie" : null, messaging_limit_tier: null, quality_rating: null } }, isLoading: false };
    }
    return { data: undefined, mutate: vi.fn() };
  });
}

function mount(props: Partial<React.ComponentProps<typeof TemplatesTable>> = {}) {
  return render(
    <ToastProvider>
      <TemplatesTable markets={MARKETS} initialMarketId={TN} canDelete connectionsHref="/fr/system/settings/whatsapp" {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  intl.messages = frMessages as Record<string, unknown>;
  intl.locale = "fr";
  connected = { [TN]: true, [LY]: true };
  mockRows({ [TN]: ROWS, [LY]: LY_ROWS });
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
});

describe("TemplatesTable", () => {
  it("lists the market's templates with language, category, status, event, variables", () => {
    mount();
    const row = screen.getByText("ordra_shipped_v1").closest("tr")!;
    expect(within(row).getByText("Français")).toBeInTheDocument();
    expect(within(row).getByText("Utilitaire")).toBeInTheDocument();
    expect(within(row).getByText("Approuvé")).toBeInTheDocument();
    expect(within(row).getByRole("combobox")).toHaveValue("shipped");
    expect(within(row).getByText("nom, transporteur, suivi, montant")).toBeInTheDocument();
    const rej = screen.getByText("ordra_delivered_v1").closest("tr")!;
    expect(within(rej).getByText("Refusé")).toBeInTheDocument();
  });

  it("names the campaign a campaign template belongs to", () => {
    mount();
    const camp = screen.getByText("ordra_camp_serum_260925").closest("tr")!;
    expect(within(camp).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(camp).getByText("Campagne · Sérum · clients 60–120 j")).toBeInTheDocument();
  });

  it("switches market with a count on each pill, the active one pressed", async () => {
    mount();
    const group = screen.getByRole("group", { name: "Marché" });
    const tn = within(group).getByRole("button", { name: /Tunisie/ });
    const ly = within(group).getByRole("button", { name: /Libye/ });
    expect(tn).toHaveAttribute("aria-pressed", "true");
    expect(tn).toHaveTextContent("4");
    expect(ly).toHaveTextContent("1");
    await userEvent.click(ly);
    expect(ly).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("ordra_last_chance_v1")).toBeInTheDocument();
    expect(screen.queryByText("ordra_shipped_v1")).not.toBeInTheDocument();
  });

  it("maps an event through PATCH and refreshes", async () => {
    mount();
    const rej = screen.getByText("ordra_delivered_v1").closest("tr")!;
    await userEvent.selectOptions(within(rej).getByRole("combobox"), "delivered");
    expect(global.fetch).toHaveBeenCalledWith("/api/whatsapp/templates/t2", expect.objectContaining({ method: "PATCH" }));
    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ event_key: "delivered" });
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });

  it("shows the server's reason when a mapping is refused", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "variables_mismatch", message: "Il manque carrier à ce modèle." }), { status: 400 }),
    );
    mount();
    const rej = screen.getByText("ordra_delivered_v1").closest("tr")!;
    await userEvent.selectOptions(within(rej).getByRole("combobox"), "shipped");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Il manque carrier/);
  });

  it("opens the overlay drawer: name · lang, status, rejection reason, phone preview, JSON, fix and delete", async () => {
    mount();
    await userEvent.click(screen.getByText("ordra_delivered_v1"));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByRole("heading", { name: "ordra_delivered_v1 · ar" })).toBeInTheDocument();
    expect(within(drawer).getByText("Refusé")).toBeInTheDocument();
    expect(within(drawer).getByText(/Motif de refus Meta/)).toBeInTheDocument();
    expect(within(drawer).getByText(/INVALID_FORMAT/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Composants envoyés à Meta/)).toBeInTheDocument();
    expect(within(drawer).getByText('"BODY"')).toBeInTheDocument();
    // The phone mock: sender, the variable name in place of {{1}}, the ticks.
    expect(within(drawer).getByText("Ordra Tunisie")).toBeInTheDocument();
    expect(within(drawer).getByText("nom")).toBeInTheDocument();
    expect(within(drawer).getByText(/✓✓/)).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Corriger et resoumettre (v2)" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("closes the drawer with its X and with Escape", async () => {
    mount();
    await userEvent.click(screen.getByText("ordra_delivered_v1"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("ordra_shipped_v1"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the drawer of a marketing template shows the image header and the STOP footer", async () => {
    mount();
    await userEvent.click(screen.getByText("ordra_product_share_v1"));
    const drawer = screen.getByRole("dialog");
    // Once in the rendered preview, once inside the JSON that was sent.
    expect(within(drawer).getAllByText(/Répondez STOP/)).toHaveLength(2);
    expect(within(drawer).getByTestId("wa-preview-image")).toBeInTheDocument();
    expect(within(drawer).getByText('"IMAGE"')).toBeInTheDocument();
  });

  it("Synchroniser and Créer les modèles Ordra POST with the market and toast the prototype's wording", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { total: 15, inserted: 2, updated: 13, deleted: 0 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { created: ["ordra_shipped_v1/ar", "ordra_delivered_v1/ar"], skipped: ["ordra_shipped_v1/fr"], failed: [] } }), { status: 200 }));
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Synchroniser depuis Meta/ }));
    expect(global.fetch).toHaveBeenCalledWith("/api/whatsapp/templates/sync", expect.objectContaining({ method: "POST", body: JSON.stringify({ market_id: TN }) }));
    expect(await screen.findByText("Synchronisé · 15 modèles, 13 mis à jour, 2 nouveaux")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Créer les modèles Ordra/ }));
    expect(global.fetch).toHaveBeenCalledWith("/api/whatsapp/templates/catalogue", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("2 modèles soumis à Meta · approbation en attente")).toBeInTheDocument();
  });

  it("puts the actions in the page's top bar when the page asks for them", () => {
    render(
      <ToastProvider>
        <TemplatesTable markets={MARKETS} initialMarketId={TN} renderHeader={(actions) => <header data-testid="top">{actions}</header>} />
      </ToastProvider>,
    );
    expect(within(screen.getByTestId("top")).getByRole("button", { name: /Synchroniser depuis Meta/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("top")).getByRole("button", { name: /Créer les modèles Ordra/ })).toBeInTheDocument();
  });

  it("read-only (market_manager): event selects disabled, no fix, no delete — sync and create stay, as in the prototype", async () => {
    mount({ markets: [MARKETS[0]], readOnly: true, canDelete: false });
    const row = screen.getByText("ordra_shipped_v1").closest("tr")!;
    expect(within(row).getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Synchroniser depuis Meta/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Marché" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("ordra_delivered_v1"));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: /Corriger et resoumettre/ })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  });

  it("not connected: the table stays, empty, with the reason — and the way to Connexions for a super_admin", () => {
    connected = { [TN]: false, [LY]: true };
    mockRows({ [TN]: [], [LY]: LY_ROWS });
    mount();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp n'est pas connecté pour ce marché/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir Réglages › WhatsApp" })).toHaveAttribute("href", "/fr/system/settings/whatsapp");
    expect(screen.getByRole("button", { name: /Synchroniser depuis Meta/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Créer les modèles Ordra/ })).toBeDisabled();
  });

  it("not connected, seen by a manager: the reason, no link", () => {
    connected = { [TN]: false };
    mockRows({ [TN]: [] });
    mount({ markets: [MARKETS[0]], readOnly: true, canDelete: false, connectionsHref: null });
    expect(screen.getByText(/Un administrateur relie le numéro/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Connexions/ })).not.toBeInTheDocument();
  });

  it("empty state points to the catalogue button", () => {
    mockRows({ [TN]: [], [LY]: [] });
    mount();
    expect(screen.getByText(/Aucun modèle pour ce marché/)).toBeInTheDocument();
  });

  it("speaks Arabic", () => {
    intl.messages = arMessages as Record<string, unknown>;
    intl.locale = "ar";
    mount();
    expect(screen.getByRole("columnheader", { name: "القالب" })).toBeInTheDocument();
    const row = screen.getByText("ordra_shipped_v1").closest("tr")!;
    expect(within(row).getByText("معتمد")).toBeInTheDocument();
    expect(within(row).getByText("خدمي")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مزامنة من Meta/ })).toBeInTheDocument();
  });
});
