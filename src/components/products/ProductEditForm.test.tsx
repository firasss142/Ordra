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
  agent_brief: null,
  agent_brief_tone: "info" as const,
  agent_notes: null,
  agent_composition: null,
  agent_contraindications: null,
  agent_usage: null,
  cross_sell_product_id: null,
  floor_price: null,
  unit_cogs: 5,
  packing_cost: 1,
  confirmation_processing_cost: 0,
  default_price: null,
  low_stock_threshold: 5,
  is_active: true,
};

type Variant = { id: string; label: string; agent_note: string | null };

function renderForm(
  overrides: Partial<typeof baseProduct> = {},
  {
    canManageCosts = true,
    variants = [] as Variant[],
    crossSellOptions = [] as { id: string; name: string }[],
  } = {},
) {
  return render(
    <ProductEditForm
      product={{ ...baseProduct, ...overrides }}
      locale="fr"
      canManageCosts={canManageCosts}
      variants={variants}
      crossSellOptions={crossSellOptions}
    />,
  );
}

/** Every successful save ends with the agent-content PUT. */
function okResponse() {
  return { ok: true, json: async () => ({ success: true }) };
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_url: "https://cdn/p.png" }) }) // image PUT
      .mockResolvedValueOnce(okResponse()); // agent-content PUT

    renderForm();

    await userEvent.upload(
      screen.getByTestId("product-image-input"),
      new File(["x"], "p.png", { type: "image/png" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1");
    expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");

    expect(mockFetch.mock.calls[1][0]).toBe("/api/products/p-1/image");
    expect(mockFetch.mock.calls[1][1].method).toBe("PUT");
    const imageBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(imageBody.data_url).toBe("data:image/png;base64,AAA");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/p-1"));
  });

  it("does not call the image route when no new image is picked", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1");
    // No image PUT
    expect(mockFetch.mock.calls.some((c) => String(c[0]).endsWith("/image"))).toBe(false);
  });
});

describe("ProductEditForm — agent sheet authoring", () => {
  it("sends the agent content to its own route, separate from the cost PATCH", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();

    await userEvent.type(
      screen.getByLabelText("À savoir (épinglé)"),
      "Stock bleu épuisé",
    );
    await userEvent.type(screen.getByLabelText("Notes internes"), "Pack 2 à 79");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("/api/products/p-1/agent-content");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.agent_brief).toBe("Stock bleu épuisé");
    expect(body.agent_notes).toBe("Pack 2 à 79");
    expect(body.agent_brief_tone).toBe("info");
    // Costs must never ride along on the content route.
    expect(body.unit_cogs).toBeUndefined();
  });

  it("sends a note per pack tier", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm(
      {},
      { variants: [{ id: "v-1", label: "Pack 2", agent_note: null }] },
    );

    await userEvent.type(screen.getByLabelText("Pack 2"), "Meilleure marge");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.variant_notes).toEqual([{ id: "v-1", agent_note: "Meilleure marge" }]);
  });

  it("surfaces an agent-content failure instead of navigating away", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });

    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("ProductEditForm — product facts and cross-sell", () => {
  it("sends composition, usage and contraindications on the content route", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    await userEvent.type(screen.getByLabelText("Composition"), "Aloe vera");
    await userEvent.type(screen.getByLabelText("Mode d'emploi"), "Matin et soir");
    await userEvent.type(screen.getByLabelText("Contre-indications"), "Femmes enceintes");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.agent_composition).toBe("Aloe vera");
    expect(body.agent_usage).toBe("Matin et soir");
    expect(body.agent_contraindications).toBe("Femmes enceintes");
  });

  it("offers only the supplied same-market alternatives and sends the choice", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm({}, { crossSellOptions: [{ id: "p-alt", name: "Pack Duo" }] });
    await userEvent.selectOptions(screen.getByLabelText("Produit alternatif"), "p-alt");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).cross_sell_product_id).toBe("p-alt");
  });
});

describe("ProductEditForm — floor price stays with pricing", () => {
  it("sends floor_price on the super_admin PATCH, not the content route", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    await userEvent.type(screen.getByLabelText("Prix plancher"), "39");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).floor_price).toBe(39);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).floor_price).toBeUndefined();
  });

  it("is not offered to a market manager", () => {
    renderForm({}, { canManageCosts: false });
    expect(screen.queryByLabelText("Prix plancher")).not.toBeInTheDocument();
  });
});

describe("ProductEditForm — market manager (content only)", () => {
  it("hides costs, stock and identity fields", () => {
    renderForm({}, { canManageCosts: false });

    expect(screen.queryByLabelText(/COGS unitaire/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Seuil stock bas/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nom du produit/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/SKU/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("product-image-input")).not.toBeInTheDocument();
    // …but the agent sheet is theirs to write.
    expect(screen.getByLabelText("À savoir (épinglé)")).toBeInTheDocument();
    expect(screen.getByLabelText("Contre-indications")).toBeInTheDocument();
  });

  it("saves only through the agent-content route", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    renderForm({}, { canManageCosts: false });
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1/agent-content");
    expect(mockPush).toHaveBeenCalledWith("/fr/products/p-1");
  });
});
