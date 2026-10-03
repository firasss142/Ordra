import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ScanSheet } from "../ScanSheet";
import { Intl, row, GREEN, RED } from "./fixtures";

/**
 * The centre Scan button with nothing in hand (prototype `sheet()`).
 *
 * « Scannez n'importe quel sticker » — the scan says what the sticker is, and
 * each answer leads somewhere different:
 *   already scanned  when, who, whether Darb has it, and the way back (Dé-scanner)
 *   a return         straight to Rentrer, on that parcel
 *   other building   « Ne le scannez pas ici »
 *   a free sticker   « Sur quel colis l'avez-vous collé ? » → the ordinary bind
 * The bind keeps every outcome of the run: Darb's own words on a refusal, amber
 * when Darb holds the sticker but the stock never moved.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

let scannedPage: unknown = undefined;
const swrMutate = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key.startsWith("/api/warehouse/scanned") ? scannedPage : undefined,
    error: undefined,
    isLoading: false,
    mutate: swrMutate,
  }),
}));

/** Answers each endpoint the way the server would. */
function serve(routes: Record<string, { status?: number; body: unknown } | (() => Promise<unknown>)>) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
    if (!hit) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    const r = hit[1];
    if (typeof r === "function") return r();
    const { status = 200, body } = r;
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const g1 = row({ id: "aaaaaaaa-0000-4000-8000-0000000000g1", customer_name: "مريم سالم", customer_city: "درنة", zone: GREEN });
const g2 = row({ id: "aaaaaaaa-0000-4000-8000-0000000000g2", customer_name: "فاطمة علي", customer_city: "طبرق", zone: GREEN });
const g3 = row({ id: "aaaaaaaa-0000-4000-8000-0000000000g3", customer_name: "هدى عمر", customer_city: "طبرق", zone: GREEN });
const g4 = row({ id: "aaaaaaaa-0000-4000-8000-0000000000g4", customer_name: "إسماعيل", customer_city: "اجدابيا", zone: GREEN });
const r1 = row({ id: "aaaaaaaa-0000-4000-8000-0000000000r1", customer_name: "محمد", zone: RED });

function renderSheet(over: Partial<Parameters<typeof ScanSheet>[0]> = {}) {
  const props = {
    open: true,
    market: "ly" as const,
    locale: "fr",
    orders: [r1, g1, g2, g3, g4],
    lastRoll: GREEN.colorHex,
    onClose: vi.fn(),
    onBound: vi.fn(),
    onUnscanned: vi.fn(),
    ...over,
  };
  render(<Intl locale="fr"><ScanSheet {...props} /></Intl>);
  return props;
}

