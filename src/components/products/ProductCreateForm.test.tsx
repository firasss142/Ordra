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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockDecode = vi.fn();
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: (...args: unknown[]) => mockDecode(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ProductCreateForm } from "./ProductCreateForm";

const markets = [
  { id: "m-1", name: "Tunisie" },
  { id: "m-2", name: "Libye" },
];

function renderForm(overrides: Partial<React.ComponentProps<typeof ProductCreateForm>> = {}) {
  const defaults: React.ComponentProps<typeof ProductCreateForm> = {
    role: "super_admin",
    markets,
    defaultMarketId: "m-1",
    locale: "fr",
  };
  return render(<ProductCreateForm {...defaults} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductCreateForm", () => {
  it("renders the form title", () => {
    renderForm();
    expect(screen.getByText("Nouveau produit")).toBeInTheDocument();
  });

  it("renders all three sections", () => {
    renderForm();
    expect(screen.getByText("Identité")).toBeInTheDocument();
    expect(screen.getByText("Modèle de coûts")).toBeInTheDocument();
    expect(screen.getByText("Inventaire")).toBeInTheDocument();
  });

  it("shows validation error when name is empty on submit", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));
    expect(await screen.findByText(/nom est obligatoire/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows validation error when unit_cogs is negative", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogsInput = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogsInput);
    await userEvent.type(cogsInput, "-5");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));
    expect(await screen.findByText(/cogs unitaire invalide/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("submits and redirects to product detail on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm();

    await userEvent.type(screen.getByLabelText("Nom du produit"), "Test produit");
    const cogsInput = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogsInput);
    await userEvent.type(cogsInput, "10");

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "POST" })
    ));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/new-prod-id"));
  });

  it("shows API error when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Erreur serveur" }),
    });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Produit test");
    const cogsInput = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogsInput);
    await userEvent.type(cogsInput, "10");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  it("cancel navigates back to products list", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(mockPush).toHaveBeenCalledWith("/fr/products");
  });

  it("submits the SKU when the user types one", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.type(screen.getByLabelText(/SKU/i), "BV-01");

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sku).toBe("BV-01");
  });

  it("hides the market select when lockedMarketId is set", () => {
    renderForm({ lockedMarketId: "m-2" });
    expect(screen.queryByLabelText("Marché")).not.toBeInTheDocument();
  });

  it("submits the locked market_id even when multiple markets are passed in", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm({ lockedMarketId: "m-2" });

    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.market_id).toBe("m-2");
  });

  it("still shows the market select when lockedMarketId is null (scope=all)", () => {
    renderForm({ lockedMarketId: null });
    expect(screen.getByLabelText("Marché")).toBeInTheDocument();
  });

  it("renders the image picker in the identity section", () => {
    renderForm();
    expect(screen.getByText("Ajouter une image")).toBeInTheDocument();
  });

  it("uploads the picked image after the product is created", async () => {
    mockDecode.mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "new-prod-id" } }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_url: "https://cdn/p.png" }) }); // image PUT

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.upload(
      screen.getByTestId("product-image-input"),
      new File(["x"], "p.png", { type: "image/png" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products");
    expect(mockFetch.mock.calls[1][0]).toBe("/api/products/new-prod-id/image");
    const imageBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(imageBody.data_url).toBe("data:image/png;base64,AAA");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/new-prod-id"));
  });

  it("does not call the image route when no image is picked", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "new-prod-id" } }) });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls.some((c) => String(c[0]).endsWith("/image"))).toBe(false);
  });

  it("omits sku from body when left blank", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sku).toBeUndefined();
  });
});
