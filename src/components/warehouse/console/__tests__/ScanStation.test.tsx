import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ScanStation, type RollRow } from "../ScanStation";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import messages from "@/messages/fr.json";

/**
 * The scan bench.
 *
 * These tests are about the five OUTCOMES being distinguishable. A scan that
 * bound at Darb, one refused for the wrong roll, one refused by us, one refused
 * by Darb, and one that bound at Darb but failed to commit here all need to
 * look different — the last especially, because an operator who reads only
 * "erreur" will re-sticker a parcel that is already live at the carrier.
 */

// The camera path pulls in html5-qrcode, which wants a real <video>.
vi.mock("@/components/warehouse/QrScanner", () => ({
  QrScanner: () => <div data-testid="qr-scanner" />,
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

const greenRoll: RollRow = {
  id: "roll-1",
  carrier_id: "darb-1",
  color_hex: "#339307",
  colour_fr: "Vert",
  name_fr: "Région orientale",
  name_ar: "المنطقة الشرقية",
  label: "Rouleau vert",
  range_start: 889188,
  range_end: 889287,
  status: "open",
  capacity: 100,
  consumed: 42,
  remaining: 58,
  next_number: 889230,
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
        rolls={[greenRoll]}
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

describe("ScanStation — the roll to pick up", () => {
  test("names the colour and the zone before anything is scanned", () => {
    renderStation();
    expect(screen.getByText(/Rouleau Vert/i)).toBeInTheDocument();
    // Once on the roll strip, once on the parcel-in-hand pill.
    expect(screen.getAllByText(/Région orientale/).length).toBeGreaterThan(0);
  });

  test("shows the next number and what is left on that roll", () => {
    renderStation();
    expect(screen.getByText("889230")).toBeInTheDocument();
    expect(screen.getByText(/58 restants/)).toBeInTheDocument();
  });

  test("says the colour is unconfirmed rather than guessing one", () => {
    renderStation({ handZone: { ...greenZone, colorHex: null, colourFr: null, nameFr: null } });
    expect(screen.getByText(/Couleur à confirmer/i)).toBeInTheDocument();
  });

  test("flags a destination whose roll nobody has registered", () => {
    renderStation({ rolls: [] });
    expect(screen.getByText(/Rouleau non enregistré/i)).toBeInTheDocument();
  });

  test("warns while no roll exists at all, because nothing is being checked", () => {
    renderStation({ rolls: [] });
    expect(screen.getByText(/les numéros ne sont pas vérifiés/i)).toBeInTheDocument();
  });
});

describe("ScanStation — the five outcomes", () => {
  test("a bound sticker reports the stock movement", async () => {
    respond(200, { stock_after: 199 });
    const { onScanned } = renderStation();
    scan("889230");

    await waitFor(() => expect(screen.getByText(/Sticker lié chez Darb/i)).toBeInTheDocument());
    // The result tile and the recent list both carry it.
    expect(screen.getAllByText(/200 → 199/).length).toBeGreaterThan(0);
    expect(onScanned).toHaveBeenCalled();
  });

  test("a wrong roll shows both colours, which is faster to act on than a sentence", async () => {
    respond(409, {
      error_code: "STICKER_WRONG_ROLL",
      sticker_color: "#fc6401",
      required_color: "#339307",
    });
    const { onScanned } = renderStation();
    scan("889230");

    await waitFor(() => expect(screen.getByText(/Mauvais rouleau/i)).toBeInTheDocument());
    expect(screen.getByText(/scanné/i)).toBeInTheDocument();
    expect(screen.getByText(/à utiliser/i)).toBeInTheDocument();
    // Nothing was committed, so the queue must not be refetched as if it had.
    expect(onScanned).not.toHaveBeenCalled();
  });

  test("a number off no registered roll says to check the roll", async () => {
    respond(409, { error_code: "STICKER_NOT_IN_ROLL" });
    renderStation();
    scan("4443873");
    await waitFor(() =>
      expect(screen.getAllByText(/n'appartient à aucun rouleau enregistré/i).length).toBeGreaterThan(0),
    );
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
    // And no roll is named, because there is no parcel to name one for.
    expect(screen.queryByText(/Rouleau Vert/i)).not.toBeInTheDocument();
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
          rolls={[]}
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
    respond(409, { error_code: "STICKER_NOT_IN_ROLL" });
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
