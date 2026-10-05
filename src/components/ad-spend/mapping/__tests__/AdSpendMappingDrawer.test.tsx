import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { MappingTreeDTO, MappingVersionDTO, MappingPreviewDTO, CampaignNodeDTO, AdsetNodeDTO } from "@/lib/ad-spend/mapping-types";

const saveMapping = vi.fn();
const previewMapping = vi.fn();
const mutate = vi.fn();
let tree: MappingTreeDTO;

vi.mock("@/hooks/useAdSpendMapping", () => ({
  useAdSpendMapping: () => ({ tree, isLoading: false, error: null, mutate }),
  saveMapping: (body: unknown) => saveMapping(body),
  previewMapping: (body: unknown) => previewMapping(body),
}));

import { AdSpendMappingDrawer } from "../../AdSpendMappingDrawer";

/**
 * The drawer is where a person moves money between products' margins — and
 * investors' shares — so what it sends, and what it refuses to send, is the
 * behaviour under test. Names and figures are the real Libya ones; the flows
 * are the prototype's (prototypes/ad-spend-mapping-v2.html).
 */

const version = (over: Partial<MappingVersionDTO>): MappingVersionDTO => ({
  id: "v",
  external_adset_id: null,
  effective_from: null,
  kind: "products",
  split_mode: null,
  lines: [{ product_id: "L", share_pct: null }],
  created_by_name: "Super Admin",
  created_at: "2026-08-15T10:00:00Z",
  superseded_at: null,
  ...over,
});

const spend = {
  spend_window: 0,
  spend_life: 0,
  spend_unattributed: 0,
  results_window: 0,
  first_day: null,
  last_day: null,
  daily: [] as [string, number][],
};

const adset = (over: Partial<AdsetNodeDTO>): AdsetNodeDTO => ({
  id: "S",
  name: "Ad Set",
  status: "CAMPAIGN_PAUSED",
  created_time: null,
  ...spend,
  versions: [],
  own_current_id: null,
  ...over,
});

const campaign = (over: Partial<CampaignNodeDTO>): CampaignNodeDTO => ({
  id: "C",
  ad_account_id: "act",
  name: "Campaign",
  objective: "OUTCOME_SALES",
  status: "PAUSED",
  created_time: null,
  ...spend,
  spend_by_product: {},
  versions: [],
  current_id: null,
  adsets: [adset({})],
  ...over,
});

function makeTree(): MappingTreeDTO {
  return {
    accounts: [
      { ad_account_id: "act", account_name: "Totella AdAccount 5", currency: "USD", fx_rate: 8.4, timezone: "Africa/Tunis", last_synced_at: null, history_from: "2026-05-23" },
    ],
    window: { from: "2026-05-23", to: "2026-10-01" },
    campaigns: [
      campaign({
        id: "C-RELAUNCH", name: "BoxLyLong - relaunch",
        spend_life: 16696, first_day: "2026-07-06", last_day: "2026-09-04",
        daily: [["2026-07-06", 227], ["2026-08-05", 869], ["2026-09-04", 127]],
        versions: [version({ id: "v-l" })], current_id: "v-l", spend_by_product: { L: 16696 },
        adsets: [adset({ id: "S-R", name: "BoxLyLong relaunch", spend_life: 16696 })],
      }),
      campaign({
        id: "C-Q", name: "QuranTadabr", status: "ACTIVE",
        spend_life: 18540, first_day: "2026-06-18", last_day: "2026-09-29", daily: [["2026-09-28", 480]],
        versions: [version({ id: "v-q", lines: [{ product_id: "Q", share_pct: null }] })], current_id: "v-q", spend_by_product: { Q: 18540 },
        adsets: [
          adset({ id: "S-B2", name: "QuranTadabr Ad Set 2- batch 2", status: "ACTIVE", spend_life: 5691 }),
          adset({ id: "S-B1", name: "QuranTadabr Ad Set 1- batch 1", status: "ACTIVE", spend_life: 7700 }),
          adset({ id: "S-B0", name: "QuranTadabr Ad Set", spend_life: 5149 }),
        ],
      }),
      campaign({
        id: "C-HERO", name: "BoxheroLY - LY", spend_life: 519, spend_unattributed: 519, first_day: "2026-06-23", last_day: "2026-06-25",
        adsets: [adset({ id: "S-H", name: "BOXHERO LY - ADSET 1", spend_life: 519 })],
      }),
      campaign({ id: "C-HERO2", name: "BoxheroLY", spend_life: 23, spend_unattributed: 23, first_day: "2026-06-23", last_day: "2026-06-23" }),
      campaign({ id: "C-PETS", name: "Pets Glove test" }),
    ],
    products: [
      { id: "Q", name: "القرآن تدبر وعمل", sku: "qr-01", image_url: null, is_active: true, orders_30d: 573 },
      { id: "M", name: "دميه ملاكمه حجم متوسط", sku: null, image_url: null, is_active: true, orders_30d: 90 },
      { id: "L", name: "دميه ملاكمه حجم كبير", sku: null, image_url: null, is_active: true, orders_30d: 21 },
      { id: "S", name: "دميه ملاكمه حجم صغير", sku: "box-wafra-shop", image_url: null, is_active: true, orders_30d: 0 },
      { id: "T", name: "مصحف التهجد و قيام الليل", sku: "th-01", image_url: null, is_active: true, orders_30d: 176 },
    ],
    coverage: {
      window: { total: 35778, attributed: 35236, market_level: 0, unmapped: 542 },
      life: { total: 35778, attributed: 35236, market_level: 0, unmapped: 542 },
      life_from: "2026-05-23",
    },
  };
}

