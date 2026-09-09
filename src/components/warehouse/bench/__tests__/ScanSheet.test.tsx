import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ScanSheet } from "../ScanSheet";
import { Intl, row, GREEN, UNKNOWN } from "./fixtures";

/**
 * The scan sheet: the parcel, its roll, the camera, and one outcome at a time.
 *
 * Each outcome calls for a different next act, so each must look different:
 * bound moves on, a refusal here rescans, a refusal at Darb carries Darb's
 * own words, and bound-but-not-committed must never read as a plain error.
 */
vi.mock("@/components/warehouse/QrScanner", () => ({
  QrScanner: ({ onScan }: { onScan: (v: string) => void }) => (
    <button type="button" data-testid="qr-scanner" onClick={() => onScan("https://darb.ly/x")} />
  ),
}));

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSheet(
  over: Partial<Parameters<typeof ScanSheet>[0]> & { skipConfirm?: boolean } = {},
) {
  const props = {
    open: true,
    market: "ly" as const,
    hand: row(),
    orders: [row()],
    currency: "LYD",
    next: null,
    onTakeNext: vi.fn(),
    onPutBack: vi.fn(),
    onClose: vi.fn(),
    onBound: vi.fn(),
    ...over,
  };
  delete (props as { skipConfirm?: boolean }).skipConfirm;
  render(<Intl locale="fr"><ScanSheet {...props} /></Intl>);
  // The sheet opens on the photo confirmation (no printer, no barcode: the
  // photo is the only witness that the box matches the row). Every test below
  // is about what happens AFTER that, so step through it here.
  if (props.hand && !over.skipConfirm) {
    const yes = screen.queryByTestId("wh-parcel-confirm-yes");
    if (yes) fireEvent.click(yes);
  }
  return props;
}

function bind(code: string) {
  const input = screen.getByLabelText("Numéro du sticker");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Lier le sticker" }));
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window.navigator, "vibrate", { value: vi.fn().mockReturnValue(true), configurable: true, writable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ScanSheet — the roll before the parcel", () => {
  it("names the roll on a band with the branch code on a white plate", () => {
    renderSheet();
    const band = screen.getByTestId("wh-sheet-band");
    expect(band).toHaveAttribute("data-roll", "#d80a0a");
    expect(band).toHaveTextContent("Rouge");
    expect(within(band).getByTestId("wh-sheet-plate")).toHaveTextContent("TR");
    expect(screen.getByText("Tripoli et banlieue")).toBeInTheDocument();
  });

  it("says the zone is unknown rather than guessing a colour", () => {
    renderSheet({ hand: row({ zone: UNKNOWN }) });
    expect(screen.getByTestId("wh-sheet-band")).toHaveAttribute("data-roll", "");
    expect(screen.getByText(/Vérifiez la destination/)).toBeInTheDocument();
  });

  it("frames the viewfinder in the roll colour", () => {
    // Camera on tap for this device, so the frame is the sheet's own.
    localStorage.setItem("wh.scanner", JSON.stringify({ sound: true, vibrate: true, cameraFirst: false }));
    renderSheet({ hand: row({ zone: GREEN }) });
    expect(screen.getByTestId("wm-viewfinder")).toHaveAttribute("data-frame", "#339307");
  });
});

describe("ScanSheet — outcomes", () => {
  it("refuses a payload that is not a sticker number before touching the network", async () => {
    const fetchMock = respond(200, {});
    renderSheet();
    fireEvent.click(screen.getByTestId("qr-scanner"));
    await waitFor(() => expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "refused_here"));
    expect(screen.getByText(/n'est pas un numéro de sticker/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refusal from Darb keeps Darb's own words", async () => {
    respond(502, { error_code: "DARB_BIND_FAILED", message: "reference already assigned" });
    renderSheet();
    bind("7700001");
    await waitFor(() => expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "refused_darb"));
    expect(screen.getByText(/reference already assigned/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("bound but not committed is amber, with its own instruction", async () => {
    respond(409, { error_code: "STOCK_UNDERFLOW", darb_bound: true });
    renderSheet();
    bind("7700001");
    const result = await screen.findByTestId("wh-sheet-result");
    expect(result).toHaveAttribute("data-outcome", "bound_not_committed");
    expect(result).toHaveTextContent(/Prévenez le responsable/);
  });

  it("a bound sticker reports the stock movement and calls back", async () => {
    respond(200, { stock_after: 574 });
    const props = renderSheet();
    bind("7700001");
    const result = await screen.findByTestId("wh-sheet-result");
    expect(result).toHaveAttribute("data-outcome", "bound");
    expect(result).toHaveTextContent("575 ← 574");
    expect(props.onBound).toHaveBeenCalled();
    expect(window.navigator.vibrate).toHaveBeenCalled();
  });

  it("names the wait while Darb binds", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })));
    renderSheet();
    bind("7700001");
    expect(await screen.findByText(/Liaison chez Darb/)).toBeInTheDocument();
    resolve({ ok: true, status: 200, json: async () => ({ stock_after: 574 }) });
  });
});

