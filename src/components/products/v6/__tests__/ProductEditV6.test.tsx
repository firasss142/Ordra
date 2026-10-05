import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { ToastProvider } from "@/components/ui/Toast";
import type { ProductSheetOverviewResponse } from "@/types/product-overview";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/fr/products/qr/edit",
  useSearchParams: () => new URLSearchParams(""),
}));

import { ProductEditV6, type EditableProductV6 } from "../ProductEditV6";

const NOW = new Date("2026-10-03T18:00:00Z");
const norm = (s: string | null | undefined) =>
  (s ?? "").replace(/[⁦⁩]/g, "").replace(/[  ]/g, " ");

const PRODUCT: EditableProductV6 = {
  id: "qr",
  name: "القرآن تدبر وعمل",
  sku: "qr-01",
  description: null,
  image_url: null,
  agent_brief: null,
  agent_brief_tone: "info",
  agent_notes: null,
  agent_composition: null,
  agent_contraindications: null,
  agent_usage: null,
  cross_sell_product_id: null,
  floor_price: null,
  unit_cogs: 40,
  packing_cost: 0.5,
  confirmation_processing_cost: 0,
  default_price: 249,
  low_stock_threshold: 99,
  is_active: true,
  current_stock: 943,
  damaged_return_count: 0,
};

/** The last 30 days of qr-01, per delivery: Darb 23,6 · 1 unit · 2,02 parcels-share… */
const OVERVIEW = {
  counts: { received: 581, rejected: 370, deleted: 47, cancelled: 0, calling: 5, to_upload: 1, uploaded: 158, delivered: 77, failed: 63, in_flight: 8, withdrawn: 10 },
  money: {
    deliveries: 77, paid: 19173, carrier: 1816.269, encaisse: 17356.731, cogs: 3080, packing: 77.8405, processing: 0,
    ads: 10566.192, net: 3632.6985, units: 77, parcels: 155.681, confirmed: 159, carrier_estimated: 0,
  },
  stock: { counted_at: null, scanned_30d: 56, returned_30d: 0, units_left_30d: 158, cover: 179, moves: [] },
  avg_delivery_cost: 22.8,
  currency: "LYD",
} as unknown as ProductSheetOverviewResponse;

let calls: { method: string; url: string; body: unknown }[];
let patchStatus = 200;
function installApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (d: unknown, status = 200) =>
        new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/products/qr/overview")) return json(OVERVIEW);
      if (url === "/api/products/qr" && method === "PATCH") return json(patchStatus === 200 ? { data: {} } : { error: "SKU already in use" }, patchStatus);
      if (url === "/api/products/qr/agent-content" && method === "PUT") return json({ data: {} });
      return json({ error: "unhandled" }, 404);
    }),
  );
}

function renderEdit(role: "super_admin" | "market_manager" = "super_admin", initialTab?: "fiche") {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli" now={NOW}>
        <ToastProvider>
          <ProductEditV6
            locale="fr"
            role={role}
            currency="LYD"
            product={PRODUCT}
            variants={[]}
            crossSellOptions={[{ id: "da2", name: "كتاب الداء والدواء" }]}
            initialTab={initialTab}
          />
        </ToastProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  nav.refresh.mockClear();
  patchStatus = 200;
  installApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });

