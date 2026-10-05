import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { EconomicsMeta, ProductEconomics } from "@/hooks/useAdSpendEconomics";
import type { AuthUser } from "@/types";

/**
 * prototypes/finances-pub-v5.html: the page's two warnings (spend on no
 * product, products with no spend) live in ONE place — the head of the
 * « Campagnes et produits » drawer — and the drawer's button carries their
 * total. A market with no Meta account has no drawer, so there the page keeps
 * them: an alert must never simply disappear.
 */

let accounts: unknown[] = [];
const meta = {
  market_level_spend: 0,
  total_spend: 34707,
  total_leads: 3550,
  total_confirmed: 1452,
  total_delivered: 439,
  total_revenue: 103031,
  total_costs: 76017,
  total_profit: 27014,
  cost_cogs: 30587,
  cost_delivery: 9658,
  cost_returns: 360,
  cost_packing: 726,
  cost_processing: 0,
  products_without_spend: 1,
  maturity_pct: 0.9,
  unmapped: {
    spend: 2680,
    entries: [],
    campaigns: [{ campaign_id: "C-U", ad_account_id: "act", campaign_name: "Promo automne", amount: 2680, share: null, split: null, results: 0, adsets: [] }],
  },
  from_date: "2026-07-14",
  to_date: "2026-10-05",
} as EconomicsMeta;

const product = {
  product_id: "COR",
  product_name: "Coran couleurs",
  product_image_url: null,
  leads: 435, confirmed: 126, delivered: 32, returned: 8, revenue: 8160, aov: 255,
  delivery_rate: 0.074, confirm_rate: 0.29, return_rate: 0.02, maturity_pct: 0.9,
  cost_cogs: 0, cost_delivery: 0, cost_returns: 0, cost_packing: 0, cost_processing: 0,
  spend: 4959, cpl: 11.4, break_even_cpl: 10.94, break_even_cost_per_delivered: null, break_even_roas: null,
  break_even_delivery_rate: 0.08, margin_per_lead: -0.46, profit: -198, roas: 1.65, daily_leads: [],
  campaigns: [],
  entries: [{ id: "e1", label: "Influenceuse", campaign_id: null, source: "manual", amount: 1239, period_start: "2026-09-20", period_end: "2026-09-30", editable: true }],
} as unknown as ProductEconomics;

vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ scope: "market", marketId: "ly" }) }));
vi.mock("@/hooks/useAdSpendEconomics", () => ({
  useAdSpendEconomics: () => ({ products: [product], meta, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useAdSpendSyncStatus", () => ({
  useAdSpendSyncStatus: () => ({ status: { accounts, last_run: null, campaigns: 15, cadence: null, last_error: null }, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useAdSpendMapping", () => ({
  useAdSpendMapping: () => ({
    tree: { campaigns: [{ id: "C-U", spend_unattributed: 2010, adsets: [] }, { id: "C-V", spend_unattributed: 670, adsets: [] }] },
    mutate: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAdSpendCampaigns", () => ({
  useAdSpendCampaigns: () => ({ entries: [{ id: "e1", amount: 1239, period_start: "2026-09-20", period_end: "2026-09-30", product_id: "COR", note: null }], products: [], mutate: vi.fn() }),
}));

import { AdSpendClient } from "./AdSpendClient";

const user = { id: "u", role: "super_admin", market_id: null, locale: "fr" } as unknown as AuthUser;
const markets = [{ id: "ly", name: "Libye", code: "ly" }];

function show() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="UTC">
      <AdSpendClient user={user} markets={markets} initialMarketId="ly" />
    </NextIntlClientProvider>,
  );
}

const metaAccount = {
  id: "a", market_id: "ly", market_name: "Libye", ad_account_id: "act", account_name: "Compte LY", account_currency: "USD",
  account_timezone: "Africa/Tripoli", is_active: true, last_synced_at: null, last_sync_error: null, timezone: { status: "ok" },
};

beforeEach(() => {
  accounts = [metaAccount];
});

describe("Dépenses pub — where the warnings live", () => {
  it("with Meta connected, keeps them off the page and counts them on the drawer's button", () => {
    show();
    expect(screen.queryByText(/produit\(s\) sans dépense attribuée/)).not.toBeInTheDocument();
    expect(screen.queryByText(/non rattachée\(s\) à un produit/)).not.toBeInTheDocument();
    // 2 campaigns waiting for a product + 1 product with no spend
    expect(screen.getByRole("button", { name: /Campagnes et produits/ })).toHaveTextContent("3");
  });

  it("with no Meta account there is no drawer, so the page keeps them", () => {
    accounts = [];
    show();
    expect(screen.getByText(/produit\(s\) sans dépense attribuée/)).toBeInTheDocument();
    expect(screen.getByText(/non rattachée\(s\) à un produit/)).toBeInTheDocument();
  });
});

describe("Dépenses pub — deleting a manual entry", () => {
  it("says the market's own currency", async () => {
    show();
    await userEvent.click(screen.getByRole("row", { name: /Coran couleurs/ }));
    await userEvent.click(within(screen.getByText("Influenceuse").closest("tr")!).getByRole("button", { name: "Supprimer" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Dépense de 1\s239 LYD/);
    expect(dialog).not.toHaveTextContent("TND");
  });
});
