import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it, expect } from "vitest";
import { ProductDetailHeader } from "./ProductDetailHeader";
import frMessages from "@/messages/fr.json";

function renderHeader(props: Partial<React.ComponentProps<typeof ProductDetailHeader>> = {}) {
  const defaults: React.ComponentProps<typeof ProductDetailHeader> = {
    locale: "fr",
    productId: "p-123",
    name: "Test Product",
    isActive: true,
    currentStock: 10,
    isLowStock: false,
    canEdit: false,
    sku: null,
    variantCount: 0,
    imageUrl: null,
  };
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <ProductDetailHeader {...defaults} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ProductDetailHeader", () => {
  it("hides the edit link when canEdit is false", () => {
    renderHeader({ canEdit: false });
    expect(screen.queryByRole("link", { name: frMessages.productPnl.edit })).toBeNull();
  });

  it("shows an edit link pointing to the edit page when canEdit is true", () => {
    renderHeader({ canEdit: true, productId: "abc-123", locale: "fr" });
    const editLink = screen.getByRole("link", { name: frMessages.productPnl.edit });
    expect(editLink.getAttribute("href")).toBe("/fr/products/abc-123/edit");
  });

  it("renders product name and back link", () => {
    renderHeader({ name: "Widget" });
    expect(screen.getByRole("heading", { name: "Widget" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: frMessages.productPnl.backToProducts }),
    ).toBeInTheDocument();
  });

  it("renders SKU when provided", () => {
    renderHeader({ sku: "SKU-42" });
    expect(screen.getByText(/SKU-42/)).toBeInTheDocument();
  });

  it("does not render SKU line content when sku is null and variantCount is 0", () => {
    renderHeader({ sku: null, variantCount: 0 });
    expect(screen.queryByText(/SKU/)).toBeNull();
  });

  it("renders pluralized variant count (singular)", () => {
    renderHeader({ variantCount: 1 });
    expect(screen.getByText(/1 variante/)).toBeInTheDocument();
  });

  it("renders pluralized variant count (plural)", () => {
    renderHeader({ variantCount: 4 });
    expect(screen.getByText(/4 variantes/)).toBeInTheDocument();
  });

  it("shows an image when imageUrl is provided", () => {
    renderHeader({ imageUrl: "https://example.com/img.jpg", name: "Widget" });
    const img = screen.getByRole("img", { name: "Widget" });
    expect(img.getAttribute("src")).toBe("https://example.com/img.jpg");
  });

  it("shows initials placeholder when imageUrl is null", () => {
    renderHeader({ imageUrl: null, name: "Test Product" });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("TP")).toBeInTheDocument();
  });
});