describe("ScanSheet — nothing in hand", () => {
  it("looks a sticker up and reports what the system knows", async () => {
    respond(200, {
      outcome: "wrong_status",
      status: "scanned",
      order: { ...row(), customer_name: "علي بن عمر" },
    });
    renderSheet({ hand: null });
    expect(screen.getByText(/Aucun colis en main/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Numéro du sticker"), { target: { value: "7700001" } });
    fireEvent.click(screen.getByRole("button", { name: "Chercher le sticker" }));
    const result = await screen.findByTestId("wh-sheet-lookup");
    expect(result).toHaveTextContent("علي بن عمر");
    expect(result).toHaveTextContent("Scanné");
  });

  it("says plainly when the number is unknown", async () => {
    respond(200, { outcome: "not_found" });
    renderSheet({ hand: null });
    fireEvent.change(screen.getByLabelText("Numéro du sticker"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Chercher le sticker" }));
    expect(await screen.findByText("Introuvable dans le système")).toBeInTheDocument();
  });
});

/**
 * The parcel is confirmed by eye before the camera opens.
 *
 * There is no printer and no barcode on a Libyan box, so nothing mechanical can
 * prove the parcel in hand is the parcel on screen. The product photo is the
 * only witness, and one deliberate tap is what stands between "stuck the next
 * sticker on the wrong box" and a wrong parcel leaving the building.
 */
describe("ScanSheet — confirming the parcel first", () => {
  it("keeps the scanner shut until the agent says this is the parcel", () => {
    renderSheet({ skipConfirm: true });
    expect(screen.getByTestId("wh-parcel-confirm")).toBeInTheDocument();
    expect(screen.queryByLabelText("Numéro du sticker")).not.toBeInTheDocument();
  });

  it("shows the product and the customer at a size you can match to a box", () => {
    renderSheet({ skipConfirm: true });
    const card = screen.getByTestId("wh-parcel-confirm");
    expect(card).toHaveTextContent("دمية ملاكمة حجم كبير");
    expect(card).toHaveTextContent("محمد علي");
  });

  it("opens the scanner once confirmed", () => {
    renderSheet();
    expect(screen.queryByTestId("wh-parcel-confirm")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Numéro du sticker")).toBeInTheDocument();
  });

  it("re-arms for the next parcel rather than trusting the last confirmation", () => {
    renderSheet();
    cleanup();
    // A different parcel in hand starts unconfirmed again.
    renderSheet({ hand: row({ id: "different-parcel" }), skipConfirm: true });
    expect(screen.getByTestId("wh-parcel-confirm")).toBeInTheDocument();
  });
});

/**
 * Where the parcel went.
 *
 * The floor reported "scanned orders stay in the unscanned list". Part of that
 * was a real bug (a bind Darb already held dead-ended the parcel), but part is
 * this screen: the success card said the sticker was bound and showed the stock
 * move, and never said the parcel had LEFT the bench for the Scannés list. With
 * a queue that only refreshes on the next revalidation, "did that work?" was a
 * fair question — and re-scanning to check is what produced the duplicate-key
 * dead end in the first place.
 */
describe("ScanSheet — the parcel has left the bench", () => {
  it("says the parcel moved to the scanned list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ stock_after: 573, sticker_bind_state: "confirmed" }),
    }));
    renderSheet();
    bind("889201");
    await waitFor(() =>
      expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bound"),
    );
    expect(screen.getByTestId("wh-sheet-moved")).toBeInTheDocument();
  });

  it("says it too when Darb kept its own number — the parcel still left", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        stock_after: 573, sticker_bind_state: "restickered", carrier_reference: "1279049",
      }),
    }));
    renderSheet();
    bind("889201");
    await waitFor(() =>
      expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bind_unverified"),
    );
    expect(screen.getByTestId("wh-sheet-moved")).toBeInTheDocument();
  });

  it("does NOT say it when nothing was committed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error_code: "WRONG_SITE", darb_bound: true, sticker_ref: "889201" }),
    }));
    renderSheet();
    bind("889201");
    await waitFor(() =>
      expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bound_not_committed"),
    );
    // The parcel is still on the bench: claiming otherwise is the lie that
    // sends an agent to hand over a parcel the system never recorded.
    expect(screen.queryByTestId("wh-sheet-moved")).not.toBeInTheDocument();
  });
});
