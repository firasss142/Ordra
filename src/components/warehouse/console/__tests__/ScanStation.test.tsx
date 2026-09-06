import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ScanStation } from "../ScanStation";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import messages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

/**
 * The scan bench.
 *
 * These tests are about the four OUTCOMES being distinguishable, and about the
 * COLOUR being named before anything is scanned. A scan that bound at Darb, one
 * refused by us, one refused by Darb, and one that bound at Darb but failed to
 * commit here all need to look different — the last especially, because an
 * operator who reads only "erreur" will re-sticker a parcel that is already
 * live at the carrier.
 */

// The camera path pulls in html5-qrcode, which wants a real <video>.
vi.mock("@/components/warehouse/QrScanner", () => ({
  // The fake camera decodes one sticker when clicked, so the camera path
  // (which bypasses the disabled input) can be exercised.
  QrScanner: ({ onScan }: { onScan: (v: string) => void }) => (
    <button type="button" data-testid="qr-scanner" onClick={() => onScan("7700001")} />
  ),
}));

function order(overrides: Partial<WarehouseOrderRow> = {}): WarehouseOrderRow {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    customer_name: "ام خالد",
    customer_phone: "+218...",
    customer_city: "بنغازي",
    customer_area: null,
    customer_address: null,
    product_id: "p1",
    product_name: "Sac de frappe",
    variant_label: null,
    quantity: 1,
    total_price: 129,
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
    ...overrides,
  };
}

const greenZone: OrderZone = {
  branchGroup: "BN",
  colorHex: "#339307",
  colourFr: "Vert",
  nameFr: "Région orientale",
  nameAr: "المنطقة الشرقية",
  source: "carrier",
};

function renderStation(props: Partial<Parameters<typeof ScanStation>[0]> = {}) {
  const onScanned = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ScanStation
        variant="panel"
        market="ly"
        hand={order()}
        handZone={greenZone}
        orders={[order()]}
        onScanned={onScanned}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onScanned };
}

function scan(code: string) {
  const input = screen.getByPlaceholderText(/Scannez le sticker/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }),
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ScanStation — the colour to reach for", () => {
  test("names the colour and the zone before anything is scanned", () => {
    renderStation();
    expect(screen.getByText(/Rouleau Vert/i)).toBeInTheDocument();
    // Once on the roll strip, once on the parcel-in-hand pill.
    expect(screen.getAllByText(/Région orientale/).length).toBeGreaterThan(0);
  });

  test("says the colour is unconfirmed rather than guessing one", () => {
    renderStation({ handZone: { ...greenZone, colorHex: null, colourFr: null, nameFr: null } });
    expect(screen.getByText(/Couleur à confirmer/i)).toBeInTheDocument();
  });

  test("names the colour only once a parcel is in hand", () => {
    // With nothing taken there is no destination, so no colour to name — and
    // an empty strip reads as a fault rather than an absent question.
    renderStation({ hand: null, handZone: null });
    expect(screen.queryByText(/Rouleau Vert/i)).not.toBeInTheDocument();
  });
});

describe("ScanStation — the four outcomes", () => {
  test("a bound sticker reports the stock movement", async () => {
    respond(200, { stock_after: 199 });
    const { onScanned } = renderStation();
    scan("889230");

    await waitFor(() => expect(screen.getByText(/Sticker lié chez Darb/i)).toBeInTheDocument());
    // The result tile and the recent list both carry it.
    expect(screen.getAllByText(/200 → 199/).length).toBeGreaterThan(0);
    expect(onScanned).toHaveBeenCalled();
  });

  test("a refusal from Darb is attributed to Darb, not to us", async () => {
    respond(502, { error_code: "DARB_BIND_FAILED", message: "shipment completed" });
    renderStation();
    scan("889230");
    await waitFor(() => expect(screen.getByText(/Refusé par Darb/i)).toBeInTheDocument());
  });

  test("bound-but-not-committed is its own outcome, never a plain error", async () => {
    // The parcel IS live at the carrier. An operator told only "erreur" would
    // re-sticker it, binding a second number to a shipment already moving.
    respond(409, { error_code: "STOCK_UNDERFLOW", darb_bound: true });
    renderStation();
    scan("889230");
    await waitFor(() =>
      expect(screen.getByText(/Lié chez Darb, sortie non enregistrée/i)).toBeInTheDocument(),
    );
  });
});

