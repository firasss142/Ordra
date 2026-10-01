import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MarketSearchRow } from "@/lib/agent-search/market";
import type { AgentMarketSearch } from "@/hooks/useAgentMarketSearch";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

// The shell's caches: empty, so every result here comes from the market.
vi.mock("swr", () => ({ default: () => ({ data: undefined }), preload: vi.fn() }));

let market: AgentMarketSearch = { rows: [], total: 0, pending: false, error: false };
const marketCalls: [string, boolean][] = [];
vi.mock("@/hooks/useAgentMarketSearch", () => ({
  useAgentMarketSearch: (q: string, enabled: boolean) => {
    marketCalls.push([q, enabled]);
    return market;
  },
}));

vi.mock("../OrderPreviewSheet", () => ({
  OrderPreviewSheet: ({ orderId }: { orderId: string | null }) =>
    orderId ? <div data-testid="preview">{orderId}</div> : null,
}));

import { QueueSearchBar } from "../QueueSearchBar";

const row = (over: Partial<MarketSearchRow>): MarketSearchRow => ({
  id: "o2",
  external_id: "30205",
  status: "in_transit",
  customer_name: "Hèla Ben Salah",
  customer_phone: "+21698123456",
  customer_phone_2: null,
  customer_city: "Sfax",
  customer_address: null,
  product_name: "Biovera - Routine Anti-Cellulite",
  variant_label: null,
  total_price: 96,
  currency: "TND",
  tracking_number: null,
  created_at: "2026-09-22T09:18:00Z",
  archived: false,
  owner: "other",
  owner_name: "Walid",
  access: "view",
  ...over,
});

const assign = vi.fn();

function open(query: string) {
  const onChange = vi.fn();
  render(<QueueSearchBar variant="navbar" value={query} onChange={onChange} />);
  fireEvent.focus(screen.getByRole("combobox"));
  return { onChange };
}

beforeEach(() => {
  market = { rows: [], total: 0, pending: false, error: false };
  marketCalls.length = 0;
  window.localStorage.clear();
  assign.mockReset();
  Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
});
afterEach(() => vi.restoreAllMocks());

describe("QueueSearchBar — the whole market", () => {
  it("searches the market only while the results are open", () => {
    open("hela");
    expect(marketCalls.at(-1)).toEqual(["hela", true]);
  });

  it("lists a colleague's order in a read-only group that says whose it is", () => {
    market = { rows: [row({})], total: 1, pending: false, error: false };
    open("hela");
    expect(screen.getByText("Autres commandes du marché")).toBeDefined();
    expect(screen.getByText("Lecture seule")).toBeDefined();
    expect(screen.getByText("Chez Walid")).toBeDefined();
    expect(screen.getByText("#30205")).toBeDefined();
  });

  it("marks an unassigned order as such", () => {
    market = { rows: [row({ owner: "none", owner_name: null })], total: 1, pending: false, error: false };
    open("hela");
    expect(screen.getByText("Non attribuée")).toBeDefined();
  });

  it("highlights the letters that matched, as written", () => {
    market = { rows: [row({})], total: 1, pending: false, error: false };
    open("hela");
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("Hèla");
  });

  it("says what it understood the query to be", () => {
    market = { rows: [row({})], total: 1, pending: false, error: false };
    open("98 123 4");
    expect(screen.getByText("Téléphone ou numéro · tous formats")).toBeDefined();
    expect(screen.getByText("Tout le marché")).toBeDefined();
  });

  it("says it is still searching the market while the answer is on its way", () => {
    market = { rows: [], total: 0, pending: true, error: false };
    open("hela");
    expect(screen.getByText("Recherche dans tout le marché…")).toBeDefined();
    expect(screen.queryByText(/Aucune commande ne correspond/)).toBeNull();
  });

  it("says nothing matched in the whole market once the market has answered", () => {
    open("zeineb");
    expect(screen.getByText("Aucune commande ne correspond à « zeineb » dans tout le marché.")).toBeDefined();
  });

  it("opens a colleague's order read-only, without navigating or clearing the query", () => {
    market = { rows: [row({})], total: 1, pending: false, error: false };
    const { onChange } = open("hela");
    fireEvent.mouseDown(screen.getByText("Chez Walid"));
    expect(screen.getByTestId("preview").textContent).toBe("o2");
    expect(assign).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("opens the agent's own order, found by the market, in the usual panel", () => {
    market = { rows: [row({ id: "x9", owner: "me", owner_name: null, access: "full" })], total: 1, pending: false, error: false };
    open("hela");
    fireEvent.mouseDown(screen.getByText("#30205"));
    expect(assign).toHaveBeenCalledWith("/fr/queue?openOrderId=x9");
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("keeps a phone's plus sign where it belongs in Arabic: each subtitle piece is isolated", () => {
    // Without isolation, "+218913456721" between Arabic words rendered as
    // "218913456721+" — the number read wrong to the agent.
    market = { rows: [row({ customer_phone: "+218913456721" })], total: 1, pending: false, error: false };
    open("hela");
    expect(screen.getByText("+218913456721").closest("bdi")).not.toBeNull();
  });

  it("lets a typed number keep its own direction in an Arabic field", () => {
    open("091 345 67");
    expect(screen.getByRole("combobox").getAttribute("dir")).toBe("auto");
  });

  it("counts what the market holds beyond the rows shown", () => {
    market = {
      rows: Array.from({ length: 5 }, (_, i) => row({ id: `v${i}` })),
      total: 23,
      pending: false,
      error: false,
    };
    open("hela");
    expect(screen.getByText("5 sur 23")).toBeDefined();
  });
});
