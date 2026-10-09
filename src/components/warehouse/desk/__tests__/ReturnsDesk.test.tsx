import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import frMessages from "@/messages/fr.json";
import { ReturnsDesk } from "../ReturnsDesk";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fr/warehouse/returns",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Rentrer on the desk: the oldest return first, and a drawer with two equal
 * choices. Abîmé never lands without a cause.
 */

const ret = (id: string, days: number) => ({
  id,
  customer_name: `client ${id}`,
  customer_phone: "",
  customer_city: "Benghazi",
  customer_address: null,
  product_id: "p1",
  product_name: "Gants de boxe",
  variant_label: null,
  quantity: 1,
  total_price: 150,
  status: "to_be_returned",
  created_at: "2026-09-01T00:00:00Z",
  tracking_number: null,
  carrier_sticker_ref: `77${id}`,
  carrier_status_slug: null,
  warehouse_id: "B",
  returned_at: null,
  days_at_carrier: days,
  current_stock: null,
  low_stock_threshold: null,
});

let darbOrders = [ret("a1", 41), ret("a2", 5)];
const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
beforeEach(() => {
  posts.length = 0;
  darbOrders = [ret("a1", 41), ret("a2", 5)];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ ok: true });
      }
      if (url.startsWith("/api/warehouse/returns/stats")) return json({ doneToday: 0, restockedToday: 0, currency: "LYD" });
      if (url.includes("state=way")) return json({ orders: [ret("w1", 3)] });
      if (url.startsWith("/api/warehouse/returns")) return json({ orders: darbOrders });
      if (url.startsWith("/api/warehouse/sites"))
        return json({ sites: [{ id: "B", code: "b", name: "بنغازي", nameFr: "Benghazi", isDefault: true, marketId: "m" }] });
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
        <ReturnsDesk market="ly" dateLabel="lundi 5 octobre" today="2026-10-05" />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("ReturnsDesk", () => {
  it("lists what Darb holds, the longest wait first, with its building", async () => {
    renderDesk();
    const rows = await screen.findAllByTestId("return-row");
    expect(rows[0]).toHaveTextContent("client a1");
    expect(rows[0]).toHaveTextContent("41 j chez Darb");
    await waitFor(() => expect(rows[0]).toHaveTextContent("Benghazi"));
  });

  it("restocks an intact return in two gestures", async () => {
    renderDesk();
    fireEvent.click(within((await screen.findAllByTestId("return-row"))[0]).getByRole("button", { name: /Réceptionner/ }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByRole("button", { name: /Valider/ })).toBeDisabled();
    fireEvent.click(within(drawer).getByRole("button", { name: /Intact/ }));
    fireEvent.click(within(drawer).getByRole("button", { name: /Valider/ }));
    await waitFor(() => expect(posts[0]?.url).toBe("/api/warehouse/scan-return"));
    expect(posts[0].body).toMatchObject({ order_id: "a1", is_damaged: false, return_reason: null });
  });

  it("refuses a damaged return until its cause is chosen", async () => {
    renderDesk();
    fireEvent.click(within((await screen.findAllByTestId("return-row"))[0]).getByRole("button", { name: /Réceptionner/ }));
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: /^Abîmé/ }));
    expect(within(drawer).getByRole("button", { name: /Valider/ })).toBeDisabled();
    fireEvent.click(within(drawer).getByRole("button", { name: "Emballage" }));
    fireEvent.click(within(drawer).getByRole("button", { name: /Valider/ }));
    await waitFor(() => expect(posts[0]?.body).toMatchObject({ is_damaged: true, return_reason: "packaging" }));
  });

  it("shows what is still on its way to Darb from its tile", async () => {
    renderDesk();
    await screen.findAllByTestId("return-row");
    fireEvent.click(screen.getByRole("button", { name: /En route vers Darb/ }));
    await waitFor(() => expect(screen.getAllByTestId("return-row")[0]).toHaveTextContent("client w1"));
  });

  it("pages the returns 25 at a time", async () => {
    darbOrders = Array.from({ length: 40 }, (_, i) => ret(`r${i}`, 60 - i));
    renderDesk();
    await waitFor(() => expect(screen.getAllByTestId("return-row")).toHaveLength(25));
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getAllByTestId("return-row")).toHaveLength(15);
    expect(screen.getByTestId("pager")).toHaveTextContent("26–40 sur 40");
  });

  // Until the queue arrives the desk knew nothing — it used to say « 0 » and « Aucun colis
  // n'attend chez Darb » for a second, then 143 parcels replaced the empty state.
  it("paints placeholders, never a zero or an empty state, while the queue is on its way", async () => {
    const answered = globalThis.fetch as typeof fetch;
    vi.stubGlobal("fetch", vi.fn((u: string, init?: RequestInit) => (String(u).startsWith("/api/warehouse/returns") ? new Promise<Response>(() => {}) : answered(u, init))));
    const { container } = renderDesk();
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(container.querySelectorAll(".empty")).toHaveLength(0);
    expect([...container.querySelectorAll(".wt b")].map((b) => b.textContent)).not.toContain("0");
    expect(container.querySelectorAll(".wt.wait")).toHaveLength(3);
  });
});
