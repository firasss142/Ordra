import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductBriefBanner } from "../ProductBriefBanner";
import type { SheetCheck } from "@/lib/products/sheet-checks";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) => (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(frMessages, ns, key, params),
  };
});

function renderBanner(overrides: Partial<React.ComponentProps<typeof ProductBriefBanner>> = {}) {
  const onOpenSheet = vi.fn();
  render(
    <ProductBriefBanner
      brief={null}
      tone="info"
      checks={[]}
      onOpenSheet={onOpenSheet}
      {...overrides}
    />,
  );
  return { onOpenSheet };
}

describe("ProductBriefBanner — when it stays out of the way", () => {
  it("renders nothing for a healthy order with no brief", () => {
    const { container } = render(
      <ProductBriefBanner brief={null} tone="info" checks={[]} onOpenSheet={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the brief is only whitespace", () => {
    const { container } = render(
      <ProductBriefBanner brief="   " tone="info" checks={[]} onOpenSheet={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores info-level checks — they belong in the drawer, not on the order", () => {
    const checks: SheetCheck[] = [{ code: "low_stock", severity: "info", values: { stock: 3 } }];
    const { container } = render(
      <ProductBriefBanner brief={null} tone="info" checks={checks} onOpenSheet={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProductBriefBanner — content", () => {
  it("shows the pinned brief without a click", () => {
    renderBanner({ brief: "Stock bleu épuisé — proposer le noir.", tone: "warning" });
    expect(screen.getByText("Stock bleu épuisé — proposer le noir.")).toBeInTheDocument();
    expect(screen.getByText("À savoir")).toBeInTheDocument();
  });

  it("translates a check and interpolates its values", () => {
    renderBanner({
      checks: [
        {
          code: "price_mismatch",
          severity: "warning",
          values: { orderPrice: 39, catalogPrice: 49 },
        },
      ],
    });
    expect(screen.getByText("Prix commande 39 ≠ catalogue 49")).toBeInTheDocument();
  });

  it("renders every problem, not just the worst one", () => {
    renderBanner({
      checks: [
        { code: "product_inactive", severity: "critical" },
        { code: "out_of_stock", severity: "critical" },
      ],
    });
    expect(screen.getByText("Produit désactivé — ne pas confirmer")).toBeInTheDocument();
    expect(screen.getByText("Rupture de stock")).toBeInTheDocument();
  });
});

describe("ProductBriefBanner — opening the sheet", () => {
  it("exposes exactly one open affordance when both a check and a brief are present", () => {
    renderBanner({
      brief: "Pack 2 à 79 TND",
      checks: [{ code: "out_of_stock", severity: "critical" }],
    });
    expect(screen.getAllByRole("button", { name: /fiche produit/i })).toHaveLength(1);
  });

  it("still offers the sheet when there is a problem but no brief", () => {
    const { onOpenSheet } = renderBanner({
      checks: [{ code: "out_of_stock", severity: "critical" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /fiche produit/i }));
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenSheet when the affordance is clicked", () => {
    const { onOpenSheet } = renderBanner({ brief: "Garantie 14 jours" });
    fireEvent.click(screen.getByRole("button", { name: /fiche produit/i }));
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });
});