function scan(code: string) {
  fireEvent.change(screen.getByLabelText("Numéro du sticker"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
}

/** A free sticker, then « C'est bien ce colis — lier » on the preselected parcel. */
async function bindFree(code: string) {
  scan(code);
  fireEvent.click(await screen.findByRole("button", { name: "C'est bien ce colis — lier" }));
}

beforeEach(() => {
  push.mockClear();
  swrMutate.mockClear();
  scannedPage = undefined;
  localStorage.clear();
  Object.defineProperty(window.navigator, "vibrate", { value: vi.fn().mockReturnValue(true), configurable: true, writable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ScanSheet — the lookup", () => {
  it("asks for any sticker, with a white viewfinder, a typed field and a close", () => {
    serve({});
    const props = renderSheet();
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Scannez n'importe quel sticker" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Aucun colis en main : le scan vous dira ce qu'est ce sticker.");
    expect(within(sheet).getByTestId("wh-sheet-viewfinder")).toHaveAttribute("data-frame", "");
    expect(within(sheet).getByLabelText("Numéro du sticker")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Fermer" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("is nothing at all when closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ScanSheet — already scanned", () => {
  it("says when, who, and that Darb has not taken it — and offers the way back", async () => {
    scannedPage = {
      orders: [{
        ...row({ id: "dddddddd-0000-4000-8000-000000000001" }),
        status: "scanned",
        scanned_at: "2026-10-02T08:42:00Z",
        scanned_by_name: "adel",
        carrier_status_slug: "pending",
      }],
    };
    serve({
      "/api/warehouse/returns/lookup": {
        body: { outcome: "wrong_status", status: "scanned", order: { ...row(), id: "dddddddd-0000-4000-8000-000000000001" } },
      },
      "/api/warehouse/unscan": { body: { stock_after: 12 } },
    });
    vi.spyOn(window, "prompt").mockReturnValue("mauvais colis");
    const props = renderSheet();
    scan("1213127");
    const card = await screen.findByTestId("wh-sheet-already");
    expect(card).toHaveTextContent("Sorti à 10:42 · adel");
    expect(card).toHaveTextContent("Darb ne l'a pas encore pris");
    fireEvent.click(within(card).getByRole("button", { name: "Dé-scanner" }));
    await waitFor(() => expect(props.onUnscanned).toHaveBeenCalled());
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => u === "/api/warehouse/unscan")!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({
      order_id: "dddddddd-0000-4000-8000-000000000001",
      note: "mauvais colis",
    });
  });

  it("no way back once Darb has it", async () => {
    scannedPage = {
      orders: [{
        ...row({ id: "dddddddd-0000-4000-8000-000000000002" }),
        status: "at_carrier",
        scanned_at: "2026-10-02T08:42:00Z",
        scanned_by_name: "adel",
        carrier_status_slug: "received",
      }],
    };
    serve({
      "/api/warehouse/returns/lookup": {
        body: { outcome: "wrong_status", status: "at_carrier", order: { ...row(), id: "dddddddd-0000-4000-8000-000000000002" } },
      },
    });
    renderSheet();
    scan("1213128");
    const card = await screen.findByTestId("wh-sheet-already");
    expect(card).toHaveTextContent("Darb l'a pris");
    expect(within(card).queryByRole("button", { name: "Dé-scanner" })).toBeNull();
  });
});

describe("ScanSheet — a return goes to Rentrer", () => {
  it.each([
    ["found", "to_be_returned"],
    ["wrong_status", "returning"],
  ])("%s / %s opens the returns screen on that parcel", async (outcome, status) => {
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome, status, order: { ...row(), id: "eeeeeeee-0000-4000-8000-000000000001" } } },
    });
    const props = renderSheet();
    scan("1213129");
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/fr/warehouse/returns?order=eeeeeeee-0000-4000-8000-000000000001"),
    );
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("ScanSheet — another building", () => {
  it("says not to scan it here, naming the building", async () => {
    serve({
      "/api/warehouse/returns/lookup": {
        body: { outcome: "wrong_status", status: "uploaded", order: { ...row(), id: "ffffffff-0000-4000-8000-000000000001", warehouse_id: "w-tip" } },
      },
      "/api/warehouse/sites": {
        body: { sites: [{ id: "w-tip", code: "TIP", name: "Tripoli" }, { id: "w-ben", code: "BEN", name: "Benghazi" }], mine: "w-ben" },
      },
    });
    const props = renderSheet();
    scan("SH1844962");
    const card = await screen.findByTestId("wh-sheet-result");
    expect(card).toHaveAttribute("data-outcome", "wrong_site");
    expect(card).toHaveTextContent("Ne le scannez pas ici");
    expect(card).toHaveTextContent("Ce colis part de l'entrepôt de Tripoli.");
    fireEvent.click(screen.getByRole("button", { name: "Compris" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("ScanSheet — one of my own parcels, still to scan", () => {
  it("says it is in the queue and opens the run on it", async () => {
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "wrong_status", status: "uploaded", order: g2 } },
    });
    renderSheet();
    scan("SH1851028");
    const card = await screen.findByTestId("wh-sheet-queue");
    expect(card).toHaveTextContent("Dans votre file, à scanner");
    expect(within(card).getByRole("link", { name: "Le prendre en main" })).toHaveAttribute(
      "href",
      `/fr/warehouse/scan?roll=%23339307&order=${g2.id}`,
    );
  });
});

describe("ScanSheet — a free sticker", () => {
  it("offers the next three parcels of the roll last worked, the first chosen", async () => {
    serve({ "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } } });
    renderSheet();
    scan("1213140");
    const free = await screen.findByTestId("wh-sheet-free");
    expect(free).toHaveTextContent("Sticker libre");
    expect(free).toHaveTextContent("1213140");
    expect(free).toHaveTextContent("Lié à aucune commande");
    expect(free).toHaveTextContent("Sur quel colis l'avez-vous collé ?");
    expect(free).toHaveTextContent("Les prochains colis du rouleau Vert");
    const options = within(free).getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("aria-checked", "true");
    expect(options[0]).toHaveTextContent("درنة · مريم");
    fireEvent.click(options[1]);
    expect(options[1]).toHaveAttribute("aria-checked", "true");
    expect(options[0]).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(free).getByRole("button", { name: "Voir toute la file" }));
    expect(within(free).getAllByRole("radio")).toHaveLength(5);
  });

  it("binds the sticker to the parcel chosen, through the ordinary bind", async () => {
    const fetchMock = serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": { body: { stock_after: 574, sticker_bind_state: "confirmed" } },
    });
    const props = renderSheet();
    scan("1213140");
    const free = await screen.findByTestId("wh-sheet-free");
    fireEvent.click(within(free).getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "C'est bien ce colis — lier" }));
    const result = await screen.findByTestId("wh-sheet-result");
    expect(result).toHaveAttribute("data-outcome", "bound");
    expect(result).toHaveTextContent("1213140");
    expect(result).toHaveTextContent("575 → 574");
    expect(screen.getByTestId("wh-sheet-moved")).toBeInTheDocument();
    const bind = fetchMock.mock.calls.find(([u]) => u === "/api/warehouse/scan-out")!;
    expect(JSON.parse((bind[1] as RequestInit).body as string)).toEqual({ order_id: g2.id, sticker_ref: "1213140" });
    expect(props.onBound).toHaveBeenCalledWith(g2.id);
    expect(window.navigator.vibrate).toHaveBeenCalled();
  });

  it("falls back to the queue when no roll was worked yet", async () => {
    serve({ "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } } });
    renderSheet({ lastRoll: null, orders: [g1] });
    scan("1213140");
    const free = await screen.findByTestId("wh-sheet-free");
    expect(free).toHaveTextContent("Les prochains colis de la file");
  });

  it("a code that is not a sticker number is unknown, not free", async () => {
    serve({ "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } } });
    renderSheet();
    scan("https://darb.ly/x");
    expect(await screen.findByText("Introuvable dans le système")).toBeInTheDocument();
    expect(screen.queryByTestId("wh-sheet-free")).toBeNull();
  });
});

describe("ScanSheet — the bind's outcomes", () => {
  it("a refusal from Darb keeps Darb's own words", async () => {
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": { status: 502, body: { error_code: "DARB_BIND_FAILED", message: "reference already assigned" } },
    });
    renderSheet();
    await bindFree("7700001");
    await waitFor(() => expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "refused_darb"));
    expect(screen.getByText(/reference already assigned/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("bound but not committed is amber, with its own instruction, and the parcel has NOT left", async () => {
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": { status: 409, body: { error_code: "STOCK_UNDERFLOW", darb_bound: true } },
    });
    const props = renderSheet();
    await bindFree("7700001");
    const result = await screen.findByTestId("wh-sheet-result");
    expect(result).toHaveAttribute("data-outcome", "bound_not_committed");
    expect(result).toHaveTextContent(/Prévenez le responsable/);
    expect(screen.queryByTestId("wh-sheet-moved")).toBeNull();
    expect(props.onBound).not.toHaveBeenCalled();
  });

  it("says the parcel left even when Darb kept its own number", async () => {
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": { body: { stock_after: 573, sticker_bind_state: "restickered", carrier_reference: "1279049" } },
    });
    renderSheet();
    await bindFree("889201");
    await waitFor(() => expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bind_unverified"));
    expect(screen.getByTestId("wh-sheet-result")).toHaveTextContent("1279049");
    expect(screen.getByTestId("wh-sheet-moved")).toBeInTheDocument();
  });

  it("a wrong-site refusal from the server is the wrong-building card", async () => {
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": { status: 409, body: { error_code: "WRONG_SITE", warehouse_name: "Tripoli" } },
    });
    renderSheet();
    await bindFree("889201");
    const result = await screen.findByTestId("wh-sheet-result");
    expect(result).toHaveAttribute("data-outcome", "wrong_site");
    expect(result).toHaveTextContent("Ce colis part de l'entrepôt de Tripoli.");
  });

  it("names the wait while Darb binds", async () => {
    let resolve: (v: unknown) => void = () => {};
    serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": () => new Promise((r) => { resolve = r; }),
    });
    renderSheet();
    await bindFree("7700001");
    expect(await screen.findByText(/Liaison chez Darb/)).toBeInTheDocument();
    resolve({ ok: true, status: 200, json: async () => ({ stock_after: 574 }) });
  });
});

describe("ScanSheet — Tunisia", () => {
  it("our own QR on a bench parcel scans it out directly", async () => {
    const tn = row({ id: "12345678-0000-4000-8000-000000000001" });
    const fetchMock = serve({ "/api/warehouse/scan-out": { body: { stock_after: 9 } } });
    const props = renderSheet({ market: "tn", orders: [tn], lastRoll: null });
    scan(tn.id);
    await waitFor(() => expect(screen.getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bound"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/warehouse/returns/lookup"))).toBe(false);
    expect(props.onBound).toHaveBeenCalledWith(tn.id);
  });
});
