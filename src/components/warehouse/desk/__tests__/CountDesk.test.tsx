import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import frMessages from "@/messages/fr.json";
import { CountDesk } from "../CountDesk";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fr/warehouse/count",
  useSearchParams: () => new URLSearchParams("warehouse_id=T"),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

/** Compter: type first, Ordra's figure after — and nothing is written before « suivant ». */

const stock = {
  product_id: "p3",
  name: "Le mal et le remède",
  sku: null,
  image_url: null,
  current_stock: 122,
  low_stock_threshold: 40,
  engaged: 0,
  free: 122,
  last_counted_at: "2026-10-01T10:00:00Z",
  sites: [{ warehouse_id: "T", code: "t", name: "طرابلس", current_stock: 122, last_counted_at: "2026-10-01T10:00:00Z" }],
  unallocated: 0,
  incoming: null,
};

let stockRows: Array<Record<string, unknown>> | null = null;
const posts: Array<Record<string, unknown>> = [];
beforeEach(() => {
  posts.length = 0;
  stockRows = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json({ ok: true });
      }
      if (String(u).startsWith("/api/warehouse/stock")) return json({ rows: stockRows ?? [stock] });
      return json({
        sites: [
          { id: "T", code: "t", name: "طرابلس", nameFr: "Tripoli", isDefault: true, marketId: "m" },
          { id: "B", code: "b", name: "بنغازي", nameFr: "Benghazi", isDefault: false, marketId: "m" },
        ],
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCount() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
        <CountDesk market="ly" productId={null} />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("CountDesk", () => {
  it("lists what is left to count 25 at a time, and follows the product being counted", async () => {
    stockRows = Array.from({ length: 30 }, (_, i) => ({ ...stock, product_id: `p${i}`, name: `Produit ${String(i).padStart(2, "0")}`, sites: [] }));
    renderCount();
    await screen.findByLabelText("Quantité comptée");
    expect(screen.getAllByTestId("todo-item")).toHaveLength(25);
    for (let i = 0; i < 25; i++) fireEvent.click(screen.getByRole("button", { name: /Passer/ }));
    expect(screen.getAllByTestId("todo-item")).toHaveLength(5);
    expect(screen.getByTestId("pager")).toHaveTextContent("26–30 sur 30");
  });

  it("hides what Ordra expects until the count is validated, and writes only on « suivant »", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
          <CountDesk market="ly" productId={null} />
        </NextIntlClientProvider>
      </SWRConfig>,
    );
    const field = await screen.findByLabelText("Quantité comptée");
    expect(document.body).not.toHaveTextContent("122");
    fireEvent.change(field, { target: { value: "118" } });
    fireEvent.click(screen.getByRole("button", { name: /Valider le compte/ }));
    expect(screen.getByTestId("reveal")).toHaveTextContent("122");
    expect(screen.getByTestId("reveal")).toHaveTextContent("−4");
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Corriger à 118/ }));
    await waitFor(() => expect(posts[0]).toMatchObject({ product_id: "p3", counted_qty: 118, warehouse_id: "T" }));
  });
});
