import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ListLoading from "../loading";
import SheetLoading from "../[id]/loading";
import EditLoading from "../[id]/edit/loading";
import NewLoading from "../new/loading";

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      {ui}
    </NextIntlClientProvider>,
  );
}

/*
 * Each products route paints its own page's skeleton while the server renders,
 * not the dashboard's generic one and not the pre-v6 list (KPI cards, filter
 * chips) that /products/loading.tsx drew until 2026-10-04.
 */
describe("products route loading states", () => {
  test("/products paints the v6 list skeleton", () => {
    const { container } = wrap(<ListLoading />);
    expect(screen.getByRole("heading", { level: 1, name: fr.products.v6.l_title })).toBeInTheDocument();
    expect(container.querySelector(".pv6 .tbl")).not.toBeNull();
  });

  test("/products/[id] paints the sheet skeleton", () => {
    const { container } = wrap(<SheetLoading />);
    expect(container.querySelector(".pv6 .hero")).not.toBeNull();
  });

  test("/products/[id]/edit and /products/new paint the edit skeleton", () => {
    for (const Loading of [EditLoading, NewLoading]) {
      const { container, unmount } = wrap(<Loading />);
      expect(container.querySelector(".pv6 .tabs")).not.toBeNull();
      unmount();
    }
  });
});
