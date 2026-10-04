import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ToastProvider } from "@/components/ui/Toast";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fr/products/new",
  useSearchParams: () => new URLSearchParams(""),
}));
// Decoding needs a real canvas, which jsdom does not have.
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: vi.fn(async () => ({ ok: true, dataUrl: "data:image/jpeg;base64,AAA" })),
}));

import { ProductCreateV6 } from "../ProductCreateV6";

const v6 = fr.products.v6;
const norm = (s: string | null | undefined) => (s ?? "").replace(/[⁦⁩]/g, "").replace(/[  ]/g, " ");

const LY = { id: "00000000-0000-0000-0000-000000000002", name: "Libye", currency: "LYD" };
const TN = { id: "00000000-0000-0000-0000-000000000001", name: "Tunisie", currency: "TND" };

let calls: { method: string; url: string; body: unknown }[];
let createStatus = 201;
let createBody: unknown = { data: { id: "new-1" } };
function installApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (d: unknown, status = 200) =>
        new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
      if (url === "/api/products" && method === "POST") return json(createBody, createStatus);
      if (url.endsWith("/image") && method === "PUT") return json({ data: {} });
      return new Response("{}", { status: 404 });
    }),
  );
}

function renderCreate(o: { markets?: (typeof LY)[]; locked?: string | null } = {}) {
  const markets = o.markets ?? [LY, TN];
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <ToastProvider>
        <ProductCreateV6
          locale="fr"
          markets={markets}
          defaultMarketId={o.locked ?? markets[0].id}
          lockedMarketId={o.locked === undefined ? LY.id : o.locked}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const create = () => fireEvent.click(screen.getAllByRole("button", { name: v6.n_create })[0]);
const posted = () => calls.find((c) => c.method === "POST")?.body as Record<string, unknown> | undefined;

beforeEach(() => {
  nav.push.mockClear();
  createStatus = 201;
  createBody = { data: { id: "new-1" } };
  installApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProductCreateV6 — the edit page's design, for a product that does not exist yet", () => {
  test("four tabs, General first, the page titled « Nouveau produit », no save bar before anything is typed", () => {
    renderCreate();
    expect(screen.getByRole("heading", { level: 1, name: v6.n_title })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([v6.tab_general, v6.tab_prix, v6.tab_var, v6.tab_stock]);
    expect(tab(v6.tab_general)).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".savebar")).toBeNull();
  });

  test("typing raises the save bar, which says what is still missing", () => {
    renderCreate();
    type(/Nom du produit/, "Coran");
    expect(screen.getByRole("region", { name: "save" })).toHaveTextContent(v6.n_incomplete);
    fireEvent.click(tab(v6.tab_prix));
    type(/Coût d’achat/, "40");
    expect(screen.getByRole("region", { name: "save" })).toHaveTextContent(v6.n_ready);
  });

  test("no name: refused without calling the server, the General tab gets the red dot", async () => {
    renderCreate();
    create();
    expect(await screen.findAllByText(v6.t_name)).not.toHaveLength(0);
    expect(posted()).toBeUndefined();
    expect(tab(v6.tab_general).querySelector(".dd.err")).not.toBeNull();
  });

  test("no purchase cost: the page jumps to Prix & coûts and says why", async () => {
    renderCreate();
    type(/Nom du produit/, "Coran");
    create();
    await waitFor(() => expect(tab(v6.tab_prix)).toHaveAttribute("aria-selected", "true"));
    expect(screen.getAllByText(v6.e_cogs).length).toBeGreaterThan(0);
    expect(posted()).toBeUndefined();
  });

  test("creates with the same body as before, then opens the product's sheet", async () => {
    renderCreate();
    type(/Nom du produit/, "  Coran  ");
    type(/SKU/, "qr-01");
    fireEvent.click(tab(v6.tab_prix));
    type(/Prix catalogue/, "249");
    type(/Coût d’achat/, "40");
    type(/Emballage/, "0,5");
    fireEvent.click(tab(v6.tab_stock));
    type(/Stock initial/, "120");
    type(/Seuil stock bas/, "10");
    create();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/fr/products/new-1"));
    expect(posted()).toEqual({
      name: "Coran",
      sku: "qr-01",
      market_id: LY.id,
      unit_cogs: 40,
      default_price: 249,
      packing_cost: 0.5,
      confirmation_processing_cost: 0,
      initial_stock: 120,
      low_stock_threshold: 10,
    });
  });

  test("a blank SKU and a blank price are left out of the body", async () => {
    renderCreate();
    type(/Nom du produit/, "Coran");
    fireEvent.click(tab(v6.tab_prix));
    type(/Coût d’achat/, "40");
    create();
    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()).not.toHaveProperty("sku");
    expect(posted()).not.toHaveProperty("default_price");
  });

  test("a SKU already in use comes back on the SKU field of the General tab", async () => {
    createStatus = 409;
    createBody = { error: "SKU already in use" };
    renderCreate();
    type(/Nom du produit/, "Coran");
    type(/SKU/, "qr-01");
    fireEvent.click(tab(v6.tab_prix));
    type(/Coût d’achat/, "40");
    create();
    await waitFor(() => expect(tab(v6.tab_general)).toHaveAttribute("aria-selected", "true"));
    expect(screen.getAllByText(v6.e_sku).length).toBeGreaterThan(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  test("a 207 (product made, a size not) opens the product with the message", async () => {
    createStatus = 207;
    createBody = { data: { id: "new-1" }, error: "Variant M failed" };
    renderCreate();
    type(/Nom du produit/, "Coran");
    fireEvent.click(tab(v6.tab_prix));
    type(/Coût d’achat/, "40");
    create();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/fr/products/new-1"));
    expect(await screen.findByText("Variant M failed")).toBeInTheDocument();
  });

  test("the picked photo is uploaded once the product exists", async () => {
    renderCreate();
    type(/Nom du produit/, "Coran");
    const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: v6.f_remove })).toBeInTheDocument());
    fireEvent.click(tab(v6.tab_prix));
    type(/Coût d’achat/, "40");
    create();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/fr/products/new-1"));
    expect(calls.find((c) => c.url === "/api/products/new-1/image")?.body).toEqual({ data_url: "data:image/jpeg;base64,AAA" });
  });

  test("the market: chosen when not locked, its currency on every amount; hidden when locked", () => {
    renderCreate({ locked: null });
    fireEvent.change(screen.getByLabelText(v6.n_market), { target: { value: TN.id } });
    fireEvent.click(tab(v6.tab_prix));
    expect(document.querySelector(".unit .u")?.textContent).toBe("DT");
  });

  test("a locked market shows no market field", () => {
    renderCreate();
    expect(screen.queryByLabelText(v6.n_market)).toBeNull();
  });

  test("the rail shows the margin per piece as it is typed", () => {
    renderCreate();
    fireEvent.click(tab(v6.tab_prix));
    expect(screen.getByText(v6.n_m_empty)).toBeInTheDocument();
    type(/Prix catalogue/, "100");
    type(/Coût d’achat/, "40");
    type(/Emballage/, "5");
    const rail = document.querySelector(".rail") as HTMLElement;
    expect(norm(rail.textContent)).toContain("55");
  });

  describe("sizes", () => {
    test("off by default; turning them on moves cost, price, SKU and opening stock to each size", () => {
      renderCreate();
      fireEvent.click(tab(v6.tab_var));
      expect(screen.getByText(v6.v_emptyT)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: v6.v_size }));
      expect(screen.getAllByLabelText(new RegExp(v6.n_v_label))).toHaveLength(1);
      fireEvent.click(tab(v6.tab_general));
      expect(screen.queryByLabelText(/SKU/)).toBeNull();
      fireEvent.click(tab(v6.tab_prix));
      expect(screen.queryByLabelText(/Coût d’achat/)).toBeNull();
      expect(screen.getByText(v6.n_var_moved)).toBeInTheDocument();
      fireEvent.click(tab(v6.tab_stock));
      expect(screen.queryByLabelText(/Stock initial/)).toBeNull();
    });

    test("the last size cannot be removed; « produit simple » turns sizes off", () => {
      renderCreate();
      fireEvent.click(tab(v6.tab_var));
      fireEvent.click(screen.getByRole("button", { name: v6.v_size }));
      expect(screen.getByRole("button", { name: v6.n_v_remove })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: v6.v_size }));
      expect(screen.getAllByRole("button", { name: v6.n_v_remove })[0]).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: v6.n_v_simple }));
      expect(screen.getByText(v6.v_emptyT)).toBeInTheDocument();
    });

    test("a size without a name or a price is refused without calling the server", async () => {
      renderCreate();
      type(/Nom du produit/, "Robe");
      fireEvent.click(tab(v6.tab_var));
      fireEvent.click(screen.getByRole("button", { name: v6.v_size }));
      create();
      expect((await screen.findAllByText(v6.e_v_label)).length).toBeGreaterThan(0);
      type(new RegExp(v6.n_v_label), "M");
      create();
      expect((await screen.findAllByText(v6.e_v_price)).length).toBeGreaterThan(0);
      expect(posted()).toBeUndefined();
    });

    test("sends the sizes and no product cost, price, SKU or opening stock", async () => {
      renderCreate();
      type(/Nom du produit/, "Robe");
      fireEvent.click(tab(v6.tab_var));
      fireEvent.click(screen.getByRole("button", { name: v6.v_size }));
      fireEvent.click(screen.getByRole("button", { name: v6.v_size }));
      const labels = screen.getAllByLabelText(new RegExp(v6.n_v_label));
      const prices = screen.getAllByLabelText(new RegExp(v6.n_v_price));
      const costs = screen.getAllByLabelText(v6.n_v_cogs);
      const stocks = screen.getAllByLabelText(v6.n_v_stock);
      fireEvent.change(labels[0], { target: { value: "M" } });
      fireEvent.change(prices[0], { target: { value: "120" } });
      fireEvent.change(costs[0], { target: { value: "30" } });
      fireEvent.change(stocks[0], { target: { value: "4" } });
      fireEvent.change(labels[1], { target: { value: "L" } });
      fireEvent.change(prices[1], { target: { value: "130" } });
      fireEvent.change(stocks[1], { target: { value: "6" } });
      expect(norm(screen.getByText(/unités au total, la somme/).textContent)).toContain("10");
      create();
      await waitFor(() => expect(posted()).toBeDefined());
      const body = posted()!;
      expect(body.unit_cogs).toBe(0);
      expect(body.initial_stock).toBe(0);
      expect(body).not.toHaveProperty("sku");
      expect(body).not.toHaveProperty("default_price");
      expect(body.variants).toEqual([
        { label: "M", sku: null, unit_cogs: 30, display_price: 120, initial_stock: 4 },
        { label: "L", sku: null, unit_cogs: 0, display_price: 130, initial_stock: 6 },
      ]);
    });
  });
});
