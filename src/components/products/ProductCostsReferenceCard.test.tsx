import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it, expect } from "vitest";
import { ProductCostsReferenceCard } from "./ProductCostsReferenceCard";
import frMessages from "@/messages/fr.json";

function renderCard(
  props: Partial<React.ComponentProps<typeof ProductCostsReferenceCard>> = {},
) {
  const defaults: React.ComponentProps<typeof ProductCostsReferenceCard> = {
    unitCogs: 12.5,
    packingCost: 0.75,
    processingCost: 1.2,
    variants: [],
  };
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <ProductCostsReferenceCard {...defaults} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ProductCostsReferenceCard", () => {
  it("renders COGS, Packing and Processing labels", () => {
    renderCard();
    expect(screen.getByText(frMessages.productPnl.costsReference.cogs)).toBeInTheDocument();
    expect(screen.getByText(frMessages.productPnl.costsReference.packing)).toBeInTheDocument();
    expect(screen.getByText(frMessages.productPnl.costsReference.processing)).toBeInTheDocument();
  });

  it("does not render any CPL label", () => {
    renderCard();
    expect(screen.queryByText(/CPL/i)).toBeNull();
  });

  it("renders formatted values with 3 decimals", () => {
    renderCard({ unitCogs: 12.5, packingCost: 0.75, processingCost: 1.2 });
    expect(screen.getByText("12.500")).toBeInTheDocument();
    expect(screen.getByText("0.750")).toBeInTheDocument();
    expect(screen.getByText("1.200")).toBeInTheDocument();
  });

  it("renders only active variants in the chips section", () => {
    renderCard({
      variants: [
        { id: "v1", label: "Rouge", quantity: 1, display_price: 49.9, is_active: true },
        { id: "v2", label: "Bleu", quantity: 2, display_price: 89.9, is_active: false },
        { id: "v3", label: "Vert", quantity: 1, display_price: 49.9, is_active: true },
      ],
    });
    expect(screen.getByText("Rouge")).toBeInTheDocument();
    expect(screen.getByText("Vert")).toBeInTheDocument();
    expect(screen.queryByText("Bleu")).toBeNull();
  });

  it("hides variants section when no active variants", () => {
    renderCard({ variants: [] });
    expect(screen.queryByText(frMessages.productPnl.costsReference.variants)).toBeNull();
  });
});