describe("ProductEditV6 — tabs, one save", () => {
  test("a super admin gets five tabs, General first; nothing to save yet", () => {
    renderEdit();
    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names).toEqual(["Général", "Prix & coûts", "Variantes", "Stock", "Fiche agent"]);
    expect(tab("Général")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(document.querySelector(".savebar")).toBeNull();
  });

  test("a market manager gets the agent sheet only, and is told why", () => {
    renderEdit("market_manager");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Fiche agent"]);
    expect(screen.getByText("Les autres onglets sont réservés au super admin.")).toBeInTheDocument();
  });

  test("an edit lights its tab and raises the save bar", () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText(/Nom du produit/), { target: { value: "Coran" } });
    expect(tab("Général").querySelector(".dd")).not.toBeNull();
    expect(norm(document.querySelector(".savebar")?.textContent)).toContain("1 modification(s) non enregistrée(s)");
    expect(screen.getAllByRole("button", { name: "Enregistrer" })[0]).toBeEnabled();
  });

  test("an empty name blocks the save, flags General in red and says why", async () => {
    renderEdit();
    fireEvent.click(tab("Prix & coûts"));
    fireEvent.click(tab("Général"));
    fireEvent.change(screen.getByLabelText(/Nom du produit/), { target: { value: " " } });
    fireEvent.click(tab("Stock"));
    fireEvent.click(within(document.querySelector(".savebar") as HTMLElement).getByRole("button", { name: /Enregistrer/ }));
    await screen.findByText("Le nom est obligatoire.", { selector: ".errmsg" });
    expect(tab("Général")).toHaveAttribute("aria-selected", "true");
    expect(tab("Général").querySelector(".dd.err")).not.toBeNull();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("the rail recomputes one delivery as the cost is typed", async () => {
    renderEdit();
    fireEvent.click(tab("Prix & coûts"));
    await waitFor(() => expect(norm(document.querySelector(".rail")?.textContent)).toContain("Bénéfice brut par livraison"));
    // 249 − 23,6 (Darb) − 40 − 1,0 (packaging) − 137,2 (ads) = +47,2
    expect(norm(document.querySelector(".rail")?.textContent)).toContain("+47,2 د.ل");
    fireEvent.change(screen.getByLabelText(/Coût d’achat/), { target: { value: "50" } });
    expect(norm(document.querySelector(".rail")?.textContent)).toContain("+37,2 د.ل");
    expect(norm(document.querySelector(".rail")?.textContent)).toContain("Moyennes des 30 derniers jours · 77 livraisons");
    expect(norm(document.querySelector(".rail")?.textContent)).toContain("recalcule le bénéfice brut");
  });

  test("one save writes the product and the agent sheet, then stays", async () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText(/Nom du produit/), { target: { value: "Coran" } });
    fireEvent.click(tab("Fiche agent"));
    fireEvent.change(screen.getByLabelText(/À savoir/), { target: { value: "Livré sous 48 h" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Enregistrer/ })[0]);
    await screen.findByText("Enregistré");
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("/api/products/qr");
    expect(patch?.body).toMatchObject({ name: "Coran" });
    const content = calls.find((c) => c.url === "/api/products/qr/agent-content");
    expect(content?.body).toMatchObject({ agent_brief: "Livré sous 48 h", agent_brief_tone: "info" });
    expect(document.querySelector(".savebar")).toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
  });

  test("a SKU taken by another product sends you back to General with the reason", async () => {
    patchStatus = 409;
    renderEdit();
    fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: "DA2" } });
    fireEvent.click(tab("Stock"));
    fireEvent.click(screen.getAllByRole("button", { name: /Enregistrer/ })[0]);
    await screen.findByText("Ce SKU est déjà utilisé par un autre produit.", { selector: ".errmsg" });
    expect(tab("Général")).toHaveAttribute("aria-selected", "true");
  });

  test("cancel asks before throwing changes away", () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText(/Nom du produit/), { target: { value: "Coran" } });
    fireEvent.click(within(document.querySelector(".savebar") as HTMLElement).getByRole("button", { name: "Annuler" }));
    expect(norm(document.querySelector(".savebar")?.textContent)).toContain("Abandonner 1 modification(s) ?");
    fireEvent.click(screen.getByRole("button", { name: "Abandonner" }));
    expect(screen.getByLabelText(/Nom du produit/)).toHaveValue("القرآن تدبر وعمل");
    expect(document.querySelector(".savebar")).toBeNull();
  });

  test("the agent sheet tab previews what the agent will see, with the characters left", () => {
    renderEdit("super_admin", "fiche");
    expect(tab("Fiche agent")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Rien pour l’instant : l’agent ne voit que le nom et le prix.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/À savoir/), { target: { value: "Fragile" } });
    expect(norm(document.querySelector(".pv")?.textContent)).toContain("Fragile");
    expect(norm(document.querySelector("#briefCount")?.textContent)).toBe("273 caractères restants");
  });
  test("the stock tab gives the last count as a plain fact", async () => {
    renderEdit();
    fireEvent.click(tab("Stock"));
    expect(await screen.findByText("Dernier comptage : jamais")).toBeInTheDocument();
    expect(screen.queryByText("Jamais compté")).toBeNull();
  });
});
