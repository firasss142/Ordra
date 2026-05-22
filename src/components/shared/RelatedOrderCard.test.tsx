import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelatedOrderCard } from "./RelatedOrderCard";

function renderCard(props: Partial<React.ComponentProps<typeof RelatedOrderCard>> = {}) {
  return render(
    <RelatedOrderCard
      id="11111111-1111-1111-1111-111111111111"
      externalId="1555"
      status="pending"
      statusLabel="En attente"
      createdAt="2026-05-22T14:00:00Z"
      totalPrice={129}
      currencyCode="LBY"
      locale="fr"
      productName="T-Shirt"
      productImageUrl={null}
      {...props}
    />,
  );
}

describe("RelatedOrderCard", () => {
  it("shows the order number, status label, and price with currency", () => {
    renderCard();
    expect(screen.getByText("#1555")).toBeDefined();
    expect(screen.getByText("En attente")).toBeDefined();
    expect(screen.getByText("129.00")).toBeDefined();
    expect(screen.getByText("LBY")).toBeDefined();
  });

  it("falls back to a short id when external id is missing", () => {
    renderCard({ externalId: null });
    expect(screen.getByText("#111111")).toBeDefined();
  });

  it("renders the duplicate marker only when isDuplicate is set", () => {
    const { rerender, container } = renderCard({ isDuplicate: false });
    expect(container.querySelector("[data-duplicate-mark]")).toBeNull();
    rerender(
      <RelatedOrderCard
        id="x"
        externalId="1555"
        status="pending"
        statusLabel="En attente"
        createdAt="2026-05-22T14:00:00Z"
        totalPrice={129}
        currencyCode="LBY"
        locale="fr"
        productName="T-Shirt"
        productImageUrl={null}
        isDuplicate
        duplicateMarkLabel="Doublon"
      />,
    );
    expect(container.querySelector("[data-duplicate-mark]")).not.toBeNull();
  });

  it("renders the product image when a url is provided", () => {
    renderCard({ productName: "T-Shirt", productImageUrl: "https://img/x.png" });
    const img = screen.getByRole("img", { name: "T-Shirt" });
    expect(img.getAttribute("src")).toBe("https://img/x.png");
  });

  it("applies the anchor highlight class when isAnchor is set", () => {
    const { container } = renderCard({ isAnchor: true });
    const card = container.querySelector("[data-related-order]") as HTMLElement;
    expect(card.getAttribute("data-anchor")).toBe("true");
  });

  it("renders the shipped chip when alreadyShipped is set", () => {
    renderCard({ alreadyShipped: true, shippedLabel: "Déjà envoyé au transporteur" });
    expect(screen.getByText("Déjà envoyé au transporteur")).toBeDefined();
  });

  it("renders the rightSlot content", () => {
    renderCard({ rightSlot: <button type="button">Supprimer</button> });
    expect(screen.getByText("Supprimer")).toBeDefined();
  });
});
