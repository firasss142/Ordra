import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import type { AuthUser } from "@/types";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { DeskTopBar } from "../DeskTopBar";
import { DeskScanProvider, useDeskScan, type DeskRow } from "../DeskScanContext";

/**
 * The desk top bar: one permanent scan field, the building switch, the avatar.
 *
 * The field replaces the old side ScanStation. A USB scanner types like a
 * keyboard and ends with Enter. With a parcel in hand (« Prendre » on Sortir)
 * Enter binds the sticker through the same path as before — same local
 * refusals, same server guards, same four outcomes. With nothing in hand it
 * only LOOKS the code up: it can never bind a sticker to nothing.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/fr/warehouse/out",
  useSearchParams: () => new URLSearchParams(search),
}));

let sites: Array<{ id: string; code: string; name: string; isDefault: boolean }> = [];
vi.mock("@/hooks/useWarehouseSites", () => ({
  useWarehouseSites: () => ({ sites, mine: null, pinned: false, unassigned: false, isLoading: false }),
}));

const GREEN: OrderZone = {
  branchGroup: "BN", colorHex: "#339307", colourFr: "Vert",
  nameFr: "Région orientale", nameAr: "المنطقة الشرقية", source: "carrier",
};

function row(over: Partial<DeskRow> = {}): DeskRow {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    customer_name: "Meryem Ali",
    customer_phone: "+218",
    customer_city: "Derna",
    customer_area: null,
    customer_address: null,
    product_id: "p1",
    product_name: "Coran",
    variant_label: null,
    quantity: 1,
    total_price: 120,
    status: "uploaded",
    created_at: new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
    branch_group: "BN",
    tracking_number: "SH1",
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: true,
    current_stock: 200,
    low_stock_threshold: 5,
    zone: GREEN,
    ...over,
  } as WarehouseOrderRow & { zone: OrderZone };
}

const user = {
  id: "u1", email: "voix.mm@voix.local", full_name: "manager ly", role: "market_manager",
  market_id: "m1", avatar_url: null, locale: "fr", direction: "ltr",
} as unknown as AuthUser;

/** Stands in for Sortir: registers the queue and, optionally, a parcel in hand. */
function Sortir({ market, orders, hand }: { market: "ly" | "tn"; orders: DeskRow[]; hand?: DeskRow }) {
  const { setQueue, take } = useDeskScan();
  useEffect(() => {
    setQueue({ market, orders });
    if (hand) take(hand);
  }, [market, orders, hand, setQueue, take]);
  return null;
}

function renderBar(
  opts: { locale?: "fr" | "ar"; market?: "ly" | "tn"; orders?: DeskRow[]; hand?: DeskRow | null; children?: ReactNode } = {},
) {
  const { locale = "fr", market = "ly", orders = [row()], hand = row(), children } = opts;
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages}>
      <DeskScanProvider>
        <DeskTopBar user={user} />
        <Sortir market={market} orders={orders} hand={hand ?? undefined} />
        {children}
      </DeskScanProvider>
    </NextIntlClientProvider>,
  );
}

function field() {
  return screen.getByRole("textbox", { name: /Scannez un sticker/i });
}

