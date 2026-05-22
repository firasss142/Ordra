import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelatedOrderCard } from "./RelatedOrderCard";

function renderCard(props: Partial<React.ComponentProps<typeof RelatedOrderCard>> = {}) {
  return render(
    <RelatedOrderCard
      id="11111111-1111-1111-1111-111111111111"
      status="pending"
      statusLabel="En attente"
      createdAt="2026-05-22T14:00:00Z"
      totalPrice={129}
      currencyCode="LBY"
      locale="fr"
      customerName="Ahmed Ali"
      customerAddress="12 Rue X"
      customerCity="Tripoli"
      productName="T-Shirt"
      productImageUrl={null}
      {...props}
    />,
  );
}

describe("RelatedOrderCard", () => {
  it("shows the customer name, address, status label, and price with currency", () => {
    renderCard();
    expect(screen.getByText("Ahmed Ali")).toBeDefined();
    expect(screen.getByText("12 Rue X · Tripoli")).toBeDefined();
    expect(screen.getByText("En attente")).toBeDefined();
    expect(screen.getByText("129.00")).toBeDefined();
    expect(screen.getByText("LBY")).toBeDefined();
  });

  it("shows a dash when address and city are both missing", () => {
    renderCard({ customerAddress: null, customerCity: null });
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the unknown-customer label when the name is missing", () => {
    renderCard({ customerName: null, unknownCustomerLabel: "Client inconnu" });
    expect(screen.getByText("Client inconnu")).toBeDefined();
  });

  it("renders the duplicate marker only when isDuplicate is set", () => {
    const { rerender, container } = renderCard({ isDuplicate: false });
    expect(container.querySelector("[data-duplicate-mark]")).toBeNull();
    rerender(
      <RelatedOrderCard
        id="x"
        status="pending"
        statusLabel="En attente"
        createdAt="2026-05-22T14:00:00Z"
        totalPrice={129}
        currencyCode="LBY"
        locale="fr"
        customerName="Ahmed Ali"
        customerAddress="12 Rue X"
        customerCity="Tripoli"
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
