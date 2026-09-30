import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MappingTreeDTO, MappingVersionDTO, MappingPreviewDTO } from "@/lib/ad-spend/mapping-types";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

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
 * behaviour under test. Names and figures are the real Libya ones.
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

const spend = (over: Partial<MappingTreeDTO["campaigns"][number]> = {}) => ({
  spend_window: 0,
  spend_life: 0,
  results_window: 0,
  first_day: null,
  last_day: null,
  daily: [] as [string, number][],
  ...over,
});

function makeTree(): MappingTreeDTO {
  return {
    accounts: [
      { ad_account_id: "act", account_name: "Totella AdAccount 5", currency: "USD", fx_rate: 8.4, timezone: "Africa/Tunis", last_synced_at: null, history_from: "2026-05-23" },
    ],
    window: { from: "2026-07-08", to: "2026-09-30" },
    campaigns: [
      {
        id: "C-RELAUNCH", ad_account_id: "act", name: "BoxLyLong - relaunch", objective: "OUTCOME_SALES", status: "PAUSED", created_time: "2026-07-06T09:00:00+0100",
        ...spend({ spend_window: 16468, spend_life: 16696, results_window: 782, first_day: "2026-07-06", last_day: "2026-09-10", daily: [["2026-08-11", 433.94]] }),
        versions: [version({ id: "v-l" })], current_id: "v-l",
        adsets: [{ id: "S-R", name: "BoxLyLong relaunch", status: "CAMPAIGN_PAUSED", created_time: null, ...spend({ spend_window: 16468, spend_life: 16696 }), versions: [], own_current_id: null }],
      },
      {
        id: "C-Q", ad_account_id: "act", name: "QuranTadabr", objective: "OUTCOME_SALES", status: "ACTIVE", created_time: null,
        ...spend({ spend_window: 10566, spend_life: 18540, results_window: 610 }),
        versions: [version({ id: "v-q", lines: [{ product_id: "Q", share_pct: null }] })], current_id: "v-q",
        adsets: [
          { id: "S-B2", name: "QuranTadabr Ad Set 2- batch 2", status: "ACTIVE", created_time: null, ...spend({ spend_window: 5691 }), versions: [], own_current_id: null },
          { id: "S-B1", name: "QuranTadabr Ad Set 1- batch 1", status: "ACTIVE", created_time: null, ...spend({ spend_window: 4875 }), versions: [], own_current_id: null },
        ],
      },
      {
        id: "C-HERO", ad_account_id: "act", name: "BoxheroLY - LY", objective: "OUTCOME_SALES", status: "PAUSED", created_time: null,
        ...spend({ spend_life: 519 }), versions: [], current_id: null,
        adsets: [{ id: "S-H", name: "BOXHERO LY - ADSET 1", status: "CAMPAIGN_PAUSED", created_time: null, ...spend({ spend_life: 519 }), versions: [], own_current_id: null }],
      },
      {
        id: "C-PETS", ad_account_id: "act", name: "Pets Glove test", objective: "OUTCOME_SALES", status: "PAUSED", created_time: null,
        ...spend(), versions: [], current_id: null, adsets: [],
      },
    ],
    products: [
      { id: "M", name: "دميه ملاكمه حجم متوسط", sku: null, image_url: null, is_active: true, orders_30d: 90 },
      { id: "S", name: "دميه ملاكمه حجم صغير", sku: "box-wafra-shop", image_url: null, is_active: true, orders_30d: 0 },
      { id: "L", name: "دميه ملاكمه حجم كبير", sku: null, image_url: null, is_active: true, orders_30d: 21 },
      { id: "Q", name: "القرآن تدبر وعمل", sku: "qr-01", image_url: null, is_active: true, orders_30d: 573 },
    ],
    coverage: {
      window: { total: 45741, attributed: 45741, market_level: 0, unmapped: 0 },
      life: { total: 73147, attributed: 72605, market_level: 0, unmapped: 542 },
      life_from: "2026-05-23",
    },
    unmapped: { campaigns: 2, spent_campaigns: 1, spend_life: 519 },
  };
}

const emptyPreview = (over: Partial<MappingPreviewDTO> = {}): MappingPreviewDTO => ({
  range: { since: "2026-07-06", until: "2026-09-30" },
  clamped: false,
  history_from: "2026-05-23",
  days: 40,
  moved: 13839,
  products: [
    { product_id: "M", before: 0, after: 10544 },
    { product_id: "S", before: 0, after: 3295 },
    { product_id: "L", before: 16696, after: 2857 },
  ],
  shares: [],
  statements: [],
  ...over,
});

