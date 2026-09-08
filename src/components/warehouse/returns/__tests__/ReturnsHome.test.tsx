import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ReturnsHome } from "../ReturnsHome";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

/**
 * Returns on the phone: scan first, decide second.
 *
 * The field is the first object on the screen because the parcel is already
 * in the agent's hand. A failed request names itself; a parcel the carrier
 * has not reported yet is refused with the rule spelled out; the three
 * decisions arrive only once a parcel is identified.
 */
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});
vi.mock("@/components/warehouse/QrScanner", () => ({
  QrScanner: () => <div data-testid="qr-scanner" />,
}));

const stats = { queueCount: 2, doneToday: 1, currency: "LYD" };
let statsData: typeof stats | undefined;
let pageData: { orders: WarehouseOrderRow[]; nextCursor: string | null } | undefined;
let pageError: Error | undefined;
const mutate = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key.includes("stats") ? statsData : pageData,
    error: key.includes("stats") ? undefined : pageError,
    isLoading: false,
    mutate,
  }),
}));

const row = (id: string, name: string, days: number, ref: string): WarehouseOrderRow => ({
  id, customer_name: name, customer_phone: "218", customer_city: "بنغازي", customer_area: null,
  customer_address: null, uploaded_at: null, branch_group: null, tracking_number: ref,
  carrier_sticker_ref: null, carrier_status_slug: "returned", has_carrier_ref: null,
  product_id: "p1", product_name: "كتاب الحفظ الميسر", variant_label: null, quantity: 1, total_price: 249,
  status: "to_be_returned", created_at: new Date(Date.now() - days * 86_400_000).toISOString(),
  current_stock: null, low_stock_threshold: null,
});
const older = row("aaaa1111-0000-4000-8000-000000000001", "سعاد المبروك", 4, "7700888");
const newer = row("aaaa1111-0000-4000-8000-000000000002", "هدى القماطي", 1, "990103");

function respond(body: unknown, ok = true) {
  const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });
  vi.stubGlobal("fetch", f);
  return f;
}
function scan(code: string) {
  const input = screen.getByLabelText("Scannez le colis retourné…");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  statsData = stats;
  pageData = { orders: [newer, older], nextCursor: null };
  pageError = undefined;
  mutate.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ReturnsHome — the list", () => {
  it("leads with the scan field, two counts, and the queue oldest first", () => {
    render(<ReturnsHome marketId="m-ly" />);
    expect(screen.getByLabelText("Scannez le colis retourné…")).toBeInTheDocument();
    expect(screen.getByTestId("wh-returns-chip-queue")).toHaveTextContent("2");
    expect(screen.getByTestId("wh-returns-chip-done")).toHaveTextContent("1");
    const cards = screen.getAllByTestId("wh-return-row");
    expect(cards[0]).toHaveTextContent("سعاد المبروك");
    expect(cards[0]).toHaveTextContent("7700888");
    expect(cards[1]).toHaveTextContent("هدى القماطي");
  });

  it("names a failed load and offers a retry, never a permanent placeholder", () => {
    pageData = undefined;
    pageError = new Error("500");
    render(<ReturnsHome marketId="m-ly" />);
    expect(screen.getByTestId("wh-returns-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(mutate).toHaveBeenCalled();
  });

  it("shows the product picture on the row", () => {
    pageData = { orders: [{ ...older, product_image_url: "https://img/p1.png" }], nextCursor: null };
    render(<ReturnsHome marketId="m-ly" />);
    expect(screen.getByTestId("wh-return-row").querySelector("img")).toHaveAttribute("src", "https://img/p1.png");
  });

  it("says the queue is empty in words", () => {
    pageData = { orders: [], nextCursor: null };
    render(<ReturnsHome marketId="m-ly" />);
    expect(screen.getByText(/File vide/)).toBeInTheDocument();
  });
});

describe("ReturnsHome — scan, then decide", () => {
  it("a found parcel opens the decision sheet; damage needs a reason before confirming", async () => {
    const f = respond({ outcome: "found", code: "7700888", order: older });
    render(<ReturnsHome marketId="m-ly" />);
    scan("7700888");
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("سعاد المبروك");
    const confirm = within(sheet).getByRole("button", { name: "Valider la décision" });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: /Endommagé/ }));
    expect(confirm).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Emballage" }));
    expect(confirm).toBeEnabled();

    f.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, stock_after: 238 }) });
    fireEvent.click(confirm);
    await waitFor(() => expect(within(sheet).getByTestId("wh-return-done")).toBeInTheDocument());
    const call = f.mock.calls.find((c) => String(c[0]).includes("scan-return"))!;
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body).toMatchObject({ order_id: older.id, is_damaged: true, return_reason: "packaging" });
    expect(mutate).toHaveBeenCalled();
  });

  it("redeliver goes through the received endpoint and touches no stock", async () => {
    const f = respond({ outcome: "found", code: "7700888", order: older });
    render(<ReturnsHome marketId="m-ly" />);
    scan("7700888");
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /Rélivrer/ }));
    f.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
    fireEvent.click(within(sheet).getByRole("button", { name: "Valider la décision" }));
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).includes("scan-received"))).toBe(true));
  });

  it("refuses a parcel the carrier has not reported, and says so with the rule", async () => {
    respond({ outcome: "wrong_status", code: "7700001", status: "in_transit", order: { ...older, customer_name: "علي" } });
    render(<ReturnsHome marketId="m-ly" />);
    scan("7700001");
    const verdict = await screen.findByTestId("wh-return-verdict");
    expect(verdict).toHaveAttribute("data-outcome", "wrong_status");
    expect(verdict).toHaveTextContent("En transit");
    expect(verdict).toHaveTextContent(/Ne le recevez pas/);
    expect(screen.queryByRole("button", { name: "Valider la décision" })).toBeNull();
  });

  it("says plainly when the number is unknown", async () => {
    respond({ outcome: "not_found", code: "999" });
    render(<ReturnsHome marketId="m-ly" />);
    scan("999");
    const verdict = await screen.findByTestId("wh-return-verdict");
    expect(verdict).toHaveAttribute("data-outcome", "not_found");
    expect(verdict).toHaveTextContent("Introuvable dans le système");
  });

  it("a card can be tapped when the sticker cannot be read", () => {
    render(<ReturnsHome marketId="m-ly" />);
    fireEvent.click(screen.getAllByTestId("wh-return-row")[1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("هدى القماطي");
  });
});