const preview = (over: Partial<MappingPreviewDTO> = {}): MappingPreviewDTO => ({
  range: { since: "2026-07-06", until: "2026-10-01" },
  clamped: false,
  history_from: "2026-05-23",
  days: 40,
  moved: 13839,
  products: [
    { product_id: "M", bucket: "product", before: 0, after: 10544 },
    { product_id: "S", bucket: "product", before: 0, after: 3295 },
    { product_id: "L", bucket: "product", before: 16696, after: 2857 },
  ],
  shares: [],
  statements: [],
  ...over,
});

const props = {
  marketId: "ly",
  currency: "LYD",
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

function open(extra: Partial<React.ComponentProps<typeof AdSpendMappingDrawer>> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="UTC">
      <AdSpendMappingDrawer {...props} {...extra} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  tree = makeTree();
  saveMapping.mockReset();
  previewMapping.mockReset().mockResolvedValue(preview());
  props.onSaved.mockReset();
  props.onClose.mockReset();
});

const list = () => screen.getByRole("region", { name: "Campagnes" });
const detail = (name: string) => screen.getByRole("region", { name });
const saveButton = () => screen.getByRole("button", { name: "Enregistrer" });
/** The editor's footer: what the click will do, then the click. */
const footer = () => saveButton().parentElement!;

