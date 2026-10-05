import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import frMessages from "@/messages/fr.json";
import { StockDesk } from "../StockDesk";

let search = new URLSearchParams();
let stockRows: Array<Record<string, unknown>> | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fr/warehouse/stock",
  useSearchParams: () => search,
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const row = (over: Record<string, unknown>) => ({
  product_id: "p1",
  name: "Tapis de prière",
  sku: "TP-1",
  image_url: null,
  current_stock: 153,
  low_stock_threshold: 40,
  stock_goal: null,
  goal_pct: null,
  damaged_return_count: 0,
  engaged: 3,
  free: 150,
  last_counted_at: null,
  accuracy: null,
  series: [],
  sites: [
    { warehouse_id: "T", code: "t", name: "طرابلس", current_stock: 96, last_counted_at: "2026-10-01T10:00:00Z" },
    { warehouse_id: "B", code: "b", name: "بنغازي", current_stock: 57, last_counted_at: null },
  ],
  unallocated: 0,
  incoming: 60,
  ...over,
});

const urls: string[] = [];
beforeEach(() => {
  urls.length = 0;
  search = new URLSearchParams();
  stockRows = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      const url = String(u);
      urls.push(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/warehouse/stock"))
        return json({ rows: stockRows ?? [row({}), row({ product_id: "p2", name: "Tasse", free: -1, current_stock: 0, sites: [] })] });
      if (url.startsWith("/api/warehouse/history"))
        return json({
          rows: Array.from({ length: 25 }, (_, i) => ({ id: `${url.includes("cursor=") ? "b" : "a"}${i}`, kind: "scan", at: "2026-10-05T10:00:00Z", product_id: "p1", product_name: "Tapis", qty_change: -1, order_number: null, is_damaged: false, note: null, detail: "", actor: null })),
          nextCursor: url.includes("cursor=") ? null : "CUR1",
        });
      if (url.startsWith("/api/warehouse/sites"))
        return json({ sites: [{ id: "T", code: "t", name: "طرابلس", nameFr: "Tripoli", isDefault: true, marketId: "m" }, { id: "B", code: "b", name: "بنغازي", nameFr: "Benghazi", isDefault: false, marketId: "m" }] });
      return json({ rows: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDesk() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
        <StockDesk market="ly" dateLabel="lundi 5 octobre" />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("StockDesk", () => {
  it("shows where each product sits, with a star where no count ever confirmed it", async () => {
    renderDesk();
    const [first] = await screen.findAllByTestId("stock-row");
    await waitFor(() => expect(first).toHaveTextContent("Tripoli 96"));
    expect(first).toHaveTextContent("Benghazi 57*");
    expect(first).toHaveTextContent("+60");
  });

  it("filters to what is promised beyond what is held", async () => {
    renderDesk();
    await screen.findAllByTestId("stock-row");
    fireEvent.click(screen.getByRole("button", { name: /À découvert/ }));
    expect(screen.getAllByTestId("stock-row")).toHaveLength(1);
    expect(screen.getByTestId("stock-row")).toHaveTextContent("Tasse");
  });

  it("opens a product: the free figure first, then each building with its own count button", async () => {
    renderDesk();
    fireEvent.click((await screen.findAllByTestId("stock-row"))[0]);
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("150")).toBeInTheDocument();
    expect(within(drawer).getAllByRole("link", { name: /Compter/ }).some((a) => a.getAttribute("href")?.includes("warehouse_id=B"))).toBe(true);
  });

  it("asks the journal for arrivals when that chip is pressed", async () => {
    search = new URLSearchParams("tab=journal");
    renderDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Arrivages" }));
    await waitFor(() => expect(urls.some((u) => u.includes("kind=reception"))).toBe(true));
  });

  it("pages the products 25 at a time", async () => {
    stockRows = Array.from({ length: 30 }, (_, i) => row({ product_id: `p${i}`, name: `Produit ${i}` }));
    renderDesk();
    await waitFor(() => expect(screen.getAllByTestId("stock-row")).toHaveLength(25));
    fireEvent.click(screen.getByRole("button", { name: /Page suivante/ }));
    expect(screen.getAllByTestId("stock-row")).toHaveLength(5);
  });

  it("walks the journal page by page with the server's cursor, and back", async () => {
    search = new URLSearchParams("tab=journal");
    renderDesk();
    await waitFor(() => expect(screen.getAllByTestId("journal-row")).toHaveLength(25));
    expect(urls.some((u) => u.includes("/api/warehouse/history") && u.includes("limit=25"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Page suivante/ }));
    await waitFor(() => expect(urls.some((u) => u.includes("cursor=CUR1"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("pager")).toHaveTextContent("26–50"));
    expect(screen.getByRole("button", { name: /Page suivante/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Page précédente/ }));
    await waitFor(() => expect(screen.getByTestId("pager")).toHaveTextContent("1–25"));
  });
});
