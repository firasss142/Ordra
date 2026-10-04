import { describe, test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ProductsListSkeleton, ProductSheetSkeleton, ProductEditSkeleton } from "../skeletons";

const v6 = fr.products.v6;

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      {ui}
    </NextIntlClientProvider>,
  );
}

/*
 * The skeletons are the pages' own markup with grey bars where figures go, so
 * the switch from "loading" to "loaded" is a fill-in, never a different layout
 * (the old route skeleton drew the previous page's KPI cards and filter chips).
 */
describe("products v6 skeletons", () => {
  test("the list skeleton is the list: its title, its five KPIs, its columns, eight rows", () => {
    const { container } = wrap(<ProductsListSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1, name: v6.l_title })).toBeInTheDocument();
    const kpis = within(container.querySelector(".kpis") as HTMLElement);
    for (const k of [v6.k_rec, v6.k_conf, v6.k_dlv, v6.k_enc, v6.k_net]) {
      expect(kpis.getByText(k)).toBeInTheDocument();
    }
    expect(screen.getByText(v6.h_prod)).toBeInTheDocument();
    expect(container.querySelectorAll(".pv6 .kpi")).toHaveLength(5);
    expect(container.querySelectorAll(".pv6 .tbl .tr")).toHaveLength(8);
    expect(container.querySelector(".empty-q")).toBeNull();
  });

  test("the sheet skeleton has the hero, the period bar, the KPIs and the cards", () => {
    const { container } = wrap(<ProductSheetSkeleton />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".pv6 .hero")).not.toBeNull();
    expect(container.querySelector(".pv6 .pbar2")).not.toBeNull();
    expect(container.querySelectorAll(".pv6 .kpi")).toHaveLength(5);
    expect(container.querySelectorAll(".pv6 .card").length).toBeGreaterThanOrEqual(4);
  });

  test("without money (warehouse agent) the sheet skeleton is the hero and the stock cards only", () => {
    const { container } = wrap(<ProductSheetSkeleton money={false} />);
    expect(container.querySelector(".pv6 .hero")).not.toBeNull();
    expect(container.querySelector(".pv6 .kpis")).toBeNull();
    expect(container.querySelector(".pv6 .pbar2")).toBeNull();
    expect(container.querySelector(".pv6 .two")).not.toBeNull();
  });

  test("the edit skeleton has the header, the tabs, the panel and the rail", () => {
    const { container } = wrap(<ProductEditSkeleton />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".pv6 .ehead")).not.toBeNull();
    expect(container.querySelector(".pv6 .tabs")).not.toBeNull();
    expect(container.querySelector(".pv6 .egrid .panel")).not.toBeNull();
    expect(container.querySelector(".pv6 .egrid .rail")).not.toBeNull();
  });
});
