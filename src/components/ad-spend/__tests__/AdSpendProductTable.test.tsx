import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { EconomicsMeta, ProductEconomics } from "@/hooks/useAdSpendEconomics";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import { AdSpendProductTable } from "../AdSpendEconomics";

/**
 * Expanding a product used to list one row per DAY of spend — 51 of them for
 * QuranTadabr — each with a "CPL" dividing one day's spend by the window's
 * leads. It now lists campaigns and their ad sets, the share of each campaign
 * this product carries, and Meta's own purchase count.
 */

const product = (over: Partial<ProductEconomics>): ProductEconomics =>
  ({
    product_id: "M",
    product_name: "دميه ملاكمه حجم متوسط",
    product_image_url: null,
    leads: 594,
    confirmed: 300,
    delivered: 200,
    returned: 50,
    revenue: 30000,
    aov: 150,
    delivery_rate: 0.34,
    confirm_rate: 0.5,
    return_rate: 0.08,
    maturity_pct: 0.9,
    cost_cogs: 0,
    cost_delivery: 0,
    cost_returns: 0,
    cost_packing: 0,
    cost_processing: 0,
    spend: 10544,
    cpl: 17.75,
    break_even_cpl: 30,
    break_even_cost_per_delivered: null,
    break_even_roas: null,
    break_even_delivery_rate: null,
    margin_per_lead: 12,
    profit: 7000,
    roas: 2.8,
    daily_leads: [],
    entries: [],
    campaigns: [
      {
        campaign_id: "C-RELAUNCH",
        ad_account_id: "act",
        campaign_name: "BoxLyLong - relaunch",
        amount: 10544,
        share: 0.6403,
        split: "auto",
        results: 500,
        adsets: [{ adset_id: "S-R", adset_name: "BoxLyLong relaunch", amount: 10544, results: 500 }],
      },
    ],
    ...over,
  }) as ProductEconomics;

const meta = {
  total_spend: 10544,
  total_leads: 594,
  total_confirmed: 300,
  total_delivered: 200,
  total_revenue: 30000,
  total_costs: 20000,
  total_profit: 10000,
  unmapped: { spend: 0, entries: [], campaigns: [] },
} as unknown as EconomicsMeta;

describe("AdSpendProductTable — the breakdown under a product", () => {
  it("lists the campaign with the share it carries, then its ad sets", async () => {
    render(<AdSpendProductTable products={[product({})]} meta={meta} currency="LYD" />);
    await userEvent.click(screen.getByText("دميه ملاكمه حجم متوسط"));

    const campaignRow = screen.getByText("BoxLyLong - relaunch").closest("tr")!;
    expect(campaignRow).toHaveTextContent("64 % · auto");
    expect(campaignRow).toHaveTextContent("500 achats Meta");
    expect(screen.getByText("BoxLyLong relaunch").closest("tr")).toHaveTextContent("10 544");
  });

  it("says 100 % for a campaign carried whole", async () => {
    const whole = product({
      campaigns: [{ campaign_id: "C-Q", ad_account_id: "act", campaign_name: "QuranTadabr", amount: 10566, share: null, split: null, results: 610, adsets: [] }],
    });
    render(<AdSpendProductTable products={[whole]} meta={meta} currency="LYD" />);
    await userEvent.click(screen.getByText("دميه ملاكمه حجم متوسط"));
    expect(screen.getByText("QuranTadabr").closest("tr")).toHaveTextContent("100 %");
  });

  it("opens the mapping drawer on that very campaign", async () => {
    const onOpenCampaign = vi.fn();
    render(<AdSpendProductTable products={[product({})]} meta={meta} currency="LYD" onOpenCampaign={onOpenCampaign} />);
    await userEvent.click(screen.getByText("دميه ملاكمه حجم متوسط"));
    const row = screen.getByText("BoxLyLong - relaunch").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Attribuer" }));
    expect(onOpenCampaign).toHaveBeenCalledWith("C-RELAUNCH");
  });

  it("keeps manual entries editable, under their own heading", async () => {
    const onEditEntry = vi.fn();
    const withManual = product({
      entries: [{ id: "e1", label: "Influenceuse", campaign_id: null, source: "manual", amount: 300, period_start: "2026-08-01", period_end: "2026-08-31", editable: true }],
    });
    render(<AdSpendProductTable products={[withManual]} meta={meta} currency="LYD" onEditEntry={onEditEntry} />);
    await userEvent.click(screen.getByText("دميه ملاكمه حجم متوسط"));
    expect(screen.getByText("Saisies manuelles")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Influenceuse").closest("tr")!).getByRole("button", { name: /modifier/i }));
    expect(onEditEntry).toHaveBeenCalledWith("e1");
  });
});