const props = {
  marketId: "ly",
  fromDate: "2026-07-08",
  toDate: "2026-09-30",
  currency: "LYD",
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

beforeEach(() => {
  tree = makeTree();
  saveMapping.mockReset();
  previewMapping.mockReset().mockResolvedValue(emptyPreview());
  props.onSaved.mockReset();
});

const list = () => screen.getByRole("list", { name: /campagnes/i });

describe("AdSpendMappingDrawer — the list", () => {
  it("opens on 'À mapper' when asked, with only the campaigns nobody decided", () => {
    render(<AdSpendMappingDrawer {...props} initialFilter="unmapped" />);
    const rows = within(list()).getAllByRole("button", { name: /^(?!Afficher)/ });
    const text = rows.map((r) => r.textContent).join(" | ");
    expect(text).toContain("BoxheroLY - LY");
    expect(text).toContain("Pets Glove test");
    expect(text).not.toContain("QuranTadabr");
  });

  it("finds a campaign by one of its ad sets", async () => {
    render(<AdSpendMappingDrawer {...props} />);
    await userEvent.type(screen.getByRole("searchbox"), "batch 2");
    expect(within(list()).getByText("QuranTadabr")).toBeInTheDocument();
    expect(within(list()).queryByText("BoxLyLong - relaunch")).not.toBeInTheDocument();
  });

  it("shows an ad set following its campaign", async () => {
    render(<AdSpendMappingDrawer {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /Afficher les ensembles de QuranTadabr/ }));
    const row = within(list()).getByText("QuranTadabr Ad Set 2- batch 2").closest("button")!;
    expect(row).toHaveTextContent("suit la campagne");
  });
});

describe("AdSpendMappingDrawer — the detail", () => {
  it("says what the campaign sells today and what Meta reported", () => {
    render(<AdSpendMappingDrawer {...props} focusCampaignId="C-RELAUNCH" />);
    const detail = screen.getByRole("region", { name: "BoxLyLong - relaunch" });
    expect(within(detail).getByText("782")).toBeInTheDocument();
    expect(within(detail).getAllByText("دميه ملاكمه حجم كبير").length).toBeGreaterThan(0);
    expect(within(detail).getByRole("button", { name: "Modifier" })).toBeInTheDocument();
  });
});

describe("AdSpendMappingDrawer — the editor", () => {
  async function openEditor() {
    render(<AdSpendMappingDrawer {...props} focusCampaignId="C-RELAUNCH" />);
    await userEvent.click(screen.getByRole("button", { name: "Modifier" }));
  }
  async function addProduct(name: string) {
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un produit" }));
    await userEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
  }

  it("keeps Apply disabled while manual shares do not make 100", async () => {
    await openEditor();
    await addProduct("حجم متوسط");
    await userEvent.click(screen.getByRole("radio", { name: /Manuelle/ }));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "60" } });
    fireEvent.change(inputs[1], { target: { value: "30" } });
    expect(screen.getByText("Total 90 % — il manque 10 %")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appliquer l'attribution" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Répartir également" }));
    expect(screen.getByText("Total 100 %")).toBeInTheDocument();
  });

  it("previews, then applies exactly the draft — three products, automatic, all history", async () => {
    saveMapping.mockResolvedValue({ id: "new", rows_rewritten: 90, pending_rebuild: false, preview: emptyPreview() });
    await openEditor();
    await addProduct("حجم متوسط");
    await addProduct("حجم صغير");
    await userEvent.click(screen.getByRole("radio", { name: /Tout l'historique/ }));

    await waitFor(() => expect(previewMapping).toHaveBeenCalled());
    // Testing Library normalises the DOM's narrow no-break space to a plain one.
    await screen.findByText("13 839 LYD réattribués sur 40 j", { selector: "span" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Appliquer l'attribution" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "Appliquer l'attribution" }));
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
    expect(await screen.findByRole("status")).toHaveTextContent("13 839 LYD");
  });

  it("names a settled investor statement and offers to start after it", async () => {
    previewMapping.mockResolvedValue(
      emptyPreview({
        statements: [{ product_id: "S", sequence_no: 1, period_start: "2026-05-20", period_end: "2026-07-31", settled: true, delta: 227.47 }],
      }),
    );
    await openEditor();
    await addProduct("حجم صغير");
    await userEvent.click(screen.getByRole("radio", { name: /Tout l'historique/ }));

    expect(await screen.findByText("Relevé investisseur déjà réglé")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Commencer au 1 août/ }));
    expect(screen.getByRole("radio", { name: /À partir du/ })).toBeChecked();
    expect(screen.getByLabelText("À partir du")).toHaveValue("2026-08-01");
  });

  it("lets an ad set go back to its campaign", async () => {
    saveMapping.mockResolvedValue({ id: "x", rows_rewritten: 0, pending_rebuild: false, preview: emptyPreview({ moved: 0, products: [] }) });
    tree.campaigns[1].adsets[0].versions = [version({ id: "own", external_adset_id: "S-B2", lines: [{ product_id: "M", share_pct: null }] })];
    tree.campaigns[1].adsets[0].own_current_id = "own";
    render(<AdSpendMappingDrawer {...props} focusCampaignId="C-Q" />);
    // Focusing a campaign expands it, so its ad sets are already listed.
    await userEvent.click(within(list()).getByText("QuranTadabr Ad Set 2- batch 2"));
    await userEvent.click(screen.getByRole("button", { name: "Modifier" }));
    await userEvent.click(screen.getByRole("radio", { name: /Suivre la campagne/ }));
    // Apply waits for the impact preview — nothing is written unseen.
    await waitFor(() => expect(screen.getByRole("button", { name: "Appliquer l'attribution" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Appliquer l'attribution" }));
    await waitFor(() => expect(saveMapping).toHaveBeenCalled());
    expect(saveMapping.mock.calls[0][0]).toMatchObject({ adset_id: "S-B2", kind: "inherit", lines: [], split_mode: null });
  });
});