function scan(code: string) {
  fireEvent.change(field(), { target: { value: code } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

function respond(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  sites = [
    { id: "t", code: "tripoli", name: "Tripoli", isDefault: true },
    { id: "b", code: "benghazi", name: "Benghazi", isDefault: false },
  ];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeskTopBar — the bar itself", () => {
  it("carries the scan field, its Enter hint and the viewer's initial", () => {
    renderBar({ hand: null });
    expect(field()).toHaveAttribute("placeholder", "Scannez un sticker, un numéro de suivi, une référence…");
    expect(screen.getByText("⏎")).toBeInTheDocument();
    expect(screen.getByTestId("wh-desk-avatar").textContent).toBe("M");
  });

  it("offers every building of the market plus « Tous », and marks the one in the URL", () => {
    search = "warehouse_id=b";
    renderBar({ hand: null });
    const group = screen.getByRole("group", { name: "Bâtiment" });
    const buttons = Array.from(group.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    expect(buttons).toEqual([
      ["Tous", "false"],
      ["Tripoli", "false"],
      ["Benghazi", "true"],
    ]);
  });

  it("writes the building into ?warehouse_id= on the current page, and removes it for « Tous »", () => {
    search = "tab=receptions&warehouse_id=b";
    renderBar({ hand: null });
    fireEvent.click(screen.getByRole("button", { name: "Tripoli" }));
    expect(router.replace).toHaveBeenLastCalledWith("/fr/warehouse/out?tab=receptions&warehouse_id=t");
    fireEvent.click(screen.getByRole("button", { name: "Tous" }));
    expect(router.replace).toHaveBeenLastCalledWith("/fr/warehouse/out?tab=receptions");
  });

  it("has no building switch when the market has one building", () => {
    sites = [{ id: "tn", code: "tunis", name: "Tunis", isDefault: true }];
    renderBar({ hand: null });
    expect(screen.queryByRole("group", { name: "Bâtiment" })).toBeNull();
  });
});

describe("DeskTopBar — a parcel in hand", () => {
  it("asks for the sticker of the right roll, for the right parcel", () => {
    renderBar();
    expect(field()).toHaveAttribute(
      "placeholder",
      "Scannez le sticker du rouleau Vert collé sur le colis de Derna",
    );
    expect(screen.getByTestId("wh-desk-scanfield").dataset.hand).toBe("true");
  });

  it("names the roll in Arabic for a Libyan manager", () => {
    renderBar({ locale: "ar", hand: row({ customer_city: "درنة" }) });
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "امسح ملصق رولة أخضر الملصق على طرد درنة");
  });

  it("binds through the scan-out route and reports the stock the SERVER moved", async () => {
    const spy = respond(200, { stock_after: 199 });
    renderBar({ hand: row({ current_stock: 250 }) });
    scan("889230");

    await waitFor(() => expect(screen.getByText(/Sticker lié chez Darb/i)).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith(
      "/api/warehouse/scan-out",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ order_id: row().id, sticker_ref: "889230" }) }),
    );
    expect(screen.getByText("Stock 200 → 199")).toBeInTheDocument();
    // The parcel left the hand; the page re-reads its counts.
    expect(field()).toHaveAttribute("placeholder", "Scannez un sticker, un numéro de suivi, une référence…");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("attributes a Darb refusal to Darb, with Darb's own words", async () => {
    respond(502, { error_code: "DARB_BIND_FAILED", message: "Darb injoignable" });
    renderBar();
    scan("889230");
    await waitFor(() => expect(screen.getByText(/Refusé par Darb/i)).toBeInTheDocument());
    expect(screen.getByText(/Darb injoignable/)).toBeInTheDocument();
    // A refusal keeps the parcel in hand: the operator re-scans.
    expect(screen.getByTestId("wh-desk-scanfield").dataset.hand).toBe("true");
  });

  it("keeps bound-but-not-committed apart from a plain error", async () => {
    respond(409, { error_code: "STOCK_UNDERFLOW", darb_bound: true });
    renderBar();
    scan("889230");
    await waitFor(() =>
      expect(screen.getByText(/Lié chez Darb, sortie non enregistrée/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("wh-desk-result").dataset.outcome).toBe("bound_not_committed");
  });

  it("says it is talking to Darb while the bind is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    renderBar();
    scan("889230");
    await waitFor(() => expect(screen.getByText(/Liaison chez Darb/i)).toBeInTheDocument());
  });

  it("refuses a payload that is not a bare sticker number without calling anyone", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    renderBar();
    scan("https://sabil.ly/track/7700011");
    await waitFor(() => expect(screen.getByText(/pas un numéro de sticker/i)).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it("puts the parcel back on Escape", () => {
    renderBar();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.getByTestId("wh-desk-scanfield").dataset.hand).toBe("false");
  });
});

describe("DeskTopBar — nothing in hand: a lookup, never a bind", () => {
  it("opens the order the code belongs to", async () => {
    const spy = respond(200, { outcome: "wrong_status", status: "scanned", order: { id: "o-42" } });
    renderBar({ hand: null });
    scan("7700011");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/fr/orders/o-42"));
    expect(spy).toHaveBeenCalledWith("/api/warehouse/returns/lookup?code=7700011");
    expect(spy).not.toHaveBeenCalledWith("/api/warehouse/scan-out", expect.anything());
  });

  it("sends a return to its verdict on Rentrer, not to the order page", async () => {
    // A `to_be_returned` parcel is decided on Rentrer (Recevoir… / Relivrer);
    // one still on the road is shown there too, greyed.
    respond(200, { outcome: "found", order: { id: "o-7" } });
    renderBar({ hand: null });
    scan("9900101");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/fr/warehouse/returns?order=o-7"));
  });

  it("sends a parcel still on its way back to Rentrer as well", async () => {
    respond(200, { outcome: "wrong_status", status: "returning", order: { id: "o-8" } });
    renderBar({ hand: null });
    scan("9900102");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/fr/warehouse/returns?order=o-8"));
  });

  it("says so when the code belongs to nothing", async () => {
    respond(200, { outcome: "not_found" });
    renderBar({ hand: null });
    scan("7700011");
    await waitFor(() => expect(screen.getByText("Introuvable dans le système")).toBeInTheDocument());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("asks for the full number when a prefix is ambiguous", async () => {
    respond(200, { outcome: "ambiguous", matches: 3 });
    renderBar({ hand: null });
    scan("aaaaaa");
    await waitFor(() => expect(screen.getByText(/3 commandes commencent par ce code/)).toBeInTheDocument());
  });

  it("Tunisia still scans its own label out when the code is on the bench", async () => {
    // Tunisia's label QR IS the order id, so it resolves without a hand — the
    // behaviour the old side panel had.
    const spy = respond(200, { stock_after: 4 });
    renderBar({ market: "tn", hand: null });
    scan("aaaaaaaa");
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("/api/warehouse/scan-out", expect.objectContaining({ method: "POST" })),
    );
  });
});
