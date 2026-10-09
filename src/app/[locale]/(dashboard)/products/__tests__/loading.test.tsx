import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ListLoading from "../loading";
import SheetLoading from "../[id]/loading";
import EditLoading from "../[id]/edit/loading";
import NewLoading from "../new/loading";

/*
 * Each products route paints a skeleton shaped like its page while the server renders.
 *
 * Until 2026-10-08 these drew the v6 skeletons from products-v6.css — and a route's
 * fallback paints BEFORE that stylesheet arrives, so on a first visit /products showed
 * its tile labels and column names as bare text. They now draw RouteSkeleton, styled
 * from globals.css (see src/app/__tests__/loading-boundaries.test.ts); the v6 skeletons
 * stay as the in-page state ProductsListV6 / ProductSheetV6 show while data loads.
 */
describe("products route loading states", () => {
  test("/products paints the list: five money tiles over the product table", () => {
    const { container } = render(<ListLoading />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".rsk-tiles > .rsk-card")).toHaveLength(5);
    expect(container.querySelector(".rsk-list")).not.toBeNull();
  });

  test("/products/[id] paints the sheet: tiles over the movements", () => {
    const { container } = render(<SheetLoading />);
    expect(container.querySelector(".rsk-tiles")).not.toBeNull();
    expect(container.querySelector(".rsk-list")).not.toBeNull();
  });

  test("/products/[id]/edit and /products/new paint the form cards", () => {
    for (const Loading of [EditLoading, NewLoading]) {
      const { container, unmount } = render(<Loading />);
      expect(container.querySelector(".rsk-tiles")).toBeNull();
      expect(container.querySelector(".rsk-cards")).not.toBeNull();
      unmount();
    }
  });
});
