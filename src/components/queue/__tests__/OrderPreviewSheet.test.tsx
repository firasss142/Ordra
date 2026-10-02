import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import React from "react";
import type { OrderPreview } from "@/lib/agent-search/preview";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

import { OrderPreviewSheet } from "../OrderPreviewSheet";

const preview = (over: Partial<OrderPreview> = {}): OrderPreview => ({
  id: "o2",
  external_id: "49874",
  status: "out_for_delivery",
  created_at: "2026-09-22T09:18:00Z",
  archived: false,
  customer_name: "Hèla Ben Salah",
  customer_phone: "+21698123456",
  customer_phone_2: "22410987",
  customer_city: "Sfax",
  customer_address: "Route de Tunis km 4",
  total_price: 96,
  currency: "TND",
  tracking_number: "NVX-2291044",
  carrier_name: "Navex",
  owner: "other",
  owner_name: "Walid",
  access: "view",
  items: [{ product_name: "Biovera - Routine Anti-Cellulite", variant_label: null, quantity: 2, line_total: 96 }],
  history: [
    { status_to: "pending", created_at: "2026-09-22T09:18:00Z", note: null, actor_name: null },
    { status_to: "confirmed", created_at: "2026-09-22T10:02:00Z", note: "Livrer l'après-midi", actor_name: "Walid" },
  ],
  ...over,
});

const fetchMock = vi.fn();
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

function renderSheet(props: Partial<React.ComponentProps<typeof OrderPreviewSheet>> = {}) {
  const onClose = vi.fn();
  const onOpenOwn = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrderPreviewSheet orderId="o2" onClose={onClose} onOpenOwn={onOpenOwn} {...props} />
    </SWRConfig>,
  );
  return { onClose, onOpenOwn };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("OrderPreviewSheet", () => {
  it("reads the preview endpoint, never the order panel's", async () => {
    respond(200, { data: preview() });
    renderSheet();
    await screen.findByText("Hèla Ben Salah");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/agent/orders/o2/preview");
  });

  it("says why it is read-only and whose order it is", async () => {
    respond(200, { data: preview() });
    renderSheet();
    expect(await screen.findByText(/cette commande n'est pas dans votre file/)).toBeDefined();
    expect(screen.getByText("Chez Walid")).toBeDefined();
    expect(screen.getAllByText("Lecture seule").length).toBeGreaterThan(0);
  });

  it("shows what the agent needs to answer the caller", async () => {
    respond(200, { data: preview() });
    renderSheet();
    await screen.findByText("Hèla Ben Salah");
    for (const text of ["+21698123456", "22410987", "Sfax", "Route de Tunis km 4", "Biovera - Routine Anti-Cellulite", "Navex", "NVX-2291044", "#49874"]) {
      expect(screen.getByText(text)).toBeDefined();
    }
  });

  it("lists the timeline newest first, signed, with its notes", async () => {
    respond(200, { data: preview() });
    renderSheet();
    const list = await screen.findByRole("list", { name: "Historique" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0].textContent).toContain("par Walid");
    expect(items[0].textContent).toContain("Livrer l'après-midi");
    expect(items[1].textContent).toContain("Système");
  });

  it("has nothing to edit and no action but copying the reference", async () => {
    respond(200, { data: preview() });
    renderSheet();
    await screen.findByText("Hèla Ben Salah");
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    const buttons = within(dialog).getAllByRole("button").map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
    expect(buttons.sort()).toEqual(["Copier la référence", "Fermer", "Fermer"].sort());
  });

  it("copies the reference for the manager", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    respond(200, { data: preview() });
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "Copier la référence" }));
    expect(writeText).toHaveBeenCalledWith("#49874");
    expect(await screen.findByText("Référence #49874 copiée")).toBeDefined();
  });

  it("closes", async () => {
    respond(200, { data: preview() });
    const { onClose } = renderSheet();
    await screen.findByText("Hèla Ben Salah");
    fireEvent.click(screen.getAllByRole("button", { name: "Fermer" })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("hands the agent's own order to the real panel instead of previewing it", async () => {
    respond(200, { data: preview({ owner: "me", owner_name: null, access: "full" }) });
    const { onOpenOwn } = renderSheet();
    await waitFor(() => expect(onOpenOwn).toHaveBeenCalledWith("o2"));
  });

  it("says plainly when the order is not in the agent's market", async () => {
    respond(404, { error: "Order not found" });
    renderSheet();
    expect(await screen.findByText("Cette commande est introuvable dans votre marché.")).toBeDefined();
  });
});