describe("ScanStation — what it refuses to do", () => {
  test("Libya cannot scan at all without a parcel in hand", () => {
    // The sticker alone cannot identify the order, so the input is closed
    // rather than accepting a scan that could only fail. It says why.
    renderStation({ hand: null, handZone: null });

    const input = screen.getByPlaceholderText(/Prenez d'abord un colis/i);
    expect(input).toBeDisabled();
  });

  test("arms the moment a parcel is taken", () => {
    renderStation();
    expect(screen.getByPlaceholderText(/Scannez le sticker/i)).not.toBeDisabled();
  });

  test("Tunisia resolves the order from the code itself", async () => {
    respond(200, { stock_after: 4 });
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <ScanStation
          variant="panel"
          market="tn"
          hand={null}
          handZone={null}
          orders={[order()]}
          onScanned={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    const input = screen.getByPlaceholderText(/Scannez le QR/i);
    fireEvent.change(input, { target: { value: "aaaaaaaa" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Sticker lié chez Darb/i)).toBeInTheDocument());
  });

  test("keeps the last eight scans and no more", async () => {
    respond(409, { error_code: "STICKER_ALREADY_USED" });
    renderStation();
    for (let i = 0; i < 10; i += 1) {
      scan(`88920${i}`);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getAllByText(/88920/).length).toBeGreaterThan(0));
    }
    const rows = screen.getAllByText(/^88920\d$/);
    expect(rows.length).toBeLessThanOrEqual(9); // 8 in the list + the result tile
  });
});

/**
 * On a phone there is no barcode gun, so the reasoning that makes the camera a
 * fallback at a desk inverts: it is the only scanner the agent has.
 */
describe("ScanStation — on a phone the camera is the scanner", () => {
  test("leads with the viewfinder, with the camera control inside the frame", () => {
    // Mockup 02: the frame is the screen. A wedge gun is faster at a desk, but
    // on a phone there is no gun, so the camera stops being a fallback.
    renderStation();
    const frame = screen.getByTestId("wm-viewfinder");
    expect(frame).toBeInTheDocument();
    expect(frame.contains(screen.getByTestId("wh-camera-primary"))).toBe(true);
  });

  test("starting the camera swaps the empty frame for the live scanner", () => {
    renderStation();
    expect(screen.queryByTestId("qr-scanner")).toBeNull();
    fireEvent.click(screen.getByTestId("wh-camera-primary"));
    expect(screen.getByTestId("qr-scanner")).toBeInTheDocument();
  });

  test("keeps the compact toggle for the desk, where a wedge scanner leads", () => {
    renderStation();
    const toggle = screen.getByTestId("wh-camera-toggle").className;
    expect(toggle).toMatch(/\bhidden\b/);
    expect(toggle).toMatch(/\bmd:grid\b/);
  });
});

describe("ScanStation — what the tile says is what the server did", () => {
  test("the 'from' figure is the server's, not the row's cached stock", async () => {
    // The queue page is cached for up to 30 s (stale-while-revalidate), so
    // the row's current_stock lags behind the shelf. Measured on the bench:
    // "10 → 8" and "9 → 7" for single-unit scans.
    respond(200, { stock_after: 199 });
    renderStation({ hand: order({ current_stock: 250 }) });
    scan("889230");
    await waitFor(() => expect(screen.getByText(/Sticker lié chez Darb/i)).toBeInTheDocument());
    expect(screen.getAllByText(/200 → 199/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/250 → 199/)).toBeNull();
  });

  test("Darb's own refusal wording reaches the operator", async () => {
    respond(502, { error_code: "DARB_BIND_FAILED", message: "Darb injoignable" });
    renderStation();
    scan("889230");
    await waitFor(() => expect(screen.getByText(/Refusé par Darb/i)).toBeInTheDocument());
    expect(screen.getAllByText(/Darb injoignable/).length).toBeGreaterThan(0);
  });

  test("says the bench is talking to Darb while the request is in flight", async () => {
    // A bind can take the full 15 s timeout. A frozen input with no words is
    // read as a dead screen.
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    renderStation();
    scan("889230");
    await waitFor(() => expect(screen.getByText(/Liaison chez Darb/i)).toBeInTheDocument());
  });

  test("a parcel already released by the carrier is named as such", async () => {
    respond(409, { error_code: "GONE_AT_CARRIER", carrier_status: "released" });
    renderStation();
    scan("889230");
    await waitFor(() => expect(screen.getAllByText(/déjà parti chez le transporteur/i).length).toBeGreaterThan(0));
  });
});

describe("ScanStation — refusals that never reach the network", () => {
  test("a camera scan with no parcel in hand says so, not 'introuvable'", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderStation({ hand: null, handZone: null });
    fireEvent.click(screen.getByTestId("wh-camera-primary"));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    await waitFor(() => expect(screen.getAllByText(/Scan ignoré/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Commande introuvable/i)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a payload that is not a bare number is refused locally", async () => {
    // The Darb QR encodes the bare sticker number. Anything else is a
    // mis-scan, and Darb would bind it without complaint.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderStation();
    scan("https://sabil.ly/track/7700011");
    await waitFor(() => expect(screen.getAllByText(/pas un numéro de sticker/i).length).toBeGreaterThan(0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ScanStation — the colour in the operator's language", () => {
  test("a Libyan agent reads the roll colour and zone in Arabic", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <ScanStation
          variant="station"
          market="ly"
          hand={order()}
          handZone={greenZone}
          orders={[order()]}
          onScanned={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/رول أخضر/)).toBeInTheDocument();
    expect(screen.getAllByText(/المنطقة الشرقية/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Vert/)).toBeNull();
    expect(screen.queryByText(/Région orientale/)).toBeNull();
  });
});