describe("opening", () => {
  it("says, in one sentence over the whole history, how much waits for a product", () => {
    open();
    expect(screen.getByText(/dépensés par/)).toHaveTextContent(
      "542 LYD dépensés par 2 campagnes ne comptent dans la marge d'aucun produit.",
    );
    expect(screen.getByText("98,4 % sur des produits")).toBeInTheDocument();
  });

  it("opens on the campaign with the most money waiting — never on an empty pane", () => {
    open();
    const pane = detail("BoxheroLY - LY");
    expect(within(pane).getByText("Ses 519 LYD ne comptent dans la marge d'aucun produit : seul le P&L du marché les porte.")).toBeInTheDocument();
    expect(within(pane).getByRole("button", { name: "Choisir le produit" })).toBeInTheDocument();
  });

  it("opens straight on a campaign when the page asks for one", () => {
    open({ focusCampaignId: "C-Q" });
    expect(detail("QuranTadabr")).toBeInTheDocument();
  });

  it("holds the page's other warning too: products with no attributed spend, and the backfill", async () => {
    const onBackfill = vi.fn();
    open({ coverage: { count: 1, fromDate: "2026-07-14", onBackfill } });
    expect(screen.getByText(/dépensés par/)).toBeInTheDocument();
    expect(screen.getByText(/1 produit\(s\) sans dépense attribuée/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Récupérer depuis le 14 juil." }));
    expect(onBackfill).toHaveBeenCalled();
  });

  it("says when everything that spent is attributed", () => {
    tree.coverage.life = { total: 35778, attributed: 35236, market_level: 542, unmapped: 0 };
    for (const c of tree.campaigns) c.spend_unattributed = 0;
    open();
    expect(screen.getByText(/Chaque campagne qui a dépensé est attribuée\./)).toHaveTextContent("542 LYD comptés en dépense générale.");
  });
});

describe("the list — groups, one amount, search", () => {
  it("groups by state, and counts only the campaigns with money waiting", () => {
    open();
    const l = list();
    const todo = within(l).getByText("À attribuer").parentElement!;
    expect(todo).toHaveTextContent("2");
    expect(within(l).getByText("En cours")).toBeInTheDocument();
    expect(within(l).getByText("En pause")).toBeInTheDocument();
    // Pets Glove never spent a dinar: not work, folded away.
    expect(within(l).queryByText("Pets Glove test")).not.toBeInTheDocument();
  });

  it("shows one amount per row: spent since tracking began", () => {
    open();
    const row = within(list()).getByRole("button", { name: /BoxLyLong - relaunch/ });
    expect(row).toHaveTextContent("16 696");
    expect(row).toHaveTextContent("دميه ملاكمه حجم كبير");
    expect(screen.getByText("Dépensé depuis le 23 mai")).toBeInTheDocument();
  });

  it("unfolds the campaigns that never ran", async () => {
    open();
    await userEvent.click(within(list()).getByRole("button", { name: "1 campagne jamais diffusée" }));
    expect(within(list()).getByText("Pets Glove test")).toBeInTheDocument();
  });

  it("finds a campaign by one of its ad sets", async () => {
    open();
    await userEvent.type(screen.getByRole("searchbox"), "batch 2");
    expect(within(list()).getByText("QuranTadabr")).toBeInTheDocument();
    expect(within(list()).queryByText("BoxLyLong - relaunch")).not.toBeInTheDocument();
  });
});

describe("the detail — what it sells, nothing else", () => {
  it("says what it sells, when it spent, and keeps analysis on the page", () => {
    open({ focusCampaignId: "C-RELAUNCH" });
    const pane = detail("BoxLyLong - relaunch");
    expect(within(pane).getByText(/dépensés du/)).toHaveTextContent("16 696 LYD dépensés du 6 juil. au 4 sept.");
    expect(within(pane).getByText("Ce qu'elle vend")).toBeInTheDocument();
    expect(within(pane).getByText("دميه ملاكمه حجم كبير")).toBeInTheDocument();
    expect(within(pane).queryByText(/Achats Meta/)).not.toBeInTheDocument();
    // One ad set: nothing to say about ad sets.
    expect(within(pane).queryByText("Ensembles de publicités")).not.toBeInTheDocument();
  });

  it("lists the ad sets only when there are several, each following its campaign", () => {
    open({ focusCampaignId: "C-Q" });
    const pane = detail("QuranTadabr");
    expect(within(pane).getByText("Ensembles de publicités")).toBeInTheDocument();
    expect(within(pane).getAllByText("Même produit que la campagne")).toHaveLength(3);
    expect(within(pane).getAllByRole("button", { name: "Attribuer à part" })).toHaveLength(3);
  });

  it("keeps the history behind a link", async () => {
    tree.campaigns[0].versions.push(version({ id: "old", lines: [{ product_id: "M", share_pct: null }], created_at: "2026-07-01T10:00:00Z", superseded_at: "2026-08-15T10:00:00Z" }));
    open({ focusCampaignId: "C-RELAUNCH" });
    const pane = detail("BoxLyLong - relaunch");
    expect(within(pane).queryByText("En vigueur")).not.toBeInTheDocument();
    await userEvent.click(within(pane).getByRole("button", { name: "Historique (2)" }));
    expect(within(pane).getByText("En vigueur")).toBeInTheDocument();
  });
});

describe("the editor", () => {
  async function editRelaunch() {
    open({ focusCampaignId: "C-RELAUNCH" });
    await userEvent.click(within(detail("BoxLyLong - relaunch")).getByRole("button", { name: "Modifier" }));
  }
  async function addProduct(name: string) {
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un produit" }));
    await userEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
  }

  it("keeps Enregistrer grey while nothing differs, and says why", async () => {
    await editRelaunch();
    expect(saveButton()).toBeDisabled();
    expect(footer()).toHaveTextContent("Aucun changement pour l'instant.");
    expect(previewMapping).not.toHaveBeenCalled();
  });

  it("previews, then saves exactly the draft — three products, by orders, from the beginning", async () => {
    saveMapping.mockResolvedValue({ id: "new", rows_rewritten: 90, pending_rebuild: false, preview: preview() });
    await editRelaunch();
    await addProduct("حجم متوسط");
    await addProduct("حجم صغير");

    await waitFor(() => expect(previewMapping).toHaveBeenCalled());
    await waitFor(() => expect(footer()).toHaveTextContent("13 839 LYD changent de produit."));
    expect(screen.getByText("Ce qui va changer")).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await userEvent.click(saveButton());
    await waitFor(() => expect(saveMapping).toHaveBeenCalledTimes(1));
    expect(saveMapping.mock.calls[0][0]).toEqual({
      market_id: "ly",
      ad_account_id: "act",
      campaign_id: "C-RELAUNCH",
      adset_id: null,
      kind: "products",
      split_mode: "auto_orders",
      lines: [
        { product_id: "L", share_pct: null },
        { product_id: "M", share_pct: null },
        { product_id: "S", share_pct: null },
      ],
      effective_from: null,
    });
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent("Enregistré · 13 839 LYD ont changé de produit");
  });

  it("keeps Enregistrer disabled while fixed percentages do not make 100", async () => {
    await editRelaunch();
    await addProduct("حجم متوسط");
    await userEvent.click(screen.getByRole("radio", { name: "Pourcentages fixes" }));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "60" } });
    fireEvent.change(inputs[1], { target: { value: "30" } });
    expect(footer()).toHaveTextContent("Il manque 10 %");
    expect(saveButton()).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Parts égales" }));
    expect(screen.getByText("Total 100 %")).toBeInTheDocument();
  });

  it("names a settled investor statement and offers to start after it", async () => {
    previewMapping.mockResolvedValue(
      preview({ statements: [{ product_id: "S", sequence_no: 1, period_start: "2026-05-20", period_end: "2026-07-31", settled: true, delta: 227.47 }] }),
    );
    await editRelaunch();
    await addProduct("حجم صغير");

    expect(await screen.findByText("Relevé investisseur déjà payé")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Commencer au 1ᵉʳ août" }));
    expect(screen.getByRole("radio", { name: /À partir d'une date/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("À partir d'une date")).toHaveValue("2026-08-01");
  });

  it("a campaign with no product opens the product list straight away", async () => {
    open();
    await userEvent.click(within(detail("BoxheroLY - LY")).getByRole("button", { name: "Choisir le produit" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("can count a campaign as general spend instead", async () => {
    saveMapping.mockResolvedValue({ id: "g", rows_rewritten: 3, pending_rebuild: false, preview: preview({ moved: 519 }) });
    previewMapping.mockResolvedValue(
      preview({ moved: 519, products: [{ product_id: null, bucket: "general", before: 0, after: 519 }, { product_id: null, bucket: "none", before: 519, after: 0 }] }),
    );
    open();
    await userEvent.click(within(detail("BoxheroLY - LY")).getByRole("button", { name: "Choisir le produit" }));
    await userEvent.click(screen.getByRole("button", { name: "Compter en dépense générale" }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    const impact = screen.getByText("Ce qui va changer").parentElement!;
    expect(impact).toHaveTextContent("Dépense générale");
    expect(impact).toHaveTextContent("Sans produit");
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveMapping).toHaveBeenCalled());
    expect(saveMapping.mock.calls[0][0]).toMatchObject({ campaign_id: "C-HERO", kind: "market_level", lines: [], effective_from: null });
  });

  it("'Attribuer à part' starts from the campaign's products, so adding one is enough", async () => {
    saveMapping.mockResolvedValue({ id: "x", rows_rewritten: 0, pending_rebuild: false, preview: preview() });
    open({ focusCampaignId: "C-Q" });
    const row = within(detail("QuranTadabr")).getByText("QuranTadabr Ad Set 2- batch 2").closest("div[data-adset]")!;
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "Attribuer à part" }));
    expect(screen.getByRole("switch", { name: /Vend la même chose que sa campagne/ })).toHaveAttribute("aria-checked", "false");
    await addProduct("مصحف التهجد");
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveMapping).toHaveBeenCalled());
    expect(saveMapping.mock.calls[0][0]).toMatchObject({
      adset_id: "S-B2",
      kind: "products",
      split_mode: "auto_orders",
      lines: [{ product_id: "Q", share_pct: null }, { product_id: "T", share_pct: null }],
    });
  });

  it("lets an ad set go back to its campaign with one switch", async () => {
    saveMapping.mockResolvedValue({ id: "x", rows_rewritten: 0, pending_rebuild: false, preview: preview({ moved: 0, products: [] }) });
    previewMapping.mockResolvedValue(preview({ moved: 0, products: [] }));
    const b2 = tree.campaigns[1].adsets[0];
    b2.versions = [version({ id: "own", external_adset_id: "S-B2", lines: [{ product_id: "T", share_pct: null }] })];
    b2.own_current_id = "own";
    open({ focusCampaignId: "C-Q" });
    const row = within(detail("QuranTadabr")).getByText("QuranTadabr Ad Set 2- batch 2").closest("div[data-adset]")!;
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "Modifier" }));
    await userEvent.click(screen.getByRole("switch", { name: /Vend la même chose que sa campagne/ }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveMapping).toHaveBeenCalled());
    expect(saveMapping.mock.calls[0][0]).toMatchObject({ adset_id: "S-B2", kind: "inherit", lines: [], split_mode: null });
  });

  it("Escape leaves the editor, not the drawer — a half-made change is not lost to a reflex", async () => {
    await editRelaunch();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    expect(within(detail("BoxLyLong - relaunch")).getByText("Ce qu'elle vend")).toBeInTheDocument();
  });
});
