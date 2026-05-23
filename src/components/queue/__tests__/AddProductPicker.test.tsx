import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";
import { AddProductPicker } from "../AddProductPicker";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const PRODUCTS = [
  {
    id: "p-1",
    market_id: "m-tn",
    name: "iPhone 15",
    unit_price: 2200,
    current_stock: 10,
    is_active: true,
    image_url: null,
    product_variants: [],
  },
  {
    id: "p-2",
    market_id: "m-tn",
    name: "Samsung S24",
    unit_price: 1900,
    current_stock: 5,
    is_active: true,
    image_url: null,
    product_variants: [],
  },
  {
    id: "p-3",
    market_id: "m-tn",
    name: "Xiaomi Redmi",
    unit_price: 800,
    current_stock: 0,
    is_active: true,
    image_url: null,
    product_variants: [],
  },
];

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

function mockFetchProducts(products = PRODUCTS) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/products/search")) {
        return {
          ok: true,
          json: async () => ({ data: products }),
        };
      }
      if (typeof url === "string" && url.endsWith("/items") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        return {
          ok: true,
          json: async () => ({
            data: {
              id: "item-new",
              order_id: "o-1",
              product_id: body.product_id,
              product_name:
                products.find((p) => p.id === body.product_id)?.name ?? "?",
              quantity: body.quantity,
              unit_price: body.unit_price,
              line_total: body.unit_price * body.quantity,
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddProductPicker", () => {
  it("fetches products scoped to the order's market_id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: PRODUCTS }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const called = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/api/products/search"),
    );
    expect(called).toBeDefined();
    expect(String(called![0])).toContain("market_id=m-tn");
  });

  it("renders the product list once SWR resolves", async () => {
    mockFetchProducts();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
      { wrapper },
    );

    expect(await screen.findByText("iPhone 15")).toBeDefined();
    expect(screen.getByText("Samsung S24")).toBeDefined();
    expect(screen.getByText("Xiaomi Redmi")).toBeDefined();
  });

  it("filters the list as the user types (no debounce, instant)", async () => {
    mockFetchProducts();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
      { wrapper },
    );

    const input = (await screen.findByPlaceholderText(
      "Rechercher un produit…",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "samsung" } });

    expect(screen.queryByText("iPhone 15")).toBeNull();
    expect(screen.getByText("Samsung S24")).toBeDefined();
    expect(screen.queryByText("Xiaomi Redmi")).toBeNull();
  });

  it("renders noResults when filter empties the list", async () => {
    mockFetchProducts();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
      { wrapper },
    );

    const input = (await screen.findByPlaceholderText(
      "Rechercher un produit…",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nothingmatches" } });

    expect(screen.getByText("Aucun produit")).toBeDefined();
  });

  it("Esc invokes onClose", async () => {
    mockFetchProducts();
    const onClose = vi.fn();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={onClose}
        onAdded={vi.fn()}
      />,
      { wrapper },
    );

    const input = await screen.findByPlaceholderText("Rechercher un produit…");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a product POSTs to /api/orders/{id}/items and calls onAdded then onClose", async () => {
    mockFetchProducts();
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={onClose}
        onAdded={onAdded}
      />,
      { wrapper },
    );

    const row = await screen.findByText("iPhone 15");
    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/items") && c[1]?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1].body);
    expect(body).toEqual({ product_id: "p-1", quantity: 1, unit_price: 2200 });
    expect(onAdded).toHaveBeenCalled();
  });

  it("ArrowDown + Enter selects the second product", async () => {
    mockFetchProducts();
    const onAdded = vi.fn();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={vi.fn()}
        onAdded={onAdded}
      />,
      { wrapper },
    );

    const input = (await screen.findByPlaceholderText(
      "Rechercher un produit…",
    )) as HTMLInputElement;

    await waitFor(() => expect(screen.getByText("Samsung S24")).toBeDefined());

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/items") && c[1]?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1].body);
    expect(body.product_id).toBe("p-2");
  });

  it("surfaces server error and keeps the popover open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/api/products/search")) {
          return { ok: true, json: async () => ({ data: PRODUCTS }) };
        }
        if (String(url).endsWith("/items") && init?.method === "POST") {
          return {
            ok: false,
            json: async () => ({ error: "Product is out of stock" }),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const onClose = vi.fn();
    render(
      <AddProductPicker
        orderId="o-1"
        marketId="m-tn"
        currentItemIds={[]}
        onClose={onClose}
        onAdded={vi.fn()}
      />,
      { wrapper },
    );

    const row = await screen.findByText("Xiaomi Redmi");
    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() =>
      expect(screen.getByText(/out of stock/i)).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
