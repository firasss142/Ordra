import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), val);
      return val;
    };
    return resolve;
  },
}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// The picker decodes via canvas; stub it so picking yields a deterministic data URL.
const mockDecode = vi.fn();
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: (...args: unknown[]) => mockDecode(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ProductEditForm } from "./ProductEditForm";

const baseProduct = {
  id: "p-1",
  name: "Bouteille",
  sku: null,
  description: null,
  image_url: null,
  unit_cogs: 5,
  packing_cost: 1,
  confirmation_processing_cost: 0,
  default_price: null,
  low_stock_threshold: 5,
  is_active: true,
};

function renderForm(overrides: Partial<typeof baseProduct> = {}) {
  return render(
    <ProductEditForm product={{ ...baseProduct, ...overrides }} locale="fr" />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductEditForm — image upload", () => {
  it("renders the image picker", () => {
    renderForm();
    expect(screen.getByText("Image du produit")).toBeInTheDocument();
    expect(screen.getByText("Ajouter une image")).toBeInTheDocument();
  });

  it("uploads the picked image after the product PATCH succeeds", async () => {
    mockDecode.mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) }) // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_url: "https://cdn/p.png" }) }); // image PUT

    renderForm();

    await userEvent.upload(
      screen.getByTestId("product-image-input"),
      new File(["x"], "p.png", { type: "image/png" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1");
    expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");

    expect(mockFetch.mock.calls[1][0]).toBe("/api/products/p-1/image");
    expect(mockFetch.mock.calls[1][1].method).toBe("PUT");
    const imageBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(imageBody.data_url).toBe("data:image/png;base64,AAA");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/p-1"));
  });

  it("does not call the image route when no new image is picked", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) });

    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1");
    // No image PUT
    expect(mockFetch.mock.calls.some((c) => String(c[0]).endsWith("/image"))).toBe(false);
  });
});
