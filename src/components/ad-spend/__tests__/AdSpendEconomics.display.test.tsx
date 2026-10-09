import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { EconomicsMeta, ProductEconomics } from "@/hooks/useAdSpendEconomics";


import {
  AdSpendChain,
  AdSpendCostStack,
  AdSpendCplBars,
  AdSpendCoverageNote,
  AdSpendProductTable,
} from "../AdSpendEconomics";

/** Real ICU messages (plurals included), as the app renders them. */
const render = (ui: ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

/**
 * The display fixes of prototypes/finances-pub-v5.html — what a reader sees
 * change, not how it is painted. The look itself is the prototype's.
 */

const product = (over: Partial<ProductEconomics>): ProductEconomics =>
  ({
    product_id: "T",
    product_name: "Tadabbur",
    product_image_url: null,
    leads: 1170,
    confirmed: 562,
    delivered: 178,
    returned: 24,
    revenue: 41474,
    aov: 233,
    delivery_rate: 0.152,
    confirm_rate: 0.48,
    return_rate: 0.02,
    maturity_pct: 0.9,
    cost_cogs: 0,
    cost_delivery: 0,
    cost_returns: 0,
    cost_packing: 0,
    cost_processing: 0,
    spend: 7722,
    cpl: 6.6,
    break_even_cpl: 22.02,
    break_even_cost_per_delivered: null,
    break_even_roas: null,
    break_even_delivery_rate: null,
    margin_per_lead: 15.42,
    profit: 18043,
    roas: 5.37,
    daily_leads: [],
    entries: [],
    campaigns: [],
    ...over,
  }) as ProductEconomics;

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
  unmapped: { spend: 0, entries: [], campaigns: [] },
  from_date: "2026-07-14",
  to_date: "2026-10-05",
} as EconomicsMeta;

describe("Dépenses pub — display fixes", () => {
  it("closes the chain on « Bénéfice brut », as the rest of Finances does", () => {
    render(<AdSpendChain meta={meta} currency="LYD" />);
    expect(screen.getByText("Bénéfice brut")).toBeInTheDocument();
    expect(screen.queryByText("Profit net")).not.toBeInTheDocument();
  });

  it("groups thousands with a space the font actually draws", () => {
    const { container } = render(<AdSpendChain meta={meta} currency="LYD" />);
    // U+202F (fr-FR's own) renders with no width in Plus Jakarta Sans: « 34707 ».
    // Raw textContent — Testing Library's matchers normalise whitespace away.
    const spent = container.querySelector(".step .sv")!.textContent!;
    expect(spent).toContain("34 707");
    expect(spent).not.toContain(" ");
  });

  it("folds every product with no attributed spend into one line under the bars", () => {
    const none = product({ product_id: "P", product_name: "Tapis de prière", spend: 0, cpl: 0, break_even_cpl: 18.51, margin_per_lead: 18.51 });
    render(<AdSpendCplBars products={[product({}), none]} currency="LYD" periodLabel="Sur la période" />);

    expect(screen.queryByText("Coût inconnu")).not.toBeInTheDocument();
    const line = screen.getByText(/1 produit sans dépense attribuée/).closest("[data-nospend]")!;
    expect(line).toHaveTextContent("Tapis de prière");
    expect(line).toHaveTextContent("18,51");
  });

  it("lists a delivered order's costs in the section's money order", () => {
    render(<AdSpendCostStack meta={meta} currency="LYD" />);
    const labels = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.querySelector("[data-label]")?.textContent);
    expect(labels).toEqual(["Achat produit", "Livraison", "Retours", "Publicité", "Emballage", "Bénéfice brut"]);
  });

  it("explains a verdict on hover", async () => {
    render(<AdSpendProductTable products={[product({})]} meta={meta} currency="LYD" />);
    await userEvent.hover(screen.getByText("Scaler"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("La marge dépasse 40 % du seuil");
  });

  it("heads the money column « Bénéfice brut »", () => {
    render(<AdSpendProductTable products={[product({})]} meta={meta} currency="LYD" />);
    expect(screen.getByRole("columnheader", { name: /Bénéfice brut/ })).toBeInTheDocument();
  });

  it("offers the backfill from a date a person can read", async () => {
    const onBackfill = vi.fn();
    render(<AdSpendCoverageNote count={1} fromDate="2026-07-14" onBackfill={onBackfill} />);
    expect(screen.getByText(/1 produit\(s\) sans dépense attribuée/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Récupérer depuis le 14 juil." }));
    expect(onBackfill).toHaveBeenCalled();
  });
});
